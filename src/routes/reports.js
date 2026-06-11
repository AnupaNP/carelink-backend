const express = require('express');
const pool = require('../db/pool');
const auth = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/reports/elder/:id
 * Returns a full HTML health report for an elder covering the last 7 days.
 * The app opens this in an in-app browser.
 */
router.get('/elder/:id', auth, async (req, res) => {
  const { id } = req.params;

  const elderRes = await pool.query(
    'SELECT * FROM elders WHERE id = $1 AND caregiver_id = $2',
    [id, req.caregiver.id]
  );
  if (!elderRes.rows[0]) return res.status(404).json({ error: 'Elder not found' });
  const elder = elderRes.rows[0];

  const [callsRes, alertsRes, schedRes, weeklyRes] = await Promise.all([
    pool.query(
      `SELECT call_timestamp, duration_seconds, status, llm_analysis
       FROM calls WHERE elder_id = $1 AND status = 'completed'
       ORDER BY call_timestamp DESC LIMIT 7`,
      [id]
    ),
    pool.query(
      `SELECT severity, message, created_at FROM alerts
       WHERE elder_id = $1 AND created_at >= NOW() - INTERVAL '7 days'
       ORDER BY created_at DESC`,
      [id]
    ),
    pool.query(
      'SELECT * FROM schedules WHERE elder_id = $1 AND is_active = TRUE ORDER BY type, scheduled_time',
      [id]
    ),
    pool.query(
      `SELECT DATE(call_timestamp) AS call_date,
         ROUND(AVG((llm_analysis->>'compliance_score')::numeric)) AS avg_score
       FROM calls WHERE elder_id = $1 AND status = 'completed'
         AND call_timestamp >= NOW() - INTERVAL '7 days'
       GROUP BY DATE(call_timestamp) ORDER BY call_date ASC`,
      [id]
    ),
  ]);

  const calls = callsRes.rows;
  const alerts = alertsRes.rows;
  const schedules = schedRes.rows;
  const weekly = weeklyRes.rows;

  const avgCompliance = weekly.length > 0
    ? Math.round(weekly.reduce((s, r) => s + Number(r.avg_score || 0), 0) / weekly.length)
    : null;

  const severityColor = { URGENT: '#EF4444', HIGH: '#F97316', MEDIUM: '#F59E0B', LOW: '#4E8EFF' };

  const callRows = calls.map(c => {
    const a = c.llm_analysis || {};
    const score = a.compliance_score;
    const scoreColor = score >= 80 ? '#3ECF8E' : score >= 50 ? '#F59E0B' : '#EF4444';
    const moodEmoji = { positive: '😊', neutral: '😐', low: '😟', distressed: '😰' }[a.mood] || '—';
    return `
      <tr>
        <td>${new Date(c.call_timestamp).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</td>
        <td style="color:${scoreColor};font-weight:700">${score != null ? score + '%' : '—'}</td>
        <td>${moodEmoji} ${a.mood || '—'}</td>
        <td>${a.distress_flag ? '🚨 Yes' : '✅ No'}</td>
        <td style="max-width:260px;font-size:12px">${a.summary || '—'}</td>
      </tr>`;
  }).join('');

  const alertRows = alerts.map(al => `
    <tr>
      <td>${new Date(al.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
      <td><span style="color:${severityColor[al.severity] || '#fff'};font-weight:800">${al.severity}</span></td>
      <td style="font-size:13px">${al.message}</td>
    </tr>`).join('');

  const scheduleRows = schedules.map(s => {
    const icons = { medication: '💊', meal: '🍽️', activity: '🏃' };
    return `<tr>
      <td>${icons[s.type] || '📋'} ${s.label}</td>
      <td style="text-transform:capitalize">${s.type}</td>
      <td>${s.scheduled_time?.slice(0, 5)}</td>
      <td style="text-transform:capitalize">${s.recurrence}</td>
    </tr>`;
  }).join('');

  const complianceColor = avgCompliance == null ? '#888' : avgCompliance >= 80 ? '#3ECF8E' : avgCompliance >= 50 ? '#F59E0B' : '#EF4444';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>CareLink Report — ${elder.name}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #050B18; color: #E2E8F0; padding: 24px; }
  .header { background: linear-gradient(135deg, #0F1B2D, #1A2940); border: 1px solid #1E3A5F; border-radius: 20px; padding: 28px; margin-bottom: 24px; }
  .elder-name { font-size: 28px; font-weight: 800; color: #fff; }
  .elder-meta { color: #94A3B8; margin-top: 6px; font-size: 14px; }
  .badge { display: inline-block; background: rgba(78,142,255,0.15); color: #4E8EFF; border: 1px solid #4E8EFF; border-radius: 12px; padding: 4px 14px; font-size: 12px; font-weight: 700; margin-top: 12px; }
  .stats-row { display: flex; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
  .stat-card { flex: 1; min-width: 120px; background: #0F1B2D; border: 1px solid #1E3A5F; border-radius: 16px; padding: 20px; text-align: center; }
  .stat-num { font-size: 36px; font-weight: 800; }
  .stat-label { font-size: 12px; color: #94A3B8; margin-top: 6px; }
  .section { background: #0F1B2D; border: 1px solid #1E3A5F; border-radius: 16px; padding: 20px; margin-bottom: 20px; }
  .section-title { font-size: 16px; font-weight: 700; color: #fff; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; color: #64748B; font-weight: 600; padding: 8px 10px; border-bottom: 1px solid #1E3A5F; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
  td { padding: 12px 10px; border-bottom: 1px solid #0F1B2D; color: #CBD5E1; vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  .footer { text-align: center; color: #475569; font-size: 12px; margin-top: 32px; }
  .report-date { color: #64748B; font-size: 13px; margin-top: 8px; }
  @media print { body { background: #fff; color: #1a1a1a; } .section, .stat-card, .header { border-color: #ccc; background: #f9f9f9; } }
</style>
</head>
<body>
<div class="header">
  <div class="elder-name">👴 ${elder.name}</div>
  <div class="elder-meta">${elder.elder_uid}${elder.age ? ' · Age ' + elder.age : ''}${elder.phone ? ' · ' + elder.phone : ''}</div>
  <div class="badge">📋 7-Day Health Report</div>
  <div class="report-date">Generated: ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>
</div>

<div class="stats-row">
  <div class="stat-card">
    <div class="stat-num" style="color:${complianceColor}">${avgCompliance != null ? avgCompliance + '%' : '—'}</div>
    <div class="stat-label">Avg Compliance (7d)</div>
  </div>
  <div class="stat-card">
    <div class="stat-num">${calls.length}</div>
    <div class="stat-label">Calls This Week</div>
  </div>
  <div class="stat-card">
    <div class="stat-num" style="color:${alerts.filter(a => a.severity === 'URGENT' || a.severity === 'HIGH').length > 0 ? '#EF4444' : '#3ECF8E'}">${alerts.filter(a => a.severity === 'URGENT' || a.severity === 'HIGH').length}</div>
    <div class="stat-label">High Priority Alerts</div>
  </div>
  <div class="stat-card">
    <div class="stat-num">${schedules.length}</div>
    <div class="stat-label">Active Schedules</div>
  </div>
</div>

${callRows ? `
<div class="section">
  <div class="section-title">📞 Call History (Last 7 Days)</div>
  <table>
    <thead><tr><th>Date</th><th>Compliance</th><th>Mood</th><th>Distress</th><th>Summary</th></tr></thead>
    <tbody>${callRows}</tbody>
  </table>
</div>` : ''}

${alertRows ? `
<div class="section">
  <div class="section-title">🚨 Alerts (Last 7 Days)</div>
  <table>
    <thead><tr><th>Time</th><th>Severity</th><th>Message</th></tr></thead>
    <tbody>${alertRows}</tbody>
  </table>
</div>` : ''}

${scheduleRows ? `
<div class="section">
  <div class="section-title">📅 Daily Schedule</div>
  <table>
    <thead><tr><th>Item</th><th>Type</th><th>Time</th><th>Frequency</th></tr></thead>
    <tbody>${scheduleRows}</tbody>
  </table>
</div>` : ''}

${elder.medical_notes ? `
<div class="section">
  <div class="section-title">🏥 Medical Notes</div>
  <p style="color:#94A3B8;font-size:14px;line-height:1.6">${elder.medical_notes}</p>
</div>` : ''}

<div class="footer">
  <p>CareLink · AI-Powered Elderly Care Platform</p>
  <p style="margin-top:4px">Powered by Gemini AI · Neon PostgreSQL</p>
</div>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

module.exports = router;
