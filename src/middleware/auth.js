// When WEBHOOK_SECRET is configured, callers must send it in the
// x-webhook-secret header. Left open when unset so existing deployments keep working.
export function requireWebhookSecret() {
  return function requireWebhookSecretMiddleware(req, res, next) {
    const secret = process.env.WEBHOOK_SECRET;
    if (secret && req.headers['x-webhook-secret'] !== secret) {
      return res.status(401).json({ error: 'Invalid webhook secret' });
    }
    return next();
  };
}

export function extractCredentialsFromBody() {
  return function extractCredentialsMiddleware(req, res, next) {
    const { userId, password, url, firstName, fname, lastName, title, email, schoolBranchId, editMode } = req.body || {};


    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    if (!password) {
      return res.status(400).json({ error: 'password is required' });
    }

    if (!url) {
      return res.status(400).json({ error: 'url is required' });
    }

    req.credentials = {
      userId,
      password,
      url,
      firstName: (firstName || fname || '').trim(),
      lastName: (lastName || '').trim(),
      title: (title || '').trim(),
      email: (email || '').trim(),
      schoolBranchId: Array.isArray(schoolBranchId) ? schoolBranchId : (schoolBranchId ? [schoolBranchId] : []),
      editMode: editMode === true || editMode === 'true',
    };

    return next();
  };
}
