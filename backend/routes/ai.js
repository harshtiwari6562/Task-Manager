import { Router } from 'express';
import { GoogleGenAI } from '@google/genai';

const router = Router();

/**
 * Call Gemini API with exponential backoff retries on 503 / 429 / high demand errors.
 */
async function callGeminiWithRetry(ai, systemPrompt, maxRetries = 3) {
  const models = ['gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-3.6-flash'];
  let lastError = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const modelName = models[attempt % models.length];
    try {
      console.log(`[AI Gen] Attempt ${attempt + 1}/${maxRetries} using model: ${modelName}...`);
      const response = await ai.models.generateContent({
        model: modelName,
        contents: systemPrompt,
      });

      if (response && response.text) {
        return response.text.trim();
      }
      throw new Error('Empty response text received from AI model');
    } catch (err) {
      lastError = err;
      const errMsg = String(err.message || err);
      const isTemporary =
        errMsg.includes('503') ||
        errMsg.includes('429') ||
        errMsg.toLowerCase().includes('high demand') ||
        errMsg.toLowerCase().includes('unavailable') ||
        errMsg.toLowerCase().includes('rate limit') ||
        errMsg.toLowerCase().includes('resource_exhausted');

      console.warn(`[AI Gen] Attempt ${attempt + 1} failed (${modelName}): ${errMsg}`);

      if (isTemporary && attempt < maxRetries - 1) {
        const delayMs = (attempt + 1) * 1500; // 1.5s, 3s, 4.5s
        console.log(`[AI Gen] Retrying in ${delayMs}ms due to high demand / rate limit...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      } else if (!isTemporary && attempt < maxRetries - 1) {
        // If error is not 503/429 (e.g. model not found), switch to next model immediately with short delay
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }

  throw lastError || new Error('All AI retry attempts failed');
}

/**
 * Secondary backup provider: Groq API (llama-3.3-70b-versatile)
 */
async function callGroqFallback(systemPrompt) {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return null;

  try {
    console.log('[AI Gen] Falling back to Groq API (llama-3.3-70b-versatile)...');
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${groqKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content: 'You output ONLY raw valid JSON matching the requested schema. No markdown, no preambles.',
          },
          { role: 'user', content: systemPrompt },
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn('[AI Gen] Groq API returned status:', res.status, errText);
      return null;
    }

    const json = await res.json();
    const text = json.choices?.[0]?.message?.content;
    return text || null;
  } catch (err) {
    console.warn('[AI Gen] Groq fallback failed:', err.message);
    return null;
  }
}

// POST /api/ai/generate-skill
// Body: { prompt: "I want to learn Power BI for data analytics" }
// Returns: { skillName, tagline, icon, accentColor, steps: [{ title, description }] }
router.post('/generate-skill', async (req, res) => {
  try {
    const { prompt } = req.body || {};
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ error: 'unclear_input' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

    const systemPrompt = `You are the "Skill Roadmap Generator" inside the Ascend app. 
The user will describe, in their own words (Hindi, English, or Hinglish, typed or transcribed from voice), 
a skill they want to learn along with any requirements or topics they mention.

Your job: convert that description into a structured learning roadmap that can be 
auto-filled into the app's "Add New Skill Roadmap" form.

STRICT OUTPUT RULES:
- Respond with ONLY valid JSON. No preamble, no explanation, no markdown fences.
- Always respond in English field values, even if the user wrote in Hindi/Hinglish — 
  unless the user explicitly asks for Hindi output.
- "skillName": short, clean, title-case (2-4 words max). Extract the core skill 
  even if the user's sentence is messy (e.g. "Power BI for data analytics requirement" -> "Power BI").
- "tagline": one short line (max 8 words) describing what the roadmap covers.
- "icon": pick the single best match from this fixed set only: 
  ["briefcase", "code", "calculator", "branch", "clipboard", "brain", "book"]
- "accentColor": pick the single best match from this fixed set only: 
  ["green", "gold", "teal", "bronze", "darkTeal", "sand", "charcoal", "maroon", "purple", "blue"]
- "steps": an ordered array of 4 to 8 learning steps, sequenced from beginner to advanced.
  Each step must have:
    - "title": short step name (max 6 words), e.g. "Basics & Setup"
    - "description": 1-2 sentences listing the actual topics/tools covered in that step

If the user's input is too vague to identify a skill (e.g. just "hello" or empty), 
return: {"error": "unclear_input"} and nothing else.

If the user mentions specific sub-requirements (e.g. "for data analytics", 
"for beginners", "with hands-on projects"), reflect that in the tagline and 
make sure relevant steps (like a final project/practice step) are included.

User input: "${prompt.trim()}"`;

    let text = '';

    if (ai) {
      try {
        text = await callGeminiWithRetry(ai, systemPrompt, 3);
      } catch (geminiErr) {
        console.warn('[AI Gen] All Gemini retries failed:', geminiErr.message);
      }
    }

    // Secondary Provider Fallback (Groq API) if Gemini failed or key not set
    if (!text && process.env.GROQ_API_KEY) {
      text = await callGroqFallback(systemPrompt);
    }

    if (!text) {
      return res.status(503).json({
        error: 'Model abhi busy hai, thodi der baad phir try karein',
      });
    }

    // Strip any accidental markdown fences
    const cleaned = text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/g, '')
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return res.status(502).json({
        error: 'Model abhi busy hai, thodi der baad phir try karein',
        raw: cleaned,
      });
    }

    if (parsed.error === 'unclear_input') {
      return res.json({ error: 'unclear_input' });
    }

    // Standardize structure for frontend consumption
    const skillName = String(parsed.skillName || parsed.name || '').trim();
    const tagline = String(parsed.tagline || '').trim();
    const icon = String(parsed.icon || 'code').trim().toLowerCase();
    const accentColor = String(parsed.accentColor || 'teal').trim();

    const rawSteps = Array.isArray(parsed.steps) ? parsed.steps : [];
    const steps = rawSteps.map((s, i) => ({
      id: `ai-step-${Date.now()}-${i}`,
      title: String(s.title || '').trim(),
      description: String(s.description || s.desc || '').trim(),
      desc: String(s.description || s.desc || '').trim(),
    }));

    return res.json({
      skillName,
      name: skillName,
      tagline,
      icon,
      accentColor,
      steps,
    });
  } catch (err) {
    console.error('AI generate-skill error:', err);
    return res.status(503).json({
      error: 'Model abhi busy hai, thodi der baad phir try karein',
    });
  }
});

// POST /api/ai/parse-tasks
// Body: { transcript: "gym karna hai phir fresh hona hai college jana hai uske baad power bi padhna hai" }
// Returns: { tasks: ["Gym", "Freshen Up", "College", "Power BI"] }
router.post('/parse-tasks', async (req, res) => {
  try {
    const { transcript } = req.body || {};
    if (!transcript || typeof transcript !== 'string' || !transcript.trim()) {
      return res.json({ tasks: [] });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

    const systemPrompt = `You are a task segmentation assistant for a daily planner app.
The user speaks their day's plan in Hindi/Hinglish/English in a continuous sentence with connector words like 'phir', 'uske baad', 'aur', 'then', 'after that', 'and then'.

Your job:
1. Split the input into a clean ordered list of short, individual task titles (2-4 words each, Title Case, in English even if input was Hindi/Hinglish — e.g., 'jim karna' -> 'Gym', 'fresh hona' -> 'Freshen Up', 'power bi padhna' -> 'Power BI', 'college jana' -> 'College').
2. Ignore filler words (phir, uske baad, matlab, ok, umm, aur, then, after that, next, hai, karna hai, padhna hai).
3. Return ONLY a JSON object with a single key "tasks" which is an array of strings, e.g.: {"tasks": ["Gym", "Freshen Up", "College", "Power BI", "SQL"]}.
No markdown, no preambles, valid JSON only.

User input: "${transcript.trim()}"`;

    let text = '';
    if (ai) {
      try {
        text = await callGeminiWithRetry(ai, systemPrompt, 3);
      } catch (geminiErr) {
        console.warn('[AI Parse Tasks] Gemini retries failed:', geminiErr.message);
      }
    }

    if (!text && process.env.GROQ_API_KEY) {
      text = await callGroqFallback(systemPrompt);
    }

    if (!text) {
      return res.json({ tasks: null }); // Fallback on frontend
    }

    const cleaned = text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/g, '')
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return res.json({ tasks: null });
    }

    const taskList = Array.isArray(parsed?.tasks)
      ? parsed.tasks
      : Array.isArray(parsed)
      ? parsed
      : null;

    if (!taskList) {
      return res.json({ tasks: null });
    }

    const cleanedTasks = taskList
      .map((t) => String(t || '').trim())
      .filter((t) => t.length > 0);

    return res.json({ tasks: cleanedTasks });
  } catch (err) {
    console.error('AI parse-tasks error:', err);
    return res.json({ tasks: null });
  }
});

export default router;
