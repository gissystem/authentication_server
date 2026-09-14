import { Credential } from '../models/Credential.js';
import { APP_IDS } from '../config/constants.js';

function normalizeSchoolBranchIds(rawSchoolBranchId) {
  const branchIds = Array.isArray(rawSchoolBranchId)
    ? rawSchoolBranchId
    : rawSchoolBranchId != null
      ? [rawSchoolBranchId]
      : [];
  return branchIds
    .map((id) => (id != null ? String(id).trim() : ''))
    .filter(Boolean)
    .sort();
}

function getParentScopeKey(userId, schoolBranchId) {
  return `${String(userId).trim()}||${(schoolBranchId || []).sort().join('|')}`;
}

function areBranchesAllowed(incomingSchoolBranchIds, existingSchoolBranchIds) {
  const existingSet = new Set(normalizeSchoolBranchIds(existingSchoolBranchIds));
  return incomingSchoolBranchIds.every((branchId) => existingSet.has(branchId));
}

export async function receiveCredentialWebhook(req, res) {
  try {
    const requiredFields = [
      'userId',
      'password',
      'url',
      'firstName',
      'lastName',
      'title',
      'email',
    ];

    const missingFields = requiredFields.filter((field) => {
      const value = req.credentials?.[field];
      return !value || (typeof value === 'string' && !value.trim());
    });

    if (missingFields.length > 0) {
      return res.status(400).json({
        error: `Missing required fields: ${missingFields.join(', ')}`
      });
    }

    const {
      userId,
      password,
      url,
      firstName,
      lastName,
      title,
      email,
      schoolBranchId,
      editMode,
    } = req.credentials;
    const normalizedSchoolBranchId = normalizeSchoolBranchIds(schoolBranchId);
    if (title === 'Parent' && normalizedSchoolBranchId.length === 0) {
      missingFields.push('schoolBranchId');
    }
    if (missingFields.length > 0) {
      return res.status(400).json({
        error: `Missing required fields: ${missingFields.join(', ')}`
      });
    }

    const appId = [];

    if (title === 'Parent') {
      appId.push(APP_IDS.ScholarApp);
    } else {
      appId.push(APP_IDS.InstituteApp, APP_IDS.MentorApp);
    }

    const existing = await Credential.findOne({ userId }).lean();
    const isParent = title === 'Parent';
    const isParentSchoolContextMatch =
      isParent &&
      existing &&
      existing.title === 'Parent' &&
      areBranchesAllowed(normalizedSchoolBranchId, existing?.schoolBranchId || []);

    if (isParent && existing && !isParentSchoolContextMatch) {
      const existingSchoolBranchId = normalizeSchoolBranchIds(existing?.schoolBranchId);
      console.warn('Auth webhook parent school branch conflict', {
        userId,
        incomingSchoolBranchId: normalizedSchoolBranchId,
        existingSchoolBranchId,
      });

      return res.status(409).json({
        ok: false,
        error: 'USER_ALREADY_EXISTS',
        message: 'User already exists in a different school context',
        conflict: {
          userId,
          existingSchoolBranchId,
          incomingSchoolBranchId: normalizedSchoolBranchId,
        },
      });
    }

    if (existing && !editMode && !isParentSchoolContextMatch) {
      return res.status(409).json({
        ok: false,
        error: 'USER_ALREADY_EXISTS',
        message: 'User already exists',
        conflict: {
          userId: existing.userId,
          existingSchoolBranchId: isParent
            ? normalizeSchoolBranchIds(existing?.schoolBranchId)
            : existing?.schoolBranchId,
          incomingSchoolBranchId: isParent ? normalizedSchoolBranchId : undefined,
        },
      });
    }

    const fields = {
      url,
      password,
      firstName,
      lastName,
      title,
      appId,
      email,
      schoolBranchId: normalizedSchoolBranchId,
    };

    if (existing) {
      const doc = await Credential.findOneAndUpdate(
        { userId },
        fields,
        { new: true, runValidators: true }
      );
      return res.status(200).json({
        ok: true,
        updated: true,
        credential: serializeCredential(doc),
      });
    }

    const doc = await Credential.create({ userId, ...fields });
    return res.status(201).json({
      ok: true,
      credential: serializeCredential(doc),
    });
  } catch (error) {
    console.error('Error receiving credential webhook:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

/**
 * Bulk variant of receiveCredentialWebhook. Accepts an array of credentials and
 * performs a SINGLE Mongo bulkWrite (upsert by userId) instead of one HTTP call
 * + one write per record. This is what the School Backend calls during Excel
 * bulk uploads of employees / students, so hundreds of rows sync in one round
 * trip without per-record timeouts.
 *
 * Body: { credentials: [ {userId,password,url,firstName,lastName,title,email,schoolBranchId,editMode}, ... ], dryRun? }
 *
 * Note on semantics: unlike the single endpoint (which 409s on an existing user
 * unless editMode), bulk always upserts — an admin re-uploading a sheet expects
 * existing rows to be overwritten.
 */
export async function receiveCredentialBulkWebhook(req, res) {
  try {
    const body = req.body || {};
    const items = Array.isArray(body) ? body : body.credentials;
    const dryRun = body.dryRun === true || body.dryRun === 'true';

    if (!Array.isArray(items)) {
      return res
        .status(400)
        .json({ error: 'Request body must be an array or { credentials: [...] }' });
    }

    const requiredFields = [
      'userId',
      'password',
      'url',
      'firstName',
      'lastName',
      'title',
      'email',
    ];

    const skipped = [];
    const conflicts = [];
    // Dedupe by userId for non-parents and by (userId + schoolBranchId) for parents
    // so multiple children sharing one parent in one school collapse into a single
    // parent credential, while different school branches stay separate.
    const validByUserOrScope = new Map();

    items.forEach((raw, index) => {
      const item = raw || {};
      const normalized = {
        userId: item.userId != null ? String(item.userId) : '',
        password: item.password != null ? String(item.password) : '',
        url: (item.url || '').toString().trim(),
        firstName: (item.firstName || item.fname || '').toString().trim(),
        lastName: (item.lastName || '').toString().trim(),
        title: (item.title || '').toString().trim(),
        email: (item.email || '').toString().trim().toLowerCase(),
        schoolBranchId: normalizeSchoolBranchIds(item.schoolBranchId),
      };
      const isParent = normalized.title === 'Parent';
      const missing = requiredFields.filter((field) => {
        const value = normalized[field];
        return !value || (typeof value === 'string' && !value.trim());
      });

      if (missing.length > 0) {
        skipped.push({
          index,
          userId: normalized.userId || null,
          reason: `Missing required fields: ${missing.join(', ')}`,
        });
        return;
      }
      if (isParent && normalized.schoolBranchId.length === 0) {
        skipped.push({
          index,
          userId: normalized.userId || null,
          reason: `Missing required fields: schoolBranchId`,
        });
        return;
      }

      const appId = normalized.title === 'Parent'
        ? [APP_IDS.ScholarApp]
        : [APP_IDS.InstituteApp, APP_IDS.MentorApp];
      const scopeKey = isParent
        ? getParentScopeKey(normalized.userId, normalized.schoolBranchId)
        : normalized.userId;
      normalized._scopeKey = scopeKey;

      validByUserOrScope.set(scopeKey, { ...normalized, appId });
    });

    const dedupedCredentials = Array.from(validByUserOrScope.values());
    const credentialsByUser = new Map();
    const parentCredentials = [];
    dedupedCredentials.forEach((credential) => {
      if (credential.title !== 'Parent') return;
      const current = credentialsByUser.get(credential.userId) || [];
      current.push(credential);
      credentialsByUser.set(credential.userId, current);
      parentCredentials.push(credential);
    });

    const conflictScopeKeys = new Set();

    // Same parent user appearing for more than one branch in one bulk payload is
    // ambiguous and must fail explicitly to prevent silent cross-branch writes.
    for (const [userId, byUser] of credentialsByUser.entries()) {
      const scopeKeys = new Set(byUser.map((item) => item._scopeKey));
      if (scopeKeys.size > 1) {
        const incomingBranches = byUser.map((item) => item.schoolBranchId);
        console.warn('Auth bulk webhook parent ambiguity across branches in payload', {
          userId,
          schoolBranches: incomingBranches,
        });
        byUser.forEach((item) => {
          conflictScopeKeys.add(item._scopeKey);
          conflicts.push({
            index: null,
            userId,
            reason: 'Duplicate parent user across different school branches in one bulk payload',
            incomingSchoolBranchId: item.schoolBranchId,
          });
        });
      }
    }

    const existingParentEntries = parentCredentials.length > 0
      ? await Credential.find({
          title: 'Parent',
          userId: { $in: [...new Set(parentCredentials.map((item) => item.userId))] },
        }).lean()
      : [];
    const existingParentMap = new Map();
    existingParentEntries.forEach((entry) => {
      const branches = normalizeSchoolBranchIds(entry.schoolBranchId);
      const existingSet = existingParentMap.get(entry.userId) || new Set();
      branches.forEach((branchId) => existingSet.add(branchId));
      existingParentMap.set(entry.userId, existingSet);
    });

    parentCredentials.forEach((credential) => {
      if (conflictScopeKeys.has(credential._scopeKey)) {
        return;
      }

      const existingSet = existingParentMap.get(credential.userId);
      if (!existingSet) return;

      if (!areBranchesAllowed(credential.schoolBranchId, [...existingSet])) {
        console.warn('Auth bulk webhook parent school branch conflict', {
          userId: credential.userId,
          incomingSchoolBranchId: credential.schoolBranchId,
          existingSchoolBranchId: [...existingSet],
        });
        conflictScopeKeys.add(credential._scopeKey);
        conflicts.push({
          index: null,
          userId: credential.userId,
          reason:
            'Parent credential exists in a different school context',
          incomingSchoolBranchId: credential.schoolBranchId,
          existingSchoolBranchId: [...existingSet],
        });
      }
    });

    const credentials = dedupedCredentials.filter(
      (credential) => !conflictScopeKeys.has(credential._scopeKey)
    );

    const result = {
      ok: true,
      dryRun: !!dryRun,
      total: items.length,
      valid: credentials.length,
      duplicatesCollapsed: items.length - skipped.length - dedupedCredentials.length,
      conflicts,
      upserted: 0,
      modified: 0,
      matched: 0,
      skipped,
    };

    if (dryRun || credentials.length === 0) {
      return res.status(200).json(result);
    }

    const now = new Date();
    const operations = credentials.map((c) => ({
      updateOne: {
        filter: { userId: c.userId },
        update: {
          $set: {
            password: c.password,
            url: c.url,
            firstName: c.firstName,
            lastName: c.lastName,
            title: c.title,
            email: c.email,
            appId: c.appId,
            schoolBranchId: c.schoolBranchId,
            updatedAt: now,
          },
          $setOnInsert: { userId: c.userId, createdAt: now },
        },
        upsert: true,
      },
    }));

    const writeRes = await Credential.bulkWrite(operations, { ordered: false });
    result.upserted = writeRes.upsertedCount ?? 0;
    result.modified = writeRes.modifiedCount ?? 0;
    result.matched = writeRes.matchedCount ?? 0;

    return res.status(200).json(result);
  } catch (error) {
    console.error('Error in bulk credential webhook:', error);
    return res
      .status(500)
      .json({ error: 'Internal Server Error', message: error.message });
  }
}

function serializeCredential(doc) {
  return {
    id: doc._id.toString(),
    userId: doc.userId,
    url: doc.url,
    firstName: doc.firstName,
    lastName: doc.lastName,
    title: doc.title,
    appId: doc.appId,
    email: doc.email,
    schoolBranchId: doc.schoolBranchId,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}
