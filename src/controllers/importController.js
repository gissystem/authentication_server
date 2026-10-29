import mongoose from 'mongoose';
import { Credential } from '../models/Credential.js';
import { APP_IDS } from '../config/constants.js';

// Insert-only bulk import used by the School Backend's bulk student/employee
// import. Unlike /auth/webhook/bulk (which upserts and can overwrite users of
// other schools), this endpoint NEVER modifies an existing credential:
//   - any userId that already exists (in any school) is a conflict,
//   - any non-empty email that already exists is a conflict (login by email
//     would otherwise become ambiguous),
//   - all credentials are inserted in ONE transaction, tagged with batchId,
//     so the School Backend can roll the whole batch back if its own write fails.
//
// Body: { batchId, credentials: [{ userId, password, url, firstName, lastName, title, email, schoolBranchId }], dryRun? }

const ALLOWED_KINDS = new Set(['Parent', 'Employee']);

function normalizeCredential(raw) {
  const item = raw || {};
  const branchIds = Array.isArray(item.schoolBranchId)
    ? item.schoolBranchId
    : item.schoolBranchId != null
      ? [item.schoolBranchId]
      : [];
  return {
    userId: item.userId != null ? String(item.userId).trim() : '',
    password: item.password != null ? String(item.password) : '',
    url: (item.url || '').toString().trim(),
    firstName: (item.firstName || '').toString().trim(),
    lastName: (item.lastName || '').toString().trim(),
    title: (item.title || '').toString().trim(),
    email: (item.email || '').toString().trim().toLowerCase(),
    schoolBranchId: branchIds.map((id) => String(id).trim()).filter(Boolean),
    kind: item.kind === 'Parent' ? 'Parent' : item.kind === 'Employee' ? 'Employee' : '',
  };
}

function validateCredentials(items) {
  const errors = [];
  const credentials = [];
  const seenUserIds = new Map();
  const seenEmails = new Map();

  items.forEach((raw, index) => {
    const c = normalizeCredential(raw);
    const missing = ['userId', 'password', 'url', 'firstName', 'title'].filter((f) => !c[f]);
    if (!ALLOWED_KINDS.has(c.kind)) missing.push('kind');
    if (c.schoolBranchId.length === 0) missing.push('schoolBranchId');
    if (missing.length > 0) {
      errors.push({ index, userId: c.userId || null, reason: `Missing required fields: ${missing.join(', ')}` });
      return;
    }
    if (c.kind === 'Parent' && c.title !== 'Parent') {
      errors.push({ index, userId: c.userId, reason: 'Parent credential must have title "Parent"' });
      return;
    }
    if (seenUserIds.has(c.userId)) {
      errors.push({ index, userId: c.userId, reason: `Duplicate userId in payload (also at index ${seenUserIds.get(c.userId)})` });
      return;
    }
    seenUserIds.set(c.userId, index);
    if (c.email) {
      if (seenEmails.has(c.email)) {
        errors.push({ index, userId: c.userId, reason: `Duplicate email "${c.email}" in payload (also userId ${seenEmails.get(c.email)})` });
        return;
      }
      seenEmails.set(c.email, c.userId);
    }
    credentials.push(c);
  });

  return { errors, credentials };
}

async function findConflicts(credentials, session) {
  const userIds = credentials.map((c) => c.userId);
  const emails = credentials.map((c) => c.email).filter(Boolean);
  const existing = await Credential.find(
    { $or: [{ userId: { $in: userIds } }, ...(emails.length ? [{ email: { $in: emails } }] : [])] },
    { userId: 1, email: 1, title: 1, url: 1, schoolBranchId: 1 }
  )
    .session(session || null)
    .lean();

  const byUserId = new Map();
  const byEmail = new Map();
  existing.forEach((e) => {
    byUserId.set(e.userId, e);
    if (e.email) byEmail.set(e.email, e);
  });

  const conflicts = [];
  credentials.forEach((c) => {
    const u = byUserId.get(c.userId);
    if (u) {
      conflicts.push({
        userId: c.userId,
        reason: 'userId already exists in auth DB',
        existing: { title: u.title, url: u.url, schoolBranchId: u.schoolBranchId },
      });
    }
    const e = c.email && byEmail.get(c.email);
    if (e && e.userId !== c.userId) {
      conflicts.push({
        userId: c.userId,
        reason: `email "${c.email}" already used by userId ${e.userId}`,
        existing: { title: e.title, url: e.url, schoolBranchId: e.schoolBranchId },
      });
    }
  });
  return conflicts;
}

function toDoc(c, batchId, now) {
  return {
    userId: c.userId,
    password: c.password,
    url: c.url,
    firstName: c.firstName,
    lastName: c.lastName,
    title: c.title,
    email: c.email,
    schoolBranchId: c.schoolBranchId,
    appId: c.kind === 'Parent' ? [APP_IDS.ScholarApp] : [APP_IDS.InstituteApp, APP_IDS.MentorApp],
    deviceId: '',
    importBatchId: batchId,
    createdAt: now,
    updatedAt: now,
  };
}

export async function importCredentials(req, res) {
  const body = req.body || {};
  const batchId = (body.batchId || '').toString().trim();
  const dryRun = body.dryRun === true || body.dryRun === 'true';

  if (!batchId) return res.status(400).json({ ok: false, error: 'batchId is required' });
  if (!Array.isArray(body.credentials) || body.credentials.length === 0) {
    return res.status(400).json({ ok: false, error: 'credentials must be a non-empty array' });
  }

  const { errors, credentials } = validateCredentials(body.credentials);
  if (errors.length > 0) {
    return res.status(422).json({ ok: false, error: 'VALIDATION_FAILED', errors, conflicts: [] });
  }

  try {
    const conflicts = await findConflicts(credentials);
    if (conflicts.length > 0) {
      return res.status(409).json({ ok: false, error: 'CONFLICTS', errors: [], conflicts });
    }
    if (dryRun) {
      return res.status(200).json({ ok: true, dryRun: true, batchId, total: credentials.length, inserted: 0 });
    }

    const session = await mongoose.startSession();
    let inserted = 0;
    let lateConflicts = [];
    try {
      await session.withTransaction(async () => {
        // Re-check inside the transaction so a concurrent write between the
        // pre-check above and this insert cannot slip a duplicate in.
        lateConflicts = await findConflicts(credentials, session);
        if (lateConflicts.length > 0) {
          throw new Error('CONFLICTS');
        }
        const now = new Date();
        const docs = await Credential.insertMany(
          credentials.map((c) => toDoc(c, batchId, now)),
          { session, ordered: true }
        );
        inserted = docs.length;
      });
    } catch (error) {
      if (lateConflicts.length > 0) {
        return res.status(409).json({ ok: false, error: 'CONFLICTS', errors: [], conflicts: lateConflicts });
      }
      throw error;
    } finally {
      await session.endSession();
    }

    return res.status(201).json({ ok: true, batchId, total: credentials.length, inserted });
  } catch (error) {
    console.error('Error in credential import:', error);
    return res.status(500).json({ ok: false, error: 'IMPORT_FAILED', message: error.message });
  }
}

// Compensating action: deletes every credential inserted by one import batch.
export async function rollbackImport(req, res) {
  const batchId = ((req.body || {}).batchId || '').toString().trim();
  if (!batchId) return res.status(400).json({ ok: false, error: 'batchId is required' });
  try {
    const result = await Credential.deleteMany({ importBatchId: batchId });
    return res.status(200).json({ ok: true, batchId, deleted: result.deletedCount ?? 0 });
  } catch (error) {
    console.error('Error rolling back credential import:', error);
    return res.status(500).json({ ok: false, error: 'ROLLBACK_FAILED', message: error.message });
  }
}
