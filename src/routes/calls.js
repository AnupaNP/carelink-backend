const express = require('express');
const pool = require('../db/pool');
const auth = require('../middleware/auth');
const { analyseCallTranscript } = require('../services/llmAnalyser');
const { generateAlerts } = require('../services/alertEngine');
const { notifyFromAlerts } = require('../services/pushNotifier');

const router = express.Router();

// ── Hardcoded demo transcripts ────────────────────────────────
const DEMO_TRANSCRIPTS = {
  positive: {
    duration_seconds: 185,
    turns: [
      { speaker: 'AI', text: "Good morning! This is your daily wellness check-in from CareLink. How are you feeling today?", timestamp: '08:02:00' },
      { speaker: 'ELDER', text: "Oh, I'm doing quite well, thank you! Had a very good night's sleep actually.", timestamp: '08:02:08' },
      { speaker: 'AI', text: "That's wonderful to hear! Have you taken your morning medications yet?", timestamp: '08:02:15' },
      { speaker: 'ELDER', text: "Yes, yes I took them right after breakfast. Had my Metformin and the blood pressure pill, Amlodipine.", timestamp: '08:02:24' },
      { speaker: 'AI', text: "Excellent! And what did you have for breakfast this morning?", timestamp: '08:02:32' },
      { speaker: 'ELDER', text: "I made some lovely oatmeal with blueberries and a cup of tea. Very filling!", timestamp: '08:02:39' },
      { speaker: 'AI', text: "That sounds delicious and nutritious! Any pain, dizziness, or discomfort today?", timestamp: '08:02:47' },
      { speaker: 'ELDER', text: "No pain at all. My knee felt a tiny bit stiff this morning but it went away after my morning walk.", timestamp: '08:02:56' },
      { speaker: 'AI', text: "Great to hear! How is your mood today?", timestamp: '08:03:04' },
      { speaker: 'ELDER', text: "I'm in very good spirits! My daughter called yesterday and she's visiting this weekend. I can't wait!", timestamp: '08:03:12' },
      { speaker: 'AI', text: "That sounds lovely! Is there anything you'd like your caregiver to know?", timestamp: '08:03:20' },
      { speaker: 'ELDER', text: "No, I think everything is just fine. Thank you for checking in, dear!", timestamp: '08:03:27' },
      { speaker: 'AI', text: "You're very welcome. Have a wonderful day! We'll check in again tomorrow.", timestamp: '08:03:34' },
    ],
  },
  concerned: {
    duration_seconds: 248,
    turns: [
      { speaker: 'AI', text: "Good morning! This is your daily wellness check-in from CareLink. How are you today?", timestamp: '09:05:00' },
      { speaker: 'ELDER', text: "Hmm, I've been better I suppose. Didn't sleep very well at all last night.", timestamp: '09:05:09' },
      { speaker: 'AI', text: "I'm sorry to hear that. Have you taken your morning medications?", timestamp: '09:05:16' },
      { speaker: 'ELDER', text: "Oh... I think I forgot them. Let me check... no, I don't think I took them this morning.", timestamp: '09:05:28' },
      { speaker: 'AI', text: "Please try to take them soon if your doctor hasn't said otherwise. What about last night's evening medication?", timestamp: '09:05:39' },
      { speaker: 'ELDER', text: "I honestly don't remember. I was so tired last night, I fell asleep on the couch.", timestamp: '09:05:50' },
      { speaker: 'AI', text: "I understand. Did you have breakfast this morning?", timestamp: '09:05:58' },
      { speaker: 'ELDER', text: "No, I didn't feel hungry. Just had some tea. My appetite hasn't been great lately.", timestamp: '09:06:08' },
      { speaker: 'AI', text: "It's important to eat, especially when taking medications. Are you feeling any pain or dizziness?", timestamp: '09:06:17' },
      { speaker: 'ELDER', text: "A little dizzy actually, now that you mention it. And I have a bit of a headache.", timestamp: '09:06:27' },
      { speaker: 'AI', text: "I'll make sure your caregiver is notified about this right away. How is your mood today?", timestamp: '09:06:36' },
      { speaker: 'ELDER', text: "Honestly, I'm feeling quite low. These days feel very long and lonely.", timestamp: '09:06:46' },
      { speaker: 'AI', text: "I'm sorry to hear that. Your caregiver will reach out soon. Is there anything else?", timestamp: '09:06:55' },
      { speaker: 'ELDER', text: "No, I think I just need some rest. Thank you for calling, dear.", timestamp: '09:07:03' },
    ],
  },
  urgent: {
    duration_seconds: 148,
    turns: [
      { speaker: 'AI', text: "Good morning! This is your daily wellness check-in. How are you feeling today?", timestamp: '10:00:00' },
      { speaker: 'ELDER', text: "Oh thank goodness someone called! I'm not doing well at all, I'm scared.", timestamp: '10:00:10' },
      { speaker: 'AI', text: "I'm here. Can you tell me what's wrong?", timestamp: '10:00:16' },
      { speaker: 'ELDER', text: "I've had this terrible chest pain since very early this morning. And I feel so short of breath. I can't breathe properly.", timestamp: '10:00:27' },
      { speaker: 'AI', text: "That sounds very serious. Have you called for help? Do you need emergency services?", timestamp: '10:00:36' },
      { speaker: 'ELDER', text: "I didn't want to be a bother... but the pain is quite bad. I couldn't even get up to take my pills this morning.", timestamp: '10:00:48' },
      { speaker: 'AI', text: "Your health is the absolute priority. I'm alerting your caregiver RIGHT NOW as an urgent emergency. Please don't move around.", timestamp: '10:01:00' },
      { speaker: 'ELDER', text: "Oh dear, yes... I'm frightened. I don't know what's happening to me.", timestamp: '10:01:09' },
      { speaker: 'AI', text: "Stay calm, help is coming. Your caregiver will contact you very soon. Are you sitting or lying down safely?", timestamp: '10:01:17' },
      { speaker: 'ELDER', text: "I'm in my bed. I haven't been able to get up since last night. I feel very weak.", timestamp: '10:01:26' },
      { speaker: 'AI', text: "Good, stay in bed and rest. This has been flagged as urgent. Someone will be with you very soon.", timestamp: '10:01:34' },
    ],
  },
  mixed: {
    duration_seconds: 212,
    turns: [
      { speaker: 'AI', text: "Good afternoon! Just checking in. How has your day been so far?", timestamp: '14:00:00' },
      { speaker: 'ELDER', text: "Oh, it's been an okay day. Not bad, not particularly good either.", timestamp: '14:00:09' },
      { speaker: 'AI', text: "I see. Did you take your lunchtime medication?", timestamp: '14:00:15' },
      { speaker: 'ELDER', text: "Yes, yes I had my pills with lunch. I'm good about that one.", timestamp: '14:00:23' },
      { speaker: 'AI', text: "That's great! What did you have for lunch?", timestamp: '14:00:30' },
      { speaker: 'ELDER', text: "Just a small sandwich and a bit of soup. Not much of an appetite lately.", timestamp: '14:00:38' },
      { speaker: 'AI', text: "How about breakfast this morning?", timestamp: '14:00:45' },
      { speaker: 'ELDER', text: "I skipped breakfast. I just wasn't hungry in the morning.", timestamp: '14:00:53' },
      { speaker: 'AI', text: "I see. How are you feeling emotionally? Any worries on your mind?", timestamp: '14:01:01' },
      { speaker: 'ELDER', text: "A bit lonely to be honest. The days feel very long when you're on your own.", timestamp: '14:01:12' },
      { speaker: 'AI', text: "I understand that. I'll let your caregiver know you'd appreciate some company. Did you do your afternoon exercises?", timestamp: '14:01:21' },
      { speaker: 'ELDER', text: "No, I didn't feel like it today. My legs felt quite heavy.", timestamp: '14:01:30' },
      { speaker: 'AI', text: "Any physical pain or discomfort today?", timestamp: '14:01:37' },
      { speaker: 'ELDER', text: "My lower back has been aching a bit. Probably from sitting too much.", timestamp: '14:01:46' },
      { speaker: 'AI', text: "I'll pass all of this along to your caregiver. Is there anything else you'd like to share?", timestamp: '14:01:54' },
      { speaker: 'ELDER', text: "No, that's all. Thank you for checking in.", timestamp: '14:02:01' },
    ],
  },
};

// GET /api/calls?elder_id=xxx — call history
router.get('/', auth, async (req, res) => {
  const { elder_id, limit = 20, offset = 0 } = req.query;
  if (!elder_id) return res.status(400).json({ error: 'elder_id is required' });

  const check = await pool.query(
    'SELECT id FROM elders WHERE id = $1 AND caregiver_id = $2',
    [elder_id, req.caregiver.id]
  );
  if (!check.rows[0]) return res.status(404).json({ error: 'Elder not found' });

  const { rows } = await pool.query(
    `SELECT id, elder_id, call_timestamp, duration_seconds, status,
       llm_analysis->>'mood' AS mood,
       llm_analysis->>'compliance_score' AS compliance_score,
       llm_analysis->>'summary' AS summary,
       llm_analysis->>'distress_flag' AS distress_flag
     FROM calls WHERE elder_id = $1
     ORDER BY call_timestamp DESC LIMIT $2 OFFSET $3`,
    [elder_id, limit, offset]
  );

  res.json(rows.map(c => ({
    ...c,
    compliance_score: c.compliance_score ? parseInt(c.compliance_score) : null,
    distress_flag: c.distress_flag === 'true',
  })));
});

// GET /api/calls/:id — full call detail
router.get('/:id', auth, async (req, res) => {
  const result = await pool.query(
    `SELECT c.*, e.name AS elder_name, e.elder_uid FROM calls c
     JOIN elders e ON e.id = c.elder_id
     WHERE c.id = $1 AND e.caregiver_id = $2`,
    [req.params.id, req.caregiver.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Call not found' });
  res.json(result.rows[0]);
});

// POST /api/calls/simulate — inject demo transcript + trigger Gemini analysis
router.post('/simulate', auth, async (req, res) => {
  const { elder_id, scenario = 'positive' } = req.body;
  if (!elder_id) return res.status(400).json({ error: 'elder_id is required' });

  const elderRes = await pool.query(
    'SELECT * FROM elders WHERE id = $1 AND caregiver_id = $2',
    [elder_id, req.caregiver.id]
  );
  if (!elderRes.rows[0]) return res.status(404).json({ error: 'Elder not found' });

  const elder = elderRes.rows[0];
  const transcript = DEMO_TRANSCRIPTS[scenario] || DEMO_TRANSCRIPTS.positive;

  const callRes = await pool.query(
    `INSERT INTO calls (elder_id, call_timestamp, duration_seconds, raw_transcript, status)
     VALUES ($1, NOW(), $2, $3, 'analysing') RETURNING *`,
    [elder_id, transcript.duration_seconds, JSON.stringify(transcript)]
  );
  const call = callRes.rows[0];

  // Respond immediately; process async in background
  res.status(202).json({ message: 'Call received. Gemini analysis started.', call_id: call.id, status: 'analysing' });

  processCallAsync(call, elder).catch(err =>
    console.error(`❌ Async call processing failed (${call.id}):`, err.message)
  );
});

// POST /api/calls/webhook — receive from external PSTN agent
router.post('/webhook', async (req, res) => {
  const { elder_id, transcript, metadata = {} } = req.body;
  if (!elder_id || !transcript) return res.status(400).json({ error: 'elder_id and transcript are required' });

  const elderRes = await pool.query('SELECT * FROM elders WHERE id = $1', [elder_id]);
  if (!elderRes.rows[0]) return res.status(404).json({ error: 'Elder not found' });

  const elder = elderRes.rows[0];
  const callRes = await pool.query(
    `INSERT INTO calls (elder_id, call_timestamp, duration_seconds, raw_transcript, status)
     VALUES ($1, NOW(), $2, $3, 'analysing') RETURNING *`,
    [elder_id, metadata.duration_seconds || null, JSON.stringify(transcript)]
  );

  const call = callRes.rows[0];
  res.status(202).json({ message: 'Transcript received. Processing.', call_id: call.id });
  processCallAsync(call, elder).catch(console.error);
});

// ── Custom transcript (paste or file upload from web tool) ───
// POST /api/calls/analyse-custom
// Body: { elder_id, transcript_text, notes? }
// Returns the full analysis synchronously (waits for Gemini)
router.post('/analyse-custom', auth, async (req, res) => {
  const { elder_id, transcript_text, notes } = req.body;
  if (!elder_id) return res.status(400).json({ error: 'elder_id is required' });
  if (!transcript_text || !transcript_text.trim()) return res.status(400).json({ error: 'transcript_text is required' });

  const elderRes = await pool.query('SELECT * FROM elders WHERE id = $1', [elder_id]);
  if (!elderRes.rows[0]) return res.status(404).json({ error: 'Elder not found' });
  const elder = elderRes.rows[0];

  // Convert raw text into our transcript structure.
  // Each non-empty line becomes an ELDER turn so Gemini has full context.
  const turns = transcript_text
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map((line, i) => {
      // Auto-detect speaker prefix like "ELDER:", "AI:", "Carer:", "Caregiver:", etc.
      const speakerMatch = line.match(/^(AI|CARER|CAREGIVER|NURSE|ELDER|PATIENT|CALLER)[:\-\s]+/i);
      if (speakerMatch) {
        const speaker = /AI|CARER|CAREGIVER|NURSE|CALLER/i.test(speakerMatch[1]) ? 'AI' : 'ELDER';
        return { speaker, text: line.slice(speakerMatch[0].length).trim(), timestamp: `00:0${i}:00` };
      }
      // No prefix — treat whole text as ELDER speech
      return { speaker: 'ELDER', text: line, timestamp: `00:0${i}:00` };
    });

  const callRes = await pool.query(
    `INSERT INTO calls (elder_id, call_timestamp, duration_seconds, raw_transcript, status, error_message)
     VALUES ($1, NOW(), $2, $3, 'analysing', $4) RETURNING *`,
    [elder_id, Math.ceil(transcript_text.length / 15), JSON.stringify({ turns, source: 'custom_web_tool' }), notes || null]
  );
  const call = callRes.rows[0];

  // Run synchronously so the web tool gets immediate results
  const schedulesRes = await pool.query(
    'SELECT * FROM schedules WHERE elder_id = $1 AND is_active = TRUE', [elder.id]
  );

  try {
    const analysis = await analyseCallTranscript(call, elder, schedulesRes.rows);

    await pool.query(
      `UPDATE calls SET llm_analysis = $1, status = 'completed', updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(analysis), call.id]
    );

    const createdAlerts = await generateAlerts(elder.id, call.id, analysis);
    await notifyFromAlerts(elder.id, elder.name, createdAlerts);

    return res.json({
      call_id: call.id,
      elder: { id: elder.id, name: elder.name },
      analysis,
      alerts: createdAlerts,
      transcript_turns: turns.length,
    });
  } catch (err) {
    await pool.query(
      `UPDATE calls SET status = 'failed', error_message = $1, updated_at = NOW() WHERE id = $2`,
      [err.message, call.id]
    );
    return res.status(500).json({ error: 'Analysis failed', detail: err.message });
  }
});

module.exports = router;
