import { Credential } from '../models/Credential.js';
import { APP_IDS } from '../config/constants.js';

export async function receiveCredentialWebhook(req, res) {
  const { userId, password, url, firstName, lastName, title, email, schoolGroupId, schoolId } = req.credentials || {};

  if (!userId || !password || !url) {
    return res.status(400).json({ error: 'Missing credentials payload' });
  }

  const appId = [];
  if (title === 'Teacher') {
    appId.push(APP_IDS.InstituteApp, APP_IDS.MentorApp);
  } else if (title === 'Parent') {
    appId.push(APP_IDS.ScholarApp);
  }

  const doc = await Credential.create({
    userId,
    url,
    password,
    firstName,
    lastName,
    title,
    appId,
    email,
    schoolGroupId,
    schoolId
  });

  return res.status(201).json({
    ok: true,
    credential: {
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
    },
  });
}
