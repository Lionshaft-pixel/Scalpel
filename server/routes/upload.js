const express = require('express');
const multer = require('multer');
const FileType = require('file-type');
const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const archiver = require('archiver');
const crypto = require('crypto');

const { promoLimiter } = require('../middleware/rateLimit');

const router = express.Router();

// In-memory storage to inspect bytes before writing to disk (for safety).
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE_BYTES || '10485760', 10),
    files: parseInt(process.env.MAX_FILES_PER_UPLOAD || '50', 10)
  },
  fileFilter: (req, file, cb) => {
    // Basic client-declared mime check (final validation uses file bytes)
    const allowed = ['image/png', 'image/jpeg', 'text/plain', 'application/pdf', 'application/zip'];
    if (!allowed.includes(file.mimetype)) {
      return cb(null, false);
    }
    cb(null, true);
  }
});

// Helper to sanitize file name and avoid directory traversal
function safeFilename(orig) {
  const base = path.basename(orig);
  // remove null bytes and weird characters
  return base.replace(/[^\w.\-() ]+/g, '_').slice(0, 200);
}

router.post('/rename-and-zip', promoLimiter, upload.array('files', parseInt(process.env.MAX_FILES_PER_UPLOAD || '50', 10)), async (req, res) => {
  // Ensure authentication handled upstream
  try {
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded' });

    // Create temp dir per request
    const tmpRoot = process.env.TMP_DIR || os.tmpdir();
    const runId = crypto.randomBytes(8).toString('hex');
    const tmpDir = path.join(tmpRoot, `scalpel-${Date.now()}-${runId}`);
    await fs.mkdir(tmpDir, { recursive: true });

    // Validate magic bytes and write sanitized files
    const writtenFiles = [];
    for (const f of req.files) {
      // Validate file type by inspecting first bytes
      const type = await FileType.fromBuffer(f.buffer).catch(() => null);
      // Accept if detected type matches declared type and is allowed, or fallback to some allowed text types
      const allowedTypes = ['image/png', 'image/jpeg', 'application/pdf', 'text/plain', 'application/zip'];
      const detected = type ? type.mime : null;
      if (detected && !allowedTypes.includes(detected)) {
        // cleanup and abort
        await cleanupTmp(tmpDir);
        return res.status(400).json({ error: 'Unsupported file type' });
      }
      // write file with random prefix to avoid collisions and using safe filename
      const filename = safeFilename(f.originalname || `file-${crypto.randomBytes(4).toString('hex')}`);
      const storedName = `${crypto.randomBytes(6).toString('hex')}_${filename}`;
      const filePath = path.join(tmpDir, storedName);
      await fs.writeFile(filePath, f.buffer, { flag: 'w' });
      writtenFiles.push({ path: filePath, name: filename });
    }

    // Generate ZIP
    const zipName = `scalpel-${Date.now()}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', async (err) => {
      console.error('Archive error', err);
      try { await cleanupTmp(tmpDir); } catch (_) {}
      res.status(500).end();
    });
    archive.pipe(res);

    for (const wf of writtenFiles) {
      // Add file to zip using safe entry name (original filename sanitized)
      archive.file(wf.path, { name: wf.name });
    }

    await archive.finalize();
    // cleanup asynchronously after response finishes
    res.on('finish', async () => { await cleanupTmp(tmpDir).catch(() => {}); });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error during upload' });
  }
});

async function cleanupTmp(dir) {
  try {
    const files = await fs.readdir(dir);
    for (const f of files) {
      await fs.unlink(path.join(dir, f));
    }
    await fs.rmdir(dir);
  } catch (e) {
    // ignore cleanup errors
  }
}

module.exports = router;
