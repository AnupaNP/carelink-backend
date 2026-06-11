const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const auth = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { name, email, password, phone } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const existing = await pool.query(
    'SELECT id FROM caregivers WHERE email = $1',
    [email.toLowerCase().trim()]
  );
  if (existing.rows[0]) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }

  const password_hash = await bcrypt.hash(password, 12);
  const { rows } = await pool.query(
    `INSERT INTO caregivers (name, email, password_hash, phone)
     VALUES ($1, $2, $3, $4) RETURNING id, name, email, phone, avatar_url`,
    [name.trim(), email.toLowerCase().trim(), password_hash, phone || null]
  );
  const caregiver = rows[0];

  const token = jwt.sign(
    { id: caregiver.id, email: caregiver.email, name: caregiver.name },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.status(201).json({ token, caregiver });
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const { rows } = await pool.query(
    'SELECT * FROM caregivers WHERE email = $1',
    [email.toLowerCase().trim()]
  );
  const caregiver = rows[0];

  if (!caregiver || !(await bcrypt.compare(password, caregiver.password_hash))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = jwt.sign(
    { id: caregiver.id, email: caregiver.email, name: caregiver.name },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({
    token,
    caregiver: {
      id: caregiver.id,
      name: caregiver.name,
      email: caregiver.email,
      phone: caregiver.phone,
      avatar_url: caregiver.avatar_url,
    },
  });
});

// GET /api/auth/me — get current logged-in caregiver
router.get('/me', auth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, name, email, phone, avatar_url, created_at FROM caregivers WHERE id = $1',
    [req.caregiver.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Caregiver not found' });
  res.json(rows[0]);
});

// PATCH /api/auth/push-token — save Expo push notification token
router.patch('/push-token', auth, async (req, res) => {
  const { push_token } = req.body;
  if (!push_token) return res.status(400).json({ error: 'push_token is required' });
  await pool.query(
    'UPDATE caregivers SET expo_push_token = $1, updated_at = NOW() WHERE id = $2',
    [push_token, req.caregiver.id]
  );
  res.json({ message: 'Push token saved' });
});

module.exports = router;
