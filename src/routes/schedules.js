const express = require('express');
const pool = require('../db/pool');
const auth = require('../middleware/auth');

const router = express.Router();

// GET /api/schedules?elder_id=xxx
router.get('/', auth, async (req, res) => {
  const { elder_id } = req.query;
  if (!elder_id) return res.status(400).json({ error: 'elder_id is required' });

  const check = await pool.query(
    'SELECT id FROM elders WHERE id = $1 AND caregiver_id = $2',
    [elder_id, req.caregiver.id]
  );
  if (!check.rows[0]) return res.status(404).json({ error: 'Elder not found' });

  const { rows } = await pool.query(
    'SELECT * FROM schedules WHERE elder_id = $1 ORDER BY type, scheduled_time ASC',
    [elder_id]
  );
  res.json(rows);
});

// POST /api/schedules
router.post('/', auth, async (req, res) => {
  const { elder_id, type, label, scheduled_time, recurrence, notes } = req.body;
  if (!elder_id || !type || !label || !scheduled_time) {
    return res.status(400).json({ error: 'elder_id, type, label, scheduled_time are required' });
  }

  const check = await pool.query(
    'SELECT id FROM elders WHERE id = $1 AND caregiver_id = $2',
    [elder_id, req.caregiver.id]
  );
  if (!check.rows[0]) return res.status(404).json({ error: 'Elder not found' });

  const { rows } = await pool.query(
    `INSERT INTO schedules (elder_id, type, label, scheduled_time, recurrence, notes)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [elder_id, type, label, scheduled_time, recurrence || 'daily', notes || null]
  );
  res.status(201).json(rows[0]);
});

// PUT /api/schedules/:id
router.put('/:id', auth, async (req, res) => {
  const { id } = req.params;
  const { type, label, scheduled_time, recurrence, notes, is_active } = req.body;

  const check = await pool.query(
    `SELECT s.id FROM schedules s JOIN elders e ON e.id = s.elder_id
     WHERE s.id = $1 AND e.caregiver_id = $2`,
    [id, req.caregiver.id]
  );
  if (!check.rows[0]) return res.status(404).json({ error: 'Schedule not found' });

  const { rows } = await pool.query(
    `UPDATE schedules SET
       type=COALESCE($1,type), label=COALESCE($2,label),
       scheduled_time=COALESCE($3,scheduled_time), recurrence=COALESCE($4,recurrence),
       notes=COALESCE($5,notes), is_active=COALESCE($6,is_active), updated_at=NOW()
     WHERE id=$7 RETURNING *`,
    [type, label, scheduled_time, recurrence, notes, is_active, id]
  );
  res.json(rows[0]);
});

// DELETE /api/schedules/:id
router.delete('/:id', auth, async (req, res) => {
  const result = await pool.query(
    `DELETE FROM schedules s USING elders e
     WHERE s.elder_id = e.id AND s.id = $1 AND e.caregiver_id = $2
     RETURNING s.id`,
    [req.params.id, req.caregiver.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Schedule not found' });
  res.json({ message: 'Schedule deleted' });
});

module.exports = router;
