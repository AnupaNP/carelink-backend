const express = require('express');
const pool = require('../db/pool');
const auth = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// ── Multer setup for photo uploads ──────────────────────────────────────────
const PHOTOS_DIR = path.join(__dirname, '../../public/photos');
if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, PHOTOS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `elder-${uuidv4()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed'));
    }
    cb(null, true);
  },
});

function generateElderUID() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // avoid ambiguous chars
  let uid = 'ELD-';
  for (let i = 0; i < 6; i++) uid += chars[Math.floor(Math.random() * chars.length)];
  return uid;
}

function buildPhotoUrl(req, photoUrl) {
  if (!photoUrl) return null;
  if (photoUrl.startsWith('http')) return photoUrl;
  const base = process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`;
  return `${base}${photoUrl}`;
}

function computeStatus(severity) {
  if (!severity) return 'ok';
  if (severity === 'URGENT') return 'critical';
  if (severity === 'HIGH' || severity === 'MEDIUM') return 'warning';
  return 'ok';
}

// GET /api/elders — list all elders for caregiver
router.get('/', auth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT
       e.*,
       (SELECT c.call_timestamp FROM calls c WHERE c.elder_id = e.id ORDER BY c.call_timestamp DESC LIMIT 1) AS last_call_at,
       (SELECT c.llm_analysis->>'compliance_score' FROM calls c WHERE c.elder_id = e.id AND c.status = 'completed' ORDER BY c.call_timestamp DESC LIMIT 1) AS last_compliance_score,
       (SELECT COUNT(*)::int FROM alerts a WHERE a.elder_id = e.id AND a.is_read = FALSE) AS unread_alerts,
       (SELECT a.severity FROM alerts a WHERE a.elder_id = e.id AND a.is_read = FALSE
        ORDER BY CASE a.severity WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 WHEN 'LOW' THEN 4 END LIMIT 1) AS highest_alert_severity
     FROM elders e
     WHERE e.caregiver_id = $1
     ORDER BY e.name ASC`,
    [req.caregiver.id]
  );

  const result = rows.map(e => ({
    ...e,
    photo_url: buildPhotoUrl(req, e.photo_url),
    status: computeStatus(e.highest_alert_severity),
    last_compliance_score: e.last_compliance_score ? parseInt(e.last_compliance_score) : null,
  }));

  res.json(result);
});

// GET /api/elders/:id — detailed elder view
router.get('/:id', auth, async (req, res) => {
  const { id } = req.params;
  const elderRes = await pool.query(
    'SELECT * FROM elders WHERE id = $1 AND caregiver_id = $2',
    [id, req.caregiver.id]
  );
  if (!elderRes.rows[0]) return res.status(404).json({ error: 'Elder not found' });
  const elder = { ...elderRes.rows[0], photo_url: buildPhotoUrl(req, elderRes.rows[0].photo_url) };

  const [callsRes, alertsRes, schedulesRes, weeklyRes] = await Promise.all([
    pool.query(
      `SELECT id, call_timestamp, duration_seconds, status,
         llm_analysis->>'mood' AS mood,
         llm_analysis->>'compliance_score' AS compliance_score,
         llm_analysis->>'summary' AS summary,
         llm_analysis->>'distress_flag' AS distress_flag
       FROM calls WHERE elder_id = $1 ORDER BY call_timestamp DESC LIMIT 10`,
      [id]
    ),
    pool.query(
      'SELECT * FROM alerts WHERE elder_id = $1 AND is_read = FALSE ORDER BY created_at DESC',
      [id]
    ),
    pool.query(
      'SELECT * FROM schedules WHERE elder_id = $1 AND is_active = TRUE ORDER BY scheduled_time ASC',
      [id]
    ),
    pool.query(
      `SELECT DATE(call_timestamp) AS call_date,
         ROUND(AVG((llm_analysis->>'compliance_score')::numeric)) AS avg_score
       FROM calls
       WHERE elder_id = $1 AND status = 'completed' AND call_timestamp >= NOW() - INTERVAL '7 days'
       GROUP BY DATE(call_timestamp) ORDER BY call_date ASC`,
      [id]
    ),
  ]);

  res.json({
    ...elder,
    status: computeStatus(alertsRes.rows[0]?.severity || null),
    recent_calls: callsRes.rows.map(c => ({
      ...c,
      compliance_score: c.compliance_score ? parseInt(c.compliance_score) : null,
      distress_flag: c.distress_flag === 'true',
    })),
    unread_alerts: alertsRes.rows,
    schedules: schedulesRes.rows,
    weekly_compliance: weeklyRes.rows,
  });
});

// POST /api/elders — create elder
router.post('/', auth, async (req, res) => {
  const { name, age, phone, photo_url, medical_notes, emergency_contact, emergency_phone, address } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });

  let elderUID, attempts = 0;
  do {
    elderUID = generateElderUID();
    const ex = await pool.query('SELECT id FROM elders WHERE elder_uid = $1', [elderUID]);
    if (!ex.rows.length) break;
  } while (++attempts < 10);

  const { rows } = await pool.query(
    `INSERT INTO elders (elder_uid, caregiver_id, name, age, phone, photo_url, medical_notes, emergency_contact, emergency_phone, address)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [elderUID, req.caregiver.id, name, age || null, phone || null, photo_url || null, medical_notes || null, emergency_contact || null, emergency_phone || null, address || null]
  );

  res.status(201).json({ ...rows[0], photo_url: buildPhotoUrl(req, rows[0].photo_url) });
});

// PUT /api/elders/:id — update elder
router.put('/:id', auth, async (req, res) => {
  const { id } = req.params;
  const { name, age, phone, photo_url, medical_notes, emergency_contact, emergency_phone, address } = req.body;

  const check = await pool.query('SELECT id FROM elders WHERE id = $1 AND caregiver_id = $2', [id, req.caregiver.id]);
  if (!check.rows[0]) return res.status(404).json({ error: 'Elder not found' });

  const { rows } = await pool.query(
    `UPDATE elders SET
       name=COALESCE($1,name), age=COALESCE($2,age), phone=COALESCE($3,phone),
       photo_url=COALESCE($4,photo_url), medical_notes=COALESCE($5,medical_notes),
       emergency_contact=COALESCE($6,emergency_contact), emergency_phone=COALESCE($7,emergency_phone),
       address=COALESCE($8,address), updated_at=NOW()
     WHERE id=$9 AND caregiver_id=$10 RETURNING *`,
    [name, age, phone, photo_url, medical_notes, emergency_contact, emergency_phone, address, id, req.caregiver.id]
  );

  res.json({ ...rows[0], photo_url: buildPhotoUrl(req, rows[0].photo_url) });
});

// POST /api/elders/:id/photo — upload a photo for an elder
router.post('/:id/photo', auth, upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No photo file provided' });

  const check = await pool.query(
    'SELECT id, photo_url FROM elders WHERE id = $1 AND caregiver_id = $2',
    [req.params.id, req.caregiver.id]
  );
  if (!check.rows[0]) return res.status(404).json({ error: 'Elder not found' });

  // Delete old photo if it was a local file
  const oldUrl = check.rows[0].photo_url;
  if (oldUrl && !oldUrl.startsWith('http')) {
    const oldPath = path.join(__dirname, '../..', oldUrl);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }

  const photoPath = `/public/photos/${req.file.filename}`;
  const { rows } = await pool.query(
    'UPDATE elders SET photo_url = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
    [photoPath, req.params.id]
  );

  const base = process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`;
  res.json({ photo_url: `${base}${photoPath}` });
});

// DELETE /api/elders/:id
router.delete('/:id', auth, async (req, res) => {
  const result = await pool.query(
    'DELETE FROM elders WHERE id=$1 AND caregiver_id=$2 RETURNING id',
    [req.params.id, req.caregiver.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Elder not found' });
  res.json({ message: 'Elder deleted successfully' });
});

module.exports = router;
