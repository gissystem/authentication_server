export function extractCredentialsFromBody() {
  return function extractCredentialsMiddleware(req, res, next) {
    const { userId, password, url, firstName, fname, lastName, title } = req.body || {};

    if (!userId || typeof userId !== 'string' || !userId.trim()) {
      return res.status(400).json({ error: 'userId is required' });
    }

    if (!password || typeof password !== 'string') {
      return res.status(400).json({ error: 'password is required' });
    }

    if (!url || typeof url !== 'string' || !url.trim()) {
      return res.status(400).json({ error: 'url is required' });
    }

    req.credentials = {
      userId: userId.trim(),
      password,
      url: url.trim(),
      firstName: (firstName || fname || '').trim(),
      lastName: (lastName || '').trim(),
      title: (title || '').trim(),
    };

    return next();
  };
}
