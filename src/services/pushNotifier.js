// ─────────────────────────────────────────────────────────────
// Expo Push Notifier — sends push alerts to caregiver devices
// ─────────────────────────────────────────────────────────────
const pool = require('../db/pool');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/**
 * Send a push notification to the caregiver of the given elder.
 * Falls back silently if no push token is saved.
 */
async function sendPushAlert(elderId, title, body, data = {}) {
  try {
    // Look up the caregiver's push token
    const result = await pool.query(
      `SELECT c.expo_push_token FROM caregivers c
       JOIN elders e ON e.caregiver_id = c.id
       WHERE e.id = $1 AND c.expo_push_token IS NOT NULL`,
      [elderId]
    );
    const token = result.rows[0]?.expo_push_token;
    if (!token) return; // No token saved — skip silently

    const message = {
      to: token,
      sound: 'default',
      title,
      body,
      data,
      priority: 'high',
      channelId: 'carelink-alerts',
    };

    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });

    const json = await response.json();
    if (json.data?.status === 'error') {
      console.warn(`⚠️ Push notification error for elder ${elderId}:`, json.data.message);
    } else {
      console.log(`📲 Push notification sent for elder ${elderId}: "${title}"`);
    }
  } catch (err) {
    // Never throw — push failures should not block call processing
    console.warn(`⚠️ Push notification failed (non-critical):`, err.message);
  }
}

/**
 * Send push alerts based on generated alerts array.
 * Only sends for URGENT and HIGH severity to avoid notification fatigue.
 */
async function notifyFromAlerts(elderId, elderName, alerts = []) {
  const urgent = alerts.filter(a => a.severity === 'URGENT');
  const high = alerts.filter(a => a.severity === 'HIGH');

  if (urgent.length > 0) {
    await sendPushAlert(
      elderId,
      `🚨 URGENT: ${elderName}`,
      urgent[0].message.replace(/^⚠️ URGENT: /, '').slice(0, 120),
      { elderId, severity: 'URGENT' }
    );
  } else if (high.length > 0) {
    await sendPushAlert(
      elderId,
      `⚠️ Alert: ${elderName}`,
      high[0].message.slice(0, 120),
      { elderId, severity: 'HIGH' }
    );
  }
}

module.exports = { sendPushAlert, notifyFromAlerts };
