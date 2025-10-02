const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';
const COOKIE_SAMESITE = process.env.COOKIE_SAMESITE || 'Strict';

if (!JWT_SECRET) {
  console.error('Missing JWT_SECRET in env');
  process.exit(1);
}

// issue JWT and set HttpOnly cookie
async function issueJwtCookie(res, payload) {
  // payload: { sub, role, ... }
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
  // Secure flags
  res.cookie('session_token', token, {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: COOKIE_SAMESITE,
    maxAge: parseCookieMaxAge(JWT_EXPIRES)
  });
  return token;
}

function parseCookieMaxAge(exp) {
  // supports '7d', numeric seconds, or defaults 7 days.
  if (typeof exp === 'number') return exp * 1000;
  const m = String(exp).match(/^(\d+)([smhd])$/);
  if (!m) return 7 * 24 * 60 * 60 * 1000;
  const v = parseInt(m[1], 10);
  const unit = m[2];
  const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return v * (multipliers[unit] || multipliers.d);
}

// authenticate middleware reads HttpOnly cookie
function authenticateJWT(req, res, next) {
  const token = req.cookies && req.cookies['session_token'];
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// optional helper: require pro access
async function requirePro(req, res, next) {
  try {
    const db = req.app.locals.db;
    const r = await db.query('SELECT pro_expires_at FROM users WHERE id = $1', [req.user.sub]);
    if (r.rowCount === 0) return res.status(403).json({ error: 'Forbidden' });
    const row = r.rows[0];
    if (!row.pro_expires_at || new Date(row.pro_expires_at) < new Date()) {
      return res.status(403).json({ error: 'Pro subscription required' });
    }
    return next();
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
}

module.exports = { issueJwtCookie, authenticateJWT, requirePro };
