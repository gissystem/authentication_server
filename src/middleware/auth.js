export function extractCredentialsFromBody() {
  return function extractCredentialsMiddleware(req, res, next) {
    const { userId, password, url, firstName, fname, lastName, title, email, schoolGroupId, schoolId } = req.body || {};


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
      schoolGroupId: (schoolGroupId || '').trim(),
      schoolId: (schoolId || '').trim(),
    };

    return next();
  };
}
