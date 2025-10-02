require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const path = require('path');
const { Pool } = require('pg');
const fs = require('fs');
const util = require('util');

const app = express();
const readFile = util.promisify(fs.readFile);

const { authenticateJWT, issueJwtCookie } = require('./middleware/auth');
const { csrfCookieMiddleware, verifyCsrfMiddleware } = require('./middleware/csrf');
const { authLimiter, generalLimiter } = require('./middleware/rateLimit');

const paymentsRouter = require('./routes/payments');
const uploadRouter = require('./routes/upload');

// Postgres pool (uses DATABASE_URL)
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
app.locals.db = pool;

// Basic security
app.use(helmet());
app.use(express.json({ limit: '1mb' })); // typical limit; adjust as needed
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// Serve static files (pricing.html etc.)
app.use(express.static(path.join(__dirname, '..')));

// CSRF double-submit cookie: set cookie on safe GETs and expose verification helper
app.use(csrfCookieMiddleware);

// Rate limiting global (non-auth sensitive)
app.use(generalLimiter);

// Routes
// --- Auth: demo login endpoint (replace with real auth logic)
app.post('/api/login', authLimiter, async (req, res) => {
  // ... Replace with real credential verification (parameterized queries) ...
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Missing credentials' });

  try {
    const db = req.app.locals.db;
    const userRes = await db.query('SELECT id, email, password_hash, role FROM users WHERE email = $1', [email]);
    if (userRes.rowCount === 0) return res.status(401).json({ error: 'Invalid credentials' });

    const user = userRes.rows[0];
    // TODO: verify password with bcrypt.compare
    const passwordMatches = true; // placeholder - implement bcrypt compare
    if (!passwordMatches) return res.status(401).json({ error: 'Invalid credentials' });

    // issue JWT cookie and XSRF cookie
    const token = await issueJwtCookie(res, { sub: user.id, role: user.role });
    // server already sets CSRF cookie in csrfCookieMiddleware for GET; for login response also set one:
    res.cookie('XSRF-TOKEN', (req.cookies['XSRF-TOKEN'] || require('crypto').randomBytes(16).toString('hex')), {
      httpOnly: false,
      secure: process.env.COOKIE_SECURE === 'true',
      sameSite: process.env.COOKIE_SAMESITE || 'Strict',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Example protected route that returns account info
app.get('/api/account', authenticateJWT, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const r = await db.query('SELECT id, email, role, pro_expires_at FROM users WHERE id = $1', [req.user.sub]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    const u = r.rows[0];
    const isPro = u.pro_expires_at && new Date(u.pro_expires_at) > new Date();
    return res.json({ id: u.id, email: u.email, role: u.role, pro: !!isPro });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Mount payment webhook (uses raw body inside router)
app.use('/webhook', paymentsRouter);

// Upload / ZIP generation routes (protected)
app.use('/api', authenticateJWT, uploadRouter);

// Health
app.get('/healthz', (req, res) => res.send('ok'));

// Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
