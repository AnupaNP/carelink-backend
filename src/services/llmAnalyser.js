const { GoogleGenerativeAI } = require('@google/generative-ai');

let genAI = null;

function getModel() {
  if (!genAI) {
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set');
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }
  return genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
}

// ─────────────────────────────────────────────────────────────
// SYSTEM PROMPT — engineered for strict JSON output
// ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a healthcare AI specializing in analyzing voice call transcripts from AI wellness check-in calls with elderly patients.

Given: (1) elder info & schedule, (2) call transcript as JSON turns array.

OUTPUT RULES — CRITICAL:
• Return ONLY raw valid JSON. Absolutely no markdown, no code blocks, no explanation, no text before or after.
• Match the schema exactly.

SCHEMA:
{
  "medications": [
    {"name": "string", "scheduled_time": "HH:MM", "status": "taken|missed|na"}
  ],
  "meals": {
    "breakfast": "eaten|skipped|partial|na",
    "lunch": "eaten|skipped|partial|na",
    "dinner": "eaten|skipped|partial|na"
  },
  "mood": "positive|neutral|low|distressed",
  "mood_notes": "Brief, warm, clinical note for caregiver",
  "distress_flag": false,
  "compliance_score": 75,
  "summary": "1-2 sentence plain English summary for the caregiver",
  "raw_concerns": ["specific concern 1"]
}

FIELD RULES:
- medications[].status = "na" if that med was not discussed OR not scheduled for this call time
- meals.* = "na" if not relevant for this call time (e.g. asking about dinner at 8am)
- distress_flag = true ONLY if: explicit pain mention, breathing difficulty, emergency, severe confusion, or extreme fear
- compliance_score = 0-100 integer (0=nothing done, 100=all meds taken + all meals eaten as scheduled)
- raw_concerns = [] if no concerns; be specific and clinical
- summary is written warmly for a non-medical caregiver
- When uncertain, err toward flagging a concern rather than ignoring it`;

// ─────────────────────────────────────────────────────────────
async function analyseCallTranscript(call, elder, schedules) {
  const medications = schedules.filter(s => s.type === 'medication').map(s => ({
    name: s.label, scheduled_time: s.scheduled_time,
  }));
  const meals = schedules.filter(s => s.type === 'meal').map(s => ({
    meal: s.label, scheduled_time: s.scheduled_time,
  }));
  const activities = schedules.filter(s => s.type === 'activity').map(s => ({
    activity: s.label, scheduled_time: s.scheduled_time,
  }));

  const prompt = `${SYSTEM_PROMPT}

---
ELDER INFORMATION:
Name: ${elder.name} | Age: ${elder.age || 'Unknown'}
Medical Notes: ${elder.medical_notes || 'None provided'}

DAILY SCHEDULE:
Medications: ${medications.length ? JSON.stringify(medications) : 'None on file'}
Meals: ${meals.length ? JSON.stringify(meals) : 'Standard 3 meals assumed (breakfast/lunch/dinner)'}
Activities: ${activities.length ? JSON.stringify(activities) : 'None scheduled'}

CALL TRANSCRIPT:
${JSON.stringify(call.raw_transcript?.turns || [], null, 2)}

Analyze the transcript above and return the JSON assessment now.`;

  try {
    const model = getModel();
    const result = await model.generateContent(prompt);
    let text = result.response.text();
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').replace(/^\uFEFF/, '').trim();
    const parsed = JSON.parse(text);
    return {
      medications: Array.isArray(parsed.medications) ? parsed.medications : [],
      meals: { breakfast: parsed.meals?.breakfast || 'na', lunch: parsed.meals?.lunch || 'na', dinner: parsed.meals?.dinner || 'na' },
      mood: ['positive', 'neutral', 'low', 'distressed'].includes(parsed.mood) ? parsed.mood : 'neutral',
      mood_notes: parsed.mood_notes || '',
      distress_flag: Boolean(parsed.distress_flag),
      compliance_score: Math.max(0, Math.min(100, parseInt(parsed.compliance_score) || 0)),
      summary: parsed.summary || 'Analysis completed.',
      raw_concerns: Array.isArray(parsed.raw_concerns) ? parsed.raw_concerns : [],
      _source: 'gemini',
    };
  } catch (err) {
    // ── FALLBACK: keyword-based analysis when Gemini quota exceeded ──
    if (err.message && (err.message.includes('429') || err.message.includes('quota') || err.message.includes('not found') || err.message.includes('RESOURCE_EXHAUSTED'))) {
      console.log('⚡ Gemini unavailable — using keyword fallback analyser');
      return fallbackAnalysis(call, elder, schedules);
    }
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────
// FALLBACK: Keyword-based analyser (works without Gemini quota)
// ─────────────────────────────────────────────────────────────
function fallbackAnalysis(call, elder, schedules) {
  const turns = call.raw_transcript?.turns || [];
  const elderText = turns.filter(t => t.speaker === 'ELDER').map(t => t.text.toLowerCase()).join(' ');

  const medications = schedules.filter(s => s.type === 'medication').map(s => {
    const taken = elderText.includes('took') || (elderText.includes('had my') && elderText.includes('pill')) || elderText.includes('taken them') || elderText.includes('took them');
    const missed = elderText.includes("forgot") || elderText.includes("don't think i took") || elderText.includes("couldn't get up") || elderText.includes("didn't take");
    return { name: s.label, scheduled_time: s.scheduled_time, status: missed ? 'missed' : (taken ? 'taken' : 'na') };
  });

  const breakfastSkipped = elderText.includes('skipped breakfast') || elderText.includes("wasn't hungry") || elderText.includes('just tea') || elderText.includes('no food') || elderText.includes('no breakfast');
  const breakfastEaten = elderText.includes('oatmeal') || elderText.includes('toast') || elderText.includes('cereal') || (elderText.includes('breakfast') && (elderText.includes('made') || elderText.includes('had some')));
  const lunchEaten = elderText.includes('sandwich') || elderText.includes('soup') || (elderText.includes('lunch') && elderText.includes('had'));
  const lunchSkipped = elderText.includes('skipped lunch') || elderText.includes('no lunch');

  const distressKeywords = ['chest pain', "can't breathe", 'shortness of breath', 'scared', 'frightened', 'terrible pain', 'very weak', 'emergency'];
  const distress_flag = distressKeywords.some(k => elderText.includes(k));

  const positiveMoodKeywords = ['great', 'wonderful', 'good spirits', 'happy', 'very well', 'lovely', 'looking forward', "can't wait"];
  const lowMoodKeywords = ['lonely', 'feeling low', 'not doing well', 'dizzy', 'headache', 'tired', 'exhausted', 'quite low'];
  let mood = 'neutral';
  if (distress_flag) mood = 'distressed';
  else if (positiveMoodKeywords.some(k => elderText.includes(k))) mood = 'positive';
  else if (lowMoodKeywords.some(k => elderText.includes(k))) mood = 'low';

  const takenMeds = medications.filter(m => m.status === 'taken').length;
  const missedMeds = medications.filter(m => m.status === 'missed').length;
  const totalMeds = medications.filter(m => m.status !== 'na').length;
  const medScore = totalMeds > 0 ? (takenMeds / totalMeds) * 50 : 25;
  const breakfastScore = breakfastEaten ? 20 : (breakfastSkipped ? 0 : 10);
  const lunchScore = lunchEaten ? 20 : (lunchSkipped ? 0 : 10);
  const compliance_score = Math.round(Math.min(100, medScore + breakfastScore + lunchScore + 10));

  const raw_concerns = [];
  if (distress_flag) raw_concerns.push('Elder reported distress or pain during call');
  if (missedMeds > 0) raw_concerns.push(`${missedMeds} medication(s) missed`);
  if (breakfastSkipped) raw_concerns.push('Breakfast skipped — low appetite reported');
  if (lunchSkipped) raw_concerns.push('Lunch skipped');
  if (elderText.includes('lonely')) raw_concerns.push('Expressed feelings of loneliness');
  if (elderText.includes('dizzy')) raw_concerns.push('Dizziness reported');
  if (elderText.includes('pain') && !distress_flag) raw_concerns.push('Pain or discomfort mentioned');

  const summaryParts = [];
  if (distress_flag) summaryParts.push('⚠️ Elder reported distress.');
  if (takenMeds > 0) summaryParts.push(`Medications taken (${takenMeds}).`);
  if (missedMeds > 0) summaryParts.push(`Medications missed (${missedMeds}) — follow-up needed.`);
  if (breakfastEaten) summaryParts.push('Had breakfast.');
  if (breakfastSkipped) summaryParts.push('Skipped breakfast.');
  if (mood === 'positive') summaryParts.push('Elder is in good spirits.');
  if (mood === 'low') summaryParts.push('Elder seems to be in low spirits — caregiver check-in recommended.');
  if (summaryParts.length === 0) summaryParts.push('Check-in completed. No major concerns noted.');

  return {
    medications,
    meals: { breakfast: breakfastSkipped ? 'skipped' : (breakfastEaten ? 'eaten' : 'na'), lunch: lunchSkipped ? 'skipped' : (lunchEaten ? 'partial' : 'na'), dinner: 'na' },
    mood,
    mood_notes: raw_concerns.slice(0, 2).join('. ') || 'No notable concerns.',
    distress_flag,
    compliance_score: Math.max(0, compliance_score),
    summary: summaryParts.join(' '),
    raw_concerns,
    _source: 'keyword_fallback',
  };
}

module.exports = { analyseCallTranscript };
