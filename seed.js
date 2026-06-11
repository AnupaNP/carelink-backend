/**
 * CareLink — Database Seed Script
 * Populates Neon PostgreSQL with schema + demo data:
 *   - 5 caregivers (demo login users)
 *   - 5 elders with AI-generated photos
 *   - Schedules per elder
 *   - Pre-computed calls + LLM analysis
 *   - Pre-generated alerts
 *
 * Run: node seed.js
 */

require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';

// ── Pre-hashed password for all demo users: CareLink@123 ─────
const PASSWORD = 'CareLink@123';

// ─────────────────────────────────────────────────────────────
// SEED DATA
// ─────────────────────────────────────────────────────────────

const CAREGIVERS = [
  { name: 'Sarah Mitchell',  email: 'sarah@carelink.com',  phone: '+1-555-0101' },
  { name: 'James Okafor',    email: 'james@carelink.com',  phone: '+1-555-0102' },
  { name: 'Priya Sharma',    email: 'priya@carelink.com',  phone: '+1-555-0103' },
  { name: 'Elena Vasquez',   email: 'elena@carelink.com',  phone: '+1-555-0104' },
  { name: 'David Chen',      email: 'david@carelink.com',  phone: '+1-555-0105' },
];

// Photo paths — served from /public/elders/ by Express
const ELDER_PHOTOS = {
  margaret: '/public/elders/margaret.png',
  robert:   '/public/elders/robert.png',
  dorothy:  '/public/elders/dorothy.png',
  harold:   '/public/elders/harold.png',
  grace:    '/public/elders/grace.png',
};

// ─────────────────────────────────────────────────────────────
// PRE-COMPUTED LLM ANALYSES
// ─────────────────────────────────────────────────────────────
const ANALYSES = {
  positive: {
    medications: [
      { name: 'Metformin 500mg', scheduled_time: '08:00', status: 'taken' },
      { name: 'Amlodipine 5mg',  scheduled_time: '08:00', status: 'taken' },
    ],
    meals: { breakfast: 'eaten', lunch: 'na', dinner: 'na' },
    mood: 'positive',
    mood_notes: 'Elder is cheerful and in high spirits, looking forward to a family visit.',
    distress_flag: false,
    compliance_score: 96,
    summary: 'Excellent check-in — all morning medications taken, nutritious breakfast eaten, no pain or complaints. Family visit planned this weekend.',
    raw_concerns: [],
  },
  concerned: {
    medications: [
      { name: 'Metformin 500mg', scheduled_time: '08:00', status: 'missed' },
      { name: 'Amlodipine 5mg',  scheduled_time: '08:00', status: 'missed' },
    ],
    meals: { breakfast: 'skipped', lunch: 'na', dinner: 'na' },
    mood: 'low',
    mood_notes: 'Elder expressed loneliness and low energy. Reports difficulty sleeping and loss of appetite.',
    distress_flag: false,
    compliance_score: 18,
    summary: 'Concerning check-in: all morning medications missed, breakfast skipped, and elder reports dizziness, headache, and feelings of loneliness. Immediate caregiver follow-up recommended.',
    raw_concerns: ['Missed all morning medications', 'Skipped breakfast', 'Feeling dizzy and has a headache', 'Reports loneliness and low mood', 'Poor sleep quality'],
  },
  urgent: {
    medications: [
      { name: 'Warfarin 5mg',     scheduled_time: '09:00', status: 'missed' },
      { name: 'Metoprolol 25mg',  scheduled_time: '09:00', status: 'missed' },
    ],
    meals: { breakfast: 'skipped', lunch: 'na', dinner: 'na' },
    mood: 'distressed',
    mood_notes: 'Elder reported severe chest pain and shortness of breath. Expressed significant fear and said she could not get out of bed.',
    distress_flag: true,
    compliance_score: 0,
    summary: '🚨 URGENT: Elder reported severe chest pain and shortness of breath since early morning. Cannot get out of bed, expressed fear and distress. Emergency response required immediately.',
    raw_concerns: ['Severe chest pain since early morning', 'Shortness of breath and difficulty breathing', 'Unable to get out of bed since last night', 'Expressed fear and significant distress', 'All medications missed', 'No food or drink all day'],
  },
  mixed: {
    medications: [
      { name: 'Atorvastatin 20mg', scheduled_time: '08:00', status: 'taken' },
      { name: 'Donepezil 5mg',     scheduled_time: '21:00', status: 'na'   },
    ],
    meals: { breakfast: 'skipped', lunch: 'partial', dinner: 'na' },
    mood: 'low',
    mood_notes: 'Elder expressed loneliness and low motivation. Skipped exercises and reports back pain.',
    distress_flag: false,
    compliance_score: 52,
    summary: 'Mixed check-in: morning medication taken but breakfast skipped. Elder reports loneliness, back pain, and skipped afternoon exercises. Low mood noted.',
    raw_concerns: ['Skipped breakfast', 'Partial lunch only', 'Reports loneliness', 'Lower back pain', 'Skipped afternoon exercises', 'Legs feel heavy'],
  },
  good: {
    medications: [
      { name: 'Spiriva Inhaler',  scheduled_time: '08:00', status: 'taken' },
      { name: 'Ramipril 10mg',    scheduled_time: '08:00', status: 'taken' },
    ],
    meals: { breakfast: 'eaten', lunch: 'eaten', dinner: 'na' },
    mood: 'positive',
    mood_notes: 'Elder in positive mood, engaged in conversation, no complaints.',
    distress_flag: false,
    compliance_score: 90,
    summary: 'Good check-in — all medications taken, both meals eaten, elder is in positive spirits with no concerns reported.',
    raw_concerns: [],
  },
};

// ─────────────────────────────────────────────────────────────
// HELPER: run schema SQL
// ─────────────────────────────────────────────────────────────
async function runSchema() {
  console.log('📐 Running schema...');
  const schemaPath = path.join(__dirname, 'src/db/schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(schemaSql);
  console.log('✅ Schema applied');
}

// ─────────────────────────────────────────────────────────────
// HELPER: clear existing data (for re-seeding)
// ─────────────────────────────────────────────────────────────
async function clearData() {
  console.log('🗑️  Clearing existing data...');
  await pool.query('DELETE FROM alerts');
  await pool.query('DELETE FROM calls');
  await pool.query('DELETE FROM schedules');
  await pool.query('DELETE FROM elders');
  await pool.query('DELETE FROM caregivers');
  console.log('✅ Data cleared');
}

// ─────────────────────────────────────────────────────────────
// MAIN SEED
// ─────────────────────────────────────────────────────────────
async function seed() {
  try {
    await runSchema();
    await clearData();

    const passwordHash = bcrypt.hashSync(PASSWORD, 10);
    console.log('\n👥 Inserting caregivers...');

    const caregiverIds = {};
    for (const cg of CAREGIVERS) {
      const { rows } = await pool.query(
        `INSERT INTO caregivers (name, email, password_hash, phone)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [cg.name, cg.email, passwordHash, cg.phone]
      );
      caregiverIds[cg.email] = rows[0].id;
      console.log(`  ✅ ${cg.name} (${cg.email})`);
    }

    const sarahId = caregiverIds['sarah@carelink.com'];
    const jamesId = caregiverIds['james@carelink.com'];
    const priyaId = caregiverIds['priya@carelink.com'];

    // ── INSERT ELDERS ─────────────────────────────────────────
    console.log('\n👴 Inserting elders...');

    // Elder 1: Margaret Thompson (Sarah's)
    const { rows: [margaret] } = await pool.query(
      `INSERT INTO elders (elder_uid, caregiver_id, name, age, phone, photo_url, medical_notes, emergency_contact, emergency_phone)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      ['ELD-MRG001', sarahId, 'Margaret Thompson', 78, '+1-555-2001', ELDER_PHOTOS.margaret,
       'Type 2 Diabetes (Metformin 500mg), Hypertension (Amlodipine 5mg). Allergic to penicillin. Hip replacement surgery in 2021.',
       'Linda Thompson (Daughter)', '+1-555-3001']
    );

    // Elder 2: Robert Wilson (Sarah's)
    const { rows: [robert] } = await pool.query(
      `INSERT INTO elders (elder_uid, caregiver_id, name, age, phone, photo_url, medical_notes, emergency_contact, emergency_phone)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      ['ELD-RBT002', sarahId, 'Robert Wilson', 82, '+1-555-2002', ELDER_PHOTOS.robert,
       'Atrial Fibrillation (Warfarin 5mg), Heart Failure (Metoprolol 25mg). Monthly INR checks required. Low-sodium diet.',
       'Michael Wilson (Son)', '+1-555-3002']
    );

    // Elder 3: Dorothy Chen (Sarah's)
    const { rows: [dorothy] } = await pool.query(
      `INSERT INTO elders (elder_uid, caregiver_id, name, age, phone, photo_url, medical_notes, emergency_contact, emergency_phone)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      ['ELD-DRT003', sarahId, 'Dorothy Chen', 75, '+1-555-2003', ELDER_PHOTOS.dorothy,
       'Mild Cognitive Impairment (Donepezil 5mg), High Cholesterol (Atorvastatin 20mg). Gentle memory exercises recommended daily.',
       'Susan Chen (Daughter)', '+1-555-3003']
    );

    // Elder 4: Harold Johnson (James's)
    const { rows: [harold] } = await pool.query(
      `INSERT INTO elders (elder_uid, caregiver_id, name, age, phone, photo_url, medical_notes, emergency_contact, emergency_phone)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      ['ELD-HRL004', jamesId, 'Harold Johnson', 80, '+1-555-2004', ELDER_PHOTOS.harold,
       'COPD (Spiriva Inhaler daily), Hypertension (Ramipril 10mg). Requires supplemental oxygen at night. No strenuous exercise.',
       'Patricia Johnson (Wife)', '+1-555-3004']
    );

    // Elder 5: Grace Patel (Priya's)
    const { rows: [grace] } = await pool.query(
      `INSERT INTO elders (elder_uid, caregiver_id, name, age, phone, photo_url, medical_notes, emergency_contact, emergency_phone)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      ['ELD-GRC005', priyaId, 'Grace Patel', 76, '+1-555-2005', ELDER_PHOTOS.grace,
       'Osteoporosis (Calcium + Vit D supplement), Type 2 Diabetes (Metformin 1000mg twice daily). Fall risk — non-slip mats installed.',
       'Raj Patel (Son)', '+1-555-3005']
    );

    console.log(`  ✅ Margaret Thompson | Robert Wilson | Dorothy Chen | Harold Johnson | Grace Patel`);

    // ── INSERT SCHEDULES ──────────────────────────────────────
    console.log('\n📅 Inserting schedules...');

    const scheduleData = [
      // Margaret
      { elder_id: margaret.id, type: 'medication', label: 'Metformin 500mg', scheduled_time: '08:00', notes: 'Take with breakfast' },
      { elder_id: margaret.id, type: 'medication', label: 'Amlodipine 5mg',  scheduled_time: '08:00', notes: 'Take with breakfast' },
      { elder_id: margaret.id, type: 'meal',       label: 'Breakfast',        scheduled_time: '08:30' },
      { elder_id: margaret.id, type: 'meal',       label: 'Lunch',            scheduled_time: '12:30' },
      { elder_id: margaret.id, type: 'meal',       label: 'Dinner',           scheduled_time: '18:30' },
      { elder_id: margaret.id, type: 'activity',   label: 'Morning Walk',     scheduled_time: '09:15', notes: '15–20 minutes, flat ground only' },
      // Robert
      { elder_id: robert.id, type: 'medication', label: 'Warfarin 5mg',    scheduled_time: '09:00', notes: 'Take at same time daily; avoid vitamin K-rich foods' },
      { elder_id: robert.id, type: 'medication', label: 'Metoprolol 25mg', scheduled_time: '09:00', notes: 'Do not crush or chew' },
      { elder_id: robert.id, type: 'meal',       label: 'Breakfast',       scheduled_time: '08:00', notes: 'Low sodium; no added salt' },
      { elder_id: robert.id, type: 'meal',       label: 'Lunch',           scheduled_time: '12:00', notes: 'Low sodium' },
      { elder_id: robert.id, type: 'meal',       label: 'Dinner',          scheduled_time: '18:00', notes: 'Low sodium' },
      { elder_id: robert.id, type: 'activity',   label: 'Physical Therapy Exercises', scheduled_time: '10:00', recurrence: 'weekdays' },
      // Dorothy
      { elder_id: dorothy.id, type: 'medication', label: 'Atorvastatin 20mg', scheduled_time: '08:00' },
      { elder_id: dorothy.id, type: 'medication', label: 'Donepezil 5mg',     scheduled_time: '21:00', notes: 'Best taken at bedtime' },
      { elder_id: dorothy.id, type: 'meal',       label: 'Breakfast',         scheduled_time: '08:00' },
      { elder_id: dorothy.id, type: 'meal',       label: 'Lunch',             scheduled_time: '12:00' },
      { elder_id: dorothy.id, type: 'meal',       label: 'Dinner',            scheduled_time: '18:00' },
      { elder_id: dorothy.id, type: 'activity',   label: 'Memory Exercises',  scheduled_time: '15:00', notes: 'Puzzles or reading' },
      // Harold
      { elder_id: harold.id, type: 'medication', label: 'Spiriva Inhaler', scheduled_time: '08:00', notes: 'One puff daily; rinse mouth after' },
      { elder_id: harold.id, type: 'medication', label: 'Ramipril 10mg',   scheduled_time: '08:00', notes: 'Take with water' },
      { elder_id: harold.id, type: 'meal',       label: 'Breakfast',       scheduled_time: '08:30' },
      { elder_id: harold.id, type: 'meal',       label: 'Lunch',           scheduled_time: '12:30' },
      { elder_id: harold.id, type: 'meal',       label: 'Dinner',          scheduled_time: '18:30' },
      // Grace
      { elder_id: grace.id, type: 'medication', label: 'Calcium + Vit D Supplement', scheduled_time: '08:00', notes: 'Take with food' },
      { elder_id: grace.id, type: 'medication', label: 'Metformin 1000mg (morning)',  scheduled_time: '08:00', notes: 'Take with breakfast' },
      { elder_id: grace.id, type: 'medication', label: 'Metformin 1000mg (evening)',  scheduled_time: '20:00', notes: 'Take with dinner' },
      { elder_id: grace.id, type: 'meal',       label: 'Breakfast',                   scheduled_time: '08:30' },
      { elder_id: grace.id, type: 'meal',       label: 'Lunch',                       scheduled_time: '13:00' },
      { elder_id: grace.id, type: 'meal',       label: 'Dinner',                      scheduled_time: '19:00' },
      { elder_id: grace.id, type: 'activity',   label: 'Gentle Stretching',            scheduled_time: '09:30', notes: 'Seated exercises; avoid high-impact' },
    ];

    for (const s of scheduleData) {
      await pool.query(
        `INSERT INTO schedules (elder_id, type, label, scheduled_time, recurrence, notes)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [s.elder_id, s.type, s.label, s.scheduled_time, s.recurrence || 'daily', s.notes || null]
      );
    }
    console.log(`  ✅ ${scheduleData.length} schedule items inserted`);

    // ── INSERT CALLS + ALERTS ─────────────────────────────────
    console.log('\n📞 Inserting calls with pre-computed analyses...');

    async function insertCall(elderId, daysAgo, scenario, hoursOffset = 8) {
      const ts = new Date();
      ts.setDate(ts.getDate() - daysAgo);
      ts.setHours(hoursOffset, Math.floor(Math.random() * 30), 0, 0);

      const transcript = {
        duration_seconds: 185 + Math.floor(Math.random() * 60),
        scenario,
        turns: [], // placeholder — real scenarios are stored in calls route
      };

      const analysis = ANALYSES[scenario];

      const { rows: [call] } = await pool.query(
        `INSERT INTO calls (elder_id, call_timestamp, duration_seconds, raw_transcript, llm_analysis, status)
         VALUES ($1,$2,$3,$4,$5,'completed') RETURNING *`,
        [elderId, ts.toISOString(), transcript.duration_seconds, JSON.stringify(transcript), JSON.stringify(analysis)]
      );

      // Generate alerts from analysis
      const { generateAlerts } = require('./src/services/alertEngine');
      await generateAlerts(elderId, call.id, analysis);

      return call;
    }

    // Margaret: 3 calls — positive 3 days ago, concerned 2 days ago, urgent yesterday
    await insertCall(margaret.id, 3, 'positive');
    await insertCall(margaret.id, 2, 'concerned');
    await insertCall(margaret.id, 1, 'urgent');

    // Robert: 2 calls — urgent 2 days ago, mixed yesterday
    await insertCall(robert.id, 2, 'urgent', 9);
    await insertCall(robert.id, 1, 'mixed', 14);

    // Dorothy: 2 calls — concerned 2 days ago, positive yesterday
    await insertCall(dorothy.id, 2, 'concerned', 10);
    await insertCall(dorothy.id, 1, 'positive', 8);

    // Harold: 2 calls — good 2 days ago, mixed yesterday
    await insertCall(harold.id, 2, 'good', 9);
    await insertCall(harold.id, 1, 'mixed', 14);

    // Grace: 2 calls — positive 3 days ago, good yesterday
    await insertCall(grace.id, 3, 'positive', 8);
    await insertCall(grace.id, 1, 'good', 9);

    console.log('  ✅ All calls and alerts inserted');

    // ── SUMMARY ───────────────────────────────────────────────
    const { rows: [{ count: cgCount }]  } = await pool.query('SELECT COUNT(*) FROM caregivers');
    const { rows: [{ count: elCount }]  } = await pool.query('SELECT COUNT(*) FROM elders');
    const { rows: [{ count: scCount }]  } = await pool.query('SELECT COUNT(*) FROM schedules');
    const { rows: [{ count: clCount }]  } = await pool.query('SELECT COUNT(*) FROM calls');
    const { rows: [{ count: alCount }]  } = await pool.query('SELECT COUNT(*) FROM alerts');

    console.log(`
╔═══════════════════════════════════════╗
║       CareLink Seed Complete! 🏥      ║
╠═══════════════════════════════════════╣
║  Caregivers : ${String(cgCount).padStart(3)}                     ║
║  Elders     : ${String(elCount).padStart(3)}                     ║
║  Schedules  : ${String(scCount).padStart(3)}                     ║
║  Calls      : ${String(clCount).padStart(3)}                     ║
║  Alerts     : ${String(alCount).padStart(3)}                     ║
╠═══════════════════════════════════════╣
║  Login credentials (all users):       ║
║  Password: CareLink@123               ║
╠═══════════════════════════════════════╣
║  sarah@carelink.com  → 3 elders       ║
║  james@carelink.com  → 1 elder        ║
║  priya@carelink.com  → 1 elder        ║
╚═══════════════════════════════════════╝
`);

  } catch (err) {
    console.error('❌ Seed failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seed();
