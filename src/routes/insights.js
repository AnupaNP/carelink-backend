const express = require('express');
const pool = require('../db/pool');
const auth = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/insights
 * Aggregated analytics across all elders for the logged-in caregiver.
 */
router.get('/', auth, async (req, res) => {
  const caregiverId = req.caregiver.id;

  const [
    elderStatsRes,
    trendRes,
    topConcernsRes,
    missedMedsRes,
    recentCallsRes,
  ] = await Promise.all([

    // Elder count + compliance average + status breakdown
    pool.query(
      `SELECT
         COUNT(e.id)::int AS total_elders,
         ROUND(AVG((c.llm_analysis->>'compliance_score')::numeric)) AS avg_compliance,
         COUNT(CASE WHEN (
           SELECT a2.severity FROM alerts a2 WHERE a2.elder_id = e.id AND a2.is_read = FALSE
           ORDER BY CASE a2.severity WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END LIMIT 1
         ) = 'URGENT' THEN 1 END)::int AS critical_count,
         COUNT(CASE WHEN (
           SELECT a2.severity FROM alerts a2 WHERE a2.elder_id = e.id AND a2.is_read = FALSE
           ORDER BY CASE a2.severity WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END LIMIT 1
         ) IN ('HIGH','MEDIUM') THEN 1 END)::int AS warning_count
       FROM elders e
       LEFT JOIN calls c ON c.elder_id = e.id AND c.status = 'completed'
         AND c.call_timestamp >= NOW() - INTERVAL '7 days'
       WHERE e.caregiver_id = $1`,
      [caregiverId]
    ),

    // 14-day daily compliance trend
    pool.query(
      `SELECT
         DATE(c.call_timestamp) AS call_date,
         ROUND(AVG((c.llm_analysis->>'compliance_score')::numeric)) AS avg_score,
         COUNT(*)::int AS call_count
       FROM calls c
       JOIN elders e ON e.id = c.elder_id
       WHERE e.caregiver_id = $1
         AND c.status = 'completed'
         AND c.call_timestamp >= NOW() - INTERVAL '14 days'
       GROUP BY DATE(c.call_timestamp)
       ORDER BY call_date ASC`,
      [caregiverId]
    ),

    // Top raw_concerns from last 7 days (JSON array aggregation)
    pool.query(
      `SELECT concern, COUNT(*)::int AS occurrences
       FROM (
         SELECT jsonb_array_elements_text(c.llm_analysis->'raw_concerns') AS concern
         FROM calls c
         JOIN elders e ON e.id = c.elder_id
         WHERE e.caregiver_id = $1
           AND c.status = 'completed'
           AND c.call_timestamp >= NOW() - INTERVAL '7 days'
       ) sub
       GROUP BY concern
       ORDER BY occurrences DESC
       LIMIT 8`,
      [caregiverId]
    ),

    // Most frequently missed medications (last 7 days)
    pool.query(
      `SELECT med->>'name' AS medication, COUNT(*)::int AS missed_count
       FROM calls c
       JOIN elders e ON e.id = c.elder_id,
       jsonb_array_elements(c.llm_analysis->'medications') AS med
       WHERE e.caregiver_id = $1
         AND c.status = 'completed'
         AND c.call_timestamp >= NOW() - INTERVAL '7 days'
         AND med->>'status' = 'missed'
       GROUP BY med->>'name'
       ORDER BY missed_count DESC
       LIMIT 5`,
      [caregiverId]
    ),

    // Recent calls count per elder
    pool.query(
      `SELECT
         e.name AS elder_name,
         e.id AS elder_id,
         COUNT(c.id)::int AS total_calls,
         ROUND(AVG((c.llm_analysis->>'compliance_score')::numeric)) AS avg_score
       FROM elders e
       LEFT JOIN calls c ON c.elder_id = e.id AND c.status = 'completed'
         AND c.call_timestamp >= NOW() - INTERVAL '7 days'
       WHERE e.caregiver_id = $1
       GROUP BY e.id, e.name
       ORDER BY avg_score ASC NULLS LAST
       LIMIT 5`,
      [caregiverId]
    ),
  ]);

  const stats = elderStatsRes.rows[0] || {};

  res.json({
    summary: {
      total_elders: stats.total_elders || 0,
      avg_compliance: stats.avg_compliance ? parseInt(stats.avg_compliance) : null,
      critical_count: stats.critical_count || 0,
      warning_count: stats.warning_count || 0,
      ok_count: (stats.total_elders || 0) - (stats.critical_count || 0) - (stats.warning_count || 0),
    },
    compliance_trend: trendRes.rows,
    top_concerns: topConcernsRes.rows,
    missed_medications: missedMedsRes.rows,
    elder_breakdown: recentCallsRes.rows,
  });
});

module.exports = router;
