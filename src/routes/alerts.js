const express = require('express');
const pool = require('../db/pool');
const auth = require('../middleware/auth');

const router = express.Router();

// PATCH /api/alerts/read-all — must be before /:id routes
router.patch('/read-all', auth, async (req, res) => {
  const { elder_id } = req.body;
  if (elder_id) {
    await pool.query(
      `UPDATE alerts a SET is_read = TRUE FROM elders e
       WHERE a.elder_id = e.id AND a.elder_id = $1 AND e.caregiver_id = $2`,
      [elder_id, req.caregiver.id]
    );
  } else {
    await pool.query(
      `UPDATE alerts a SET is_read = TRUE FROM elders e
       WHERE a.elder_id = e.id AND e.caregiver_id = $1`,
      [req.caregiver.id]
    );
  }
  res.json({ message: 'Alerts marked as read' });
});

// GET /api/alerts
router.get('/', auth, async (req, res) => {
  const { elder_id, severity, unread_only, limit = 50, offset = 0 } = req.query;

  let conditions = ['e.caregiver_id = $1'];
  let params = [req.caregiver.id];
  let idx = 2;

  if (elder_id) { conditions.push(`a.elder_id = $${idx++}`); params.push(elder_id); }
  if (severity) { conditions.push(`a.severity = $${idx++}`); params.push(severity.toUpperCase()); }
  if (unread_only === 'true') conditions.push('a.is_read = FALSE');

  params.push(parseInt(limit), parseInt(offset));
  const limitIdx = idx; const offsetIdx = idx + 1;

  const { rows } = await pool.query(
    `SELECT a.*, e.name AS elder_name, e.elder_uid, e.photo_url AS elder_photo
     FROM alerts a JOIN elders e ON e.id = a.elder_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY a.created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params
  );

  res.json(rows);
});

// PATCH /api/alerts/:id/read
router.patch('/:id/read', auth, async (req, res) => {
  const result = await pool.query(
    `UPDATE alerts a SET is_read = TRUE FROM elders e
     WHERE a.elder_id = e.id AND a.id = $1 AND e.caregiver_id = $2 RETURNING a.*`,
    [req.params.id, req.caregiver.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Alert not found' });
  res.json(result.rows[0]);
});

module.exports = router;
