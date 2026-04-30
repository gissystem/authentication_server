import { Credential } from '../models/Credential.js';
import { APP_IDS } from '../config/constants.js';

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
      'schoolId'
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

    const { userId, password, url, firstName, lastName, title, email, schoolGroupId, schoolId, editMode } = req.credentials;

    const appId = [];

    if (title === 'Parent') {
      appId.push(APP_IDS.ScholarApp);
    } else {
      appId.push(APP_IDS.InstituteApp, APP_IDS.MentorApp);
    }

    const existing = await Credential.findOne({ userId }).lean();

    if (existing && !editMode) {
      return res.status(409).json({
        ok: false,
        error: 'USER_ALREADY_EXISTS',
        message: 'User already exists',
        conflict: {
          userId: existing.userId,
          existingSchoolId: existing.schoolId,
        },
      });
    }

    const fields = { url, password, firstName, lastName, title, appId, email, schoolId, schoolGroupId };

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
    schoolGroupId: doc.schoolGroupId,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}
