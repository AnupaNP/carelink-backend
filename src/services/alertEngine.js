const pool = require('../db/pool');

// ─────────────────────────────────────────────────────────────
// Alert Engine — rule-based severity escalation
// ─────────────────────────────────────────────────────────────
async function generateAlerts(elderId, callId, analysis) {
  const {
    medications = [], meals = {}, mood, distress_flag,
    compliance_score, raw_concerns = [], mood_notes = '',
  } = analysis;

  const toCreate = [];

  // ── 🔴 URGENT: Distress or distressed mood ──────────────────
  if (distress_flag || mood === 'distressed') {
    toCreate.push({
      severity: 'URGENT',
      message: `⚠️ URGENT: Elder showed signs of distress during check-in call.${
        raw_concerns.length
          ? ' Reported concerns: ' + raw_concerns.slice(0, 3).join('; ') + '.'
          : ' Immediate caregiver attention required.'
      }`,
    });
  }

  // ── 🔴 HIGH: 2+ medications missed ──────────────────────────
  const missed = medications.filter(m => m.status === 'missed');
  if (missed.length >= 2) {
    toCreate.push({
      severity: 'HIGH',
      message: `Multiple medications missed: ${missed.map(m => m.name).join(', ')}. Elder may need immediate medication assistance.`,
    });
  } else if (missed.length === 1) {
    // ── 🟡 MEDIUM: 1 medication missed ────────────────────────
    toCreate.push({
      severity: 'MEDIUM',
      message: `Medication missed: ${missed[0].name} (scheduled ${missed[0].scheduled_time}). Please follow up with the elder.`,
    });
  }

  // ── 🔴 HIGH: 2+ meals skipped ───────────────────────────────
  const relevantMeals = Object.entries(meals).filter(([, v]) => v !== 'na');
  const skipped = relevantMeals.filter(([, v]) => v === 'skipped').map(([k]) => k);

  if (skipped.length >= 2) {
    toCreate.push({
      severity: 'HIGH',
      message: `Multiple meals skipped: ${skipped.join(', ')}. Elder may not be eating adequately. Please check nutrition.`,
    });
  } else if (skipped.length === 1) {
    toCreate.push({
      severity: 'LOW',
      message: `Meal skipped: ${skipped[0]}. Elder reported low appetite during check-in.`,
    });
  }

  // ── 🟡 MEDIUM: Low mood (not already flagged urgent) ────────
  if (mood === 'low' && !distress_flag) {
    toCreate.push({
      severity: 'MEDIUM',
      message: `Elder appears to be in low spirits during today's check-in.${
        mood_notes ? ' Note: ' + mood_notes : ' Consider scheduling a social visit or call.'
      }`,
    });
  }

  // ── 🟡 MEDIUM: Overall low compliance ───────────────────────
  if (compliance_score < 50 && toCreate.length === 0) {
    toCreate.push({
      severity: 'MEDIUM',
      message: `Low compliance score (${compliance_score}%) during check-in. Elder may need additional support with their daily routine.`,
    });
  }

  // ── 📋 LOW: Minor concerns only ──────────────────────────────
  if (raw_concerns.length > 0 && toCreate.length === 0) {
    toCreate.push({
      severity: 'LOW',
      message: `Minor concerns noted during check-in: ${raw_concerns.join('; ')}.`,
    });
  }

  // ── Insert all generated alerts ──────────────────────────────
  for (const alert of toCreate) {
    await pool.query(
      'INSERT INTO alerts (elder_id, call_id, severity, message) VALUES ($1, $2, $3, $4)',
      [elderId, callId, alert.severity, alert.message]
    );
  }

  if (toCreate.length > 0) {
    console.log(`🚨 Generated ${toCreate.length} alert(s) for elder ${elderId}`);
  } else {
    console.log(`✅ No alerts needed for elder ${elderId} — all checks passed`);
  }

  return toCreate;
}

module.exports = { generateAlerts };
