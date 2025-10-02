const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const archiver = require('archiver');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase client (server-side, use service role key)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Security & parsing
app.use(helmet());
app.use(cookieParser());
app.use(express.json({ limit: '2mb' })); // small JSON for options
// capture raw body for webhook verification
app.use(express.urlencoded({ extended: true }));
app.use(express.raw({ type: 'application/json', limit: '1mb', verify: (req, res, buf) => { req.rawBody = buf; } }));

// CORS for your frontend origin (adjust)
const ALLOWED_ORIGIN = process.env.FRONTEND_ORIGIN || '*';
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Rate limiting middleware - tune limits as needed
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120, // per IP per window
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Multer for multipart file uploads (in-memory)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB/file

// Helper: sign JWT
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_in_prod';
function signToken(payload, expiresIn = '30d') {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

// Auth middleware (reads HttpOnly cookie)
async function authMiddleware(req, res, next) {
  try {
    const token = req.cookies?.scalpel_token || (req.headers.authorization && req.headers.authorization.split(' ')[1]);
    if (!token) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    const decoded = jwt.verify(token, JWT_SECRET);
    // attach user id/email
    req.user = decoded;
    // Optionally re-check DB for latest plan
    const { data, error } = await supabase.from('users').select('id,email,is_pro,file_limit,files_used').eq('id', decoded.id).single();
    if (error || !data) return res.status(401).json({ ok: false, error: 'User not found' });
    req.user.db = data;
    next();
  } catch (err) {
    return res.status(401).json({ ok: false, error: 'Invalid token' });
  }
}

/* ---------- Auth endpoints: register / login / logout ---------- */

// POST /api/register  { email, password }
app.post('/api/register', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ ok: false, error: 'email & password required' });
  try {
    const hashed = await bcrypt.hash(password, 10);
    const defaultLimit = parseInt(process.env.DEFAULT_FREE_LIMIT || '50', 10);
    const { data, error } = await supabase.from('users').insert([{ email: email.toLowerCase(), password_hash: hashed, is_pro: false, file_limit: defaultLimit, files_used: 0 }]).select().single();
    if (error) {
      // conflict handling
      if (error.code === '23505') return res.status(409).json({ ok: false, error: 'User exists' });
      throw error;
    }
    const token = signToken({ id: data.id, email: data.email });
    res.cookie('scalpel_token', token, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 30 * 24 * 60 * 60 * 1000 });
    return res.json({ ok: true, user: { id: data.id, email: data.email, is_pro: data.is_pro } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// POST /api/login { email, password }
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ ok: false, error: 'email & password required' });
  try {
    const { data, error } = await supabase.from('users').select('id,email,password_hash,is_pro').eq('email', email.toLowerCase()).single();
    if (error || !data) return res.status(401).json({ ok: false, error: 'Invalid credentials' });
    const match = await bcrypt.compare(password, data.password_hash);
    if (!match) return res.status(401).json({ ok: false, error: 'Invalid credentials' });
    const token = signToken({ id: data.id, email: data.email });
    res.cookie('scalpel_token', token, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 30 * 24 * 60 * 60 * 1000 });
    return res.json({ ok: true, user: { id: data.id, email: data.email, is_pro: data.is_pro } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// POST /api/logout
app.post('/api/logout', (req, res) => {
  res.clearCookie('scalpel_token', { path: '/' });
  res.json({ ok: true });
});

/* ---------- Promo redeem (server-side only) ---------- */
// POST /api/redeem-promo { code } - requires auth
app.post('/api/redeem-promo', authMiddleware, async (req, res) => {
  const code = (req.body?.promoCode || req.body?.code || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ success: false, message: 'Code required' });

  // Server-side canonical valid codes (you can also store codes in DB)
  const VALID_CODES = new Set((process.env.VALID_PROMO_CODES || 'PRO2025,SCALPEL-TRIAL').split(',').map(s=>s.trim().toUpperCase()).filter(Boolean));
  if (!VALID_CODES.has(code)) return res.status(400).json({ success: false, message: 'Invalid code' });

  try {
    // Mark user as pro and optionally increase file_limit
    const newLimit = parseInt(process.env.PRO_FILE_LIMIT || '999999', 10);
    const { data, error } = await supabase.from('users').update({ is_pro: true, file_limit: newLimit }).eq('id', req.user.id).select().single();
    if (error) throw error;

    // re-issue token with up-to-date data
    const token = signToken({ id: data.id, email: data.email, is_pro: true });
    res.cookie('scalpel_token', token, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 30 * 24 * 60 * 60 * 1000 });

    return res.json({ success: true, message: 'Promo applied' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/* ---------- Plan check endpoint ---------- */
// POST /api/check-plan - optional auth, returns file_limit and files_used
app.post('/api/check-plan', authMiddleware, async (req, res) => {
  try {
    const user = req.user.db;
    return res.json({ plan: user.is_pro ? 'pro' : 'free', fileLimit: user.file_limit, filesUsed: user.files_used || 0 });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
});

/* ---------- Main processing endpoint (uploads files, server renames, zips, streams back) ---------- */
/*
  POST /api/process-files
  - multipart/form-data
  - fields:
    - options (JSON string) { baseName, addNumbering, startNumber, numberDigits, separator, ... }
    - files[] (file parts)
*/
app.post('/api/process-files', authMiddleware, upload.array('files', 500), async (req, res) => {
  try {
    const user = req.user.db;
    // check usage / limits (atomic)
    const files = req.files || [];
    const count = files.length;
    if (count === 0) return res.status(400).json({ ok: false, error: 'No files uploaded' });

    // Re-fetch user record with FOR UPDATE-like behavior not available; use upsert with check:
    // Simple approach: get current files_used and file_limit and then update if allowed
    const { data: freshUser } = await supabase.from('users').select('files_used,file_limit,is_pro').eq('id', user.id).single();

    const remaining = (freshUser.file_limit || 0) - (freshUser.files_used || 0);
    if (!freshUser.is_pro && remaining <= 0) {
      return res.status(403).json({ ok: false, error: 'Free limit reached' });
    }

    if (!freshUser.is_pro && count > remaining) {
      return res.status(403).json({ ok: false, error: `Only ${remaining} files remaining in free plan` });
    }

    // Atomically increment files_used (simple optimistic update)
    const { error: incErr } = await supabase.rpc('increment_files_used', { p_user_id: user.id, p_inc: count });
    if (incErr) {
      // Fall back to non-atomic update (rare) - reject to be safe
      console.error('usage increment failed', incErr);
      return res.status(500).json({ ok: false, error: 'Failed to reserve usage' });
    }

    // Parse options JSON
    const optionsRaw = req.body.options || '{}';
    const options = typeof optionsRaw === 'string' ? JSON.parse(optionsRaw) : optionsRaw;

    // Prepare zip stream
    res.setHeader('Content-Type', 'application/zip');
    const base = (options.baseName || 'renamed').replace(/\s+/g, '_');
    const filename = `${base}_${Date.now()}.zip`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', err => { throw err; });
    archive.pipe(res);

    // Add files to archive with new names
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const newName = generateNewFilenameServer(f.originalname, i, options);
      archive.append(f.buffer, { name: newName });
    }

    await archive.finalize();

    // When stream ends, result already sent. usage already incremented.
  } catch (err) {
    console.error('processing error', err);
    return res.status(500).json({ ok: false, error: 'Processing failed' });
  }
});

// Helper: server-side rename logic (mirror client generateNewFilename)
function generateNewFilenameServer(originalName, index, options = {}) {
  let newName = '';
  const baseName = (options.baseName || 'file');
  const extension = (originalName.split('.').pop() || '');
  if (options.addPrefix && options.prefixText) newName += options.prefixText;
  newName += baseName;
  if (options.addNumbering) {
    const startNum = parseInt(options.startNumber || '1', 10);
    const numDigits = parseInt(options.numberDigits || '2', 10);
    const separator = options.numberSeparator || '_';
    const number = (startNum + index).toString().padStart(numDigits, '0');
    newName += separator + number;
  }
  if (options.addSuffix && options.suffixText) newName += options.suffixText;
  // find/replace and case conversion (basic)
  if (options.findReplace && options.findText) {
    const findText = options.findText;
    const replaceText = options.replaceText || '';
    const flags = options.matchCase ? 'g' : 'gi';
    const regex = new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    newName = newName.replace(regex, replaceText);
  }
  if (options.convertCase) {
    const caseType = options.caseType;
    switch (caseType) {
      case 'lowercase': newName = newName.toLowerCase(); break;
      case 'UPPERCASE': newName = newName.toUpperCase(); break;
      case 'Title Case': newName = newName.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()); break;
      case 'Sentence case': newName = newName.charAt(0).toUpperCase() + newName.slice(1).toLowerCase(); break;
    }
  }
  const newExt = options.changeExtension && options.newExtension ? options.newExtension : extension;
  newName += '.' + newExt;
  return newName;
}

/* ---------- Razorpay webhook ---------- */
// POST /api/razorpay-webhook
app.post('/api/razorpay-webhook', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers['x-razorpay-signature'];
    if (!secret || !signature) return res.status(400).end('Missing secret or signature');

    const expected = crypto.createHmac('sha256', secret).update(req.body).digest('hex');
    if (expected !== signature) return res.status(401).end('Invalid signature');

    const event = JSON.parse(req.body.toString());
    // Example: payment.captured
    if (event.event === 'payment.captured' || event.event === 'payment.authorized') {
      const payment = event.payload?.payment?.entity || {};
      const notes = payment.notes || {};
      const email = notes.email || notes.customer_email;
      if (email) {
        // mark user pro
        await supabase.from('users').update({ is_pro: true, file_limit: parseInt(process.env.PRO_FILE_LIMIT || '999999', 10) }).eq('email', email);
      }
    }

    res.status(200).send('OK');
  } catch (err) {
    console.error('webhook error', err);
    res.status(500).send('Server error');
  }
});

/* ---------- Utility RPC: create increment function in DB (see SQL below) ---------- */

/* ---------- Fallback route ---------- */
app.get('/', (req, res) => {
  res.send('Scalpel server running');
});

/* ---------- Start ---------- */
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));


