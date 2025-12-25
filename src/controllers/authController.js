import jwt from 'jsonwebtoken';
import { Credential } from '../models/Credential.js';

function signToken(user) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('Missing JWT_SECRET');

  const expiresIn = process.env.JWT_EXPIRES_IN || '1h';

  return jwt.sign(
    {
      role: user.title,
      userId: user.userId,
      firstName: user.firstName,
      lastName: user.lastName,
      appId: user.appId // Including appId in token
    },
    secret,
    {
      subject: String(user._id),
      expiresIn,
    }
  );
}

export async function loginWithCredential(req, res) {
  const { employeeID, parentID, childID, password, applicationID } = req.body;

  const userId = employeeID || parentID || childID;

  if (!password || !userId) {
    return res.status(400).json({ error: 'userId and password are required' });
  }

  if (!applicationID) {
    return res.status(400).json({ error: 'applicationID is required' });
  }

  const user = await Credential.findOne({ userId });

  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Credential stores password as plain text
  if (user.password !== password) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  if (!Array.isArray(user.appId) || !user.appId.includes(applicationID)) {
    return res.status(403).json({ error: 'Access denied: User does not have access to this application' });
  }

  const token = signToken({ ...user.toObject(), appId: applicationID });

  return res.json({
    token,
    url: user.url,
  });
}
