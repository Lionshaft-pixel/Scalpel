const crypto = require('crypto');

const COOKIE_NAME = 'XSRF-TOKEN';

// middleware to set cookie on idempotent requests and expose verify function
function csrfCookieMiddleware(req, res, next) {
  // on safe methods (GET, HEAD, OPTIONS) ensure cookie exists
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    if (!req.cookies || !req.cookies[COOKIE_NAME]) {
      const token = crypto.randomBytes(16).toString('hex');
      res.cookie(COOKIE_NAME, token, {
        httpOnly: false, // accessible to client JS for double-submit
        secure: process.env.COOKIE_SECURE === 'true',
        sameSite: process.env.COOKIE_SAMESITE || 'Strict',
        maxAge: 24 * 60 * 60 * 1000
      });
    }
    return next();
  }

  // For state-changing requests, require header equals cookie
  const headerToken = req.get('X-CSRF-Token') || req.get('X-XSRF-TOKEN');
  const cookieToken = req.cookies && req.cookies[COOKIE_NAME];
  if (!headerToken || !cookieToken || headerToken !== cookieToken) {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }
  return next();
}

// Standalone middleware for routes (if needed)
function verifyCsrfMiddleware(req, res, next) {
  const headerToken = req.get('X-CSRF-Token') || req.get('X-XSRF-TOKEN');
  const cookieToken = req.cookies && req.cookies[COOKIE_NAME];
  if (!headerToken || !cookieToken || headerToken !== cookieToken) {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }
  return next();
}

module.exports = { csrfCookieMiddleware, verifyCsrfMiddleware };
