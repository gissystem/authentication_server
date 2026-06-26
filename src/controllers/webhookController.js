import { Credential } from '../models/Credential.js';
import { APP_IDS } from '../config/constants.js';

export async function receiveCredentialWebhook(req, res) {
  console.log(req.body.schoolBranchId);
  try {
    const requiredFields = [
      'userId',
      'password',
      'url',
      'firstName',
      'lastName',
      'title',
      'email',
      'schoolBranchId'
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

    const { userId, password, url, firstName, lastName, title, email, schoolBranchId, editMode } = req.credentials;

    const appId = [];

    if (title === 'Parent') {
      appId.push(APP_IDS.ScholarApp);
    } else {
      appId.push(APP_IDS.InstituteApp, APP_IDS.MentorApp);
    }

    const existing = await Credential.findOne({ userId }).lean();

    const isSameParentSchoolContext = title === 'Parent'
      && JSON.stringify(existing?.schoolBranchId) === JSON.stringify(schoolBranchId);

    if (existing && !editMode && !isSameParentSchoolContext) {
      return res.status(409).json({
        ok: false,
        error: 'USER_ALREADY_EXISTS',
        message: 'User already exists',
        conflict: {
          userId: existing.userId,
          existingSchoolBranchId: existing.schoolBranchId,
        },
      });
    }

    const fields = { url, password, firstName, lastName, title, appId, email, schoolBranchId };

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
      'schoolBranchId',
    ];

    const skipped = [];
    // Dedupe by userId (last wins) so multiple children sharing one parent
    // collapse into a single parent credential.
    const validByUserId = new Map();

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
        schoolBranchId: Array.isArray(item.schoolBranchId)
          ? item.schoolBranchId.map(String)
          : (item.schoolBranchId ? [String(item.schoolBranchId)] : []),
      };

      const missing = requiredFields.filter((field) => {
        const value = normalized[field];
        if (field === 'schoolBranchId') return !Array.isArray(value) || value.length === 0;
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

      const appId = normalized.title === 'Parent'
        ? [APP_IDS.ScholarApp]
        : [APP_IDS.InstituteApp, APP_IDS.MentorApp];

      validByUserId.set(normalized.userId, { ...normalized, appId });
    });

    const credentials = Array.from(validByUserId.values());

    const result = {
      ok: true,
      dryRun: !!dryRun,
      total: items.length,
      valid: credentials.length,
      duplicatesCollapsed: items.length - skipped.length - credentials.length,
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
