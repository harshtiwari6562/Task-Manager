import { Router } from 'express';
import { z } from 'zod';
import config from '../config.js';
import AiUsage, { AiLimitError } from '../models/AiUsage.js';

const router = Router();

// Concurrency control: Global queue with max 4 concurrent calls (max 3-5 requirement)
class AiConcurrencyQueue {
  constructor(maxConcurrency = 4, maxQueue = 10, queueTimeoutMs = 5000) {
    this.maxConcurrency = maxConcurrency;
    this.maxQueue = maxQueue;
    this.queueTimeoutMs = queueTimeoutMs;
    this.running = 0;
    this.queue = [];
  }

  get isBusy() {
    return this.running >= this.maxConcurrency && this.queue.length >= this.maxQueue;
  }

  async acquire() {
    if (this.running < this.maxConcurrency) {
      this.running++;
      return () => this.release();
    }

    if (this.queue.length >= this.maxQueue) {
      const err = new Error('AI service is currently at maximum capacity. Please try again in a few moments.');
      err.status = 503;
      throw err;
    }

    return new Promise((resolve, reject) => {
      let timer = null;
      const item = {
        resolve: () => {
          clearTimeout(timer);
          this.running++;
          resolve(() => this.release());
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      };

      timer = setTimeout(() => {
        const idx = this.queue.indexOf(item);
        if (idx !== -1) {
          this.queue.splice(idx, 1);
          const err = new Error('AI request queue timeout. Server is under high load. Please try again.');
          err.status = 503;
          reject(err);
        }
      }, this.queueTimeoutMs);

      this.queue.push(item);
    });
  }

  release() {
    this.running = Math.max(0, this.running - 1);
    if (this.queue.length > 0 && this.running < this.maxConcurrency) {
      const nextItem = this.queue.shift();
      nextItem.resolve();
    }
  }
}

const globalAiQueue = new AiConcurrencyQueue(4, 10, 5000);


// In-memory LRU Cache (max 500 entries, 10 minutes TTL)
class SimpleLRUCache {
  constructor(max = 500, ttlMs = 10 * 60 * 1000) {
    this.max = max;
    this.ttlMs = ttlMs;
    this.map = new Map();
  }

  get(key) {
    if (!key) return null;
    const entry = this.map.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiry) {
      this.map.delete(key);
      return null;
    }
    // refresh LRU recency
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key, value) {
    if (!key) return;
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.max) {
      const oldestKey = this.map.keys().next().value;
      this.map.delete(oldestKey);
    }
    this.map.set(key, { value, expiry: Date.now() + this.ttlMs });
  }
}

const taskParseCache = new SimpleLRUCache(500, 10 * 60 * 1000);
const skillGenCache = new SimpleLRUCache(500, 10 * 60 * 1000);

const ICON_WHITELIST = ['briefcase', 'code', 'calculator', 'branch', 'clipboard', 'brain', 'book'];
const ACCENT_COLOR_WHITELIST = [
  'green',
  'gold',
  'teal',
  'bronze',
  'darkTeal',
  'sand',
  'charcoal',
  'maroon',
  'purple',
  'blue',
];

const generatedSkillSchema = z.object({
  skillName: z.string().trim().min(1).max(100),
  tagline: z.string().trim().min(1).max(200),
  icon: z.enum(ICON_WHITELIST).catch('code'),
  accentColor: z.enum(ACCENT_COLOR_WHITELIST).catch('teal'),
  steps: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(100),
        description: z.string().trim().min(1).max(500),
      })
    )
    .min(4)
    .max(8),
});

/**
 * Fast direct Gemini call with keep-alive, thinking disabled, and per-call timeout.
 */
async function callGeminiDirect(prompt, timeoutMs = 4000, maxOutputTokens = 200, signal = null) {
  const apiKey = config.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY missing');

  const models = config.GEMINI_MODELS || ['gemini-3.1-flash-lite', 'gemini-3.8-flash'];
  let lastErr = null;

  for (const model of models) {
    const localController = new AbortController();
    const abortTimer = setTimeout(() => localController.abort(), timeoutMs);

    const onExternalAbort = () => localController.abort();
    if (signal) signal.addEventListener('abort', onExternalAbort, { once: true });

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Connection': 'keep-alive',
        },
        signal: localController.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.2,
            maxOutputTokens,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      });

      clearTimeout(abortTimer);
      if (signal) signal.removeEventListener('abort', onExternalAbort);

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error?.message || `HTTP ${res.status}`);
      }

      const json = await res.json();
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text && text.trim()) {
        return { text: text.trim(), provider: `gemini (${model})` };
      }
      throw new Error('Empty response from Gemini');
    } catch (err) {
      clearTimeout(abortTimer);
      if (signal) signal.removeEventListener('abort', onExternalAbort);
      lastErr = err;
      // If aborted by caller/timeout, do not proceed to next model
      if (localController.signal.aborted || signal?.aborted) {
        break;
      }
    }
  }

  throw lastErr || new Error('All configured Gemini models failed');
}

/**
 * Fast Groq call with keep-alive and per-call timeout.
 */
async function callGroqDirect(prompt, timeoutMs = 4000, maxOutputTokens = 200, signal = null) {
  const groqKey = config.GROQ_API_KEY;
  if (!groqKey) throw new Error('GROQ_API_KEY missing');

  const localController = new AbortController();
  const abortTimer = setTimeout(() => localController.abort(), timeoutMs);

  const onExternalAbort = () => localController.abort();
  if (signal) signal.addEventListener('abort', onExternalAbort, { once: true });

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${groqKey}`,
        'Connection': 'keep-alive',
      },
      signal: localController.signal,
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content: 'You output ONLY raw valid JSON in English or Roman Hinglish. Never Devanagari script.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        max_tokens: maxOutputTokens,
        response_format: { type: 'json_object' },
      }),
    });

    clearTimeout(abortTimer);
    if (signal) signal.removeEventListener('abort', onExternalAbort);

    if (!res.ok) {
      throw new Error(`Groq HTTP ${res.status}`);
    }

    const json = await res.json();
    const text = json.choices?.[0]?.message?.content;
    if (text && text.trim()) {
      return { text: text.trim(), provider: 'groq' };
    }
    throw new Error('Empty response from Groq');
  } catch (err) {
    clearTimeout(abortTimer);
    if (signal) signal.removeEventListener('abort', onExternalAbort);
    throw err;
  }
}

/**
 * Promise.any / race between available providers (Gemini & Groq)
 */
async function callAiFast({ prompt, timeoutMs, maxOutputTokens }) {
  const providers = [];
  const masterController = new AbortController();

  if (config.GEMINI_API_KEY) {
    providers.push(callGeminiDirect(prompt, timeoutMs, maxOutputTokens, masterController.signal));
  }
  if (config.GROQ_API_KEY) {
    providers.push(callGroqDirect(prompt, timeoutMs, maxOutputTokens, masterController.signal));
  }

  if (providers.length === 0) {
    return null;
  }

  try {
    const result = await Promise.any(providers);
    // Abort other pending providers to save bandwidth & quota
    masterController.abort();
    return result;
  } catch (err) {
    masterController.abort();
    return null;
  }
}

// POST /api/ai/generate-skill
router.post('/generate-skill', async (req, res) => {
  const startTime = performance.now();
  let releaseLease = null;

  try {
    await AiUsage.checkAndRecord(req.userId, 'generate-skill');

    const { prompt } = req.body || {};
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ error: 'unclear_input' });
    }
    const safePrompt = prompt.trim().slice(0, 500);
    const cacheKey = safePrompt.toLowerCase();

    // Check 10-minute LRU cache (fastest, skips AI call entirely)
    const cached = skillGenCache.get(cacheKey);
    if (cached) {
      const dur = Math.round(performance.now() - startTime);
      console.log(`[AI Timing] /api/ai/generate-skill duration: ${dur}ms (cached: true)`);
      return res.json(cached);
    }

    try {
      releaseLease = await globalAiQueue.acquire();
    } catch (queueErr) {
      return res.status(503).json({
        error: queueErr.message || 'Ascend AI is currently experiencing high load. Please try again shortly.',
      });
    }

    const systemPrompt = `Create a learning roadmap in English for the skill. Output JSON only:
{"skillName":"string (2-4 words)","tagline":"string (max 8 words)","icon":"briefcase|code|calculator|branch|clipboard|brain|book","accentColor":"green|gold|teal|bronze|darkTeal|sand|charcoal|maroon|purple|blue","steps":[{"title":"string","description":"string"}]}
If input is unclear: {"error":"unclear_input"}

Skill: ${safePrompt}`;

    const aiResult = await callAiFast({
      prompt: systemPrompt,
      timeoutMs: 8000,
      maxOutputTokens: 700,
    });

    const dur = Math.round(performance.now() - startTime);
    console.log(`[AI Timing] /api/ai/generate-skill duration: ${dur}ms (provider: ${aiResult?.provider || 'none'})`);

    if (!aiResult || !aiResult.text) {
      return res.status(503).json({
        error: 'Ascend AI is currently busy. Please try again shortly.',
      });
    }

    const cleaned = aiResult.text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/g, '')
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return res.status(502).json({
        error: 'Ascend AI is currently busy. Please try again shortly.',
      });
    }

    if (parsed.error === 'unclear_input') {
      return res.json({ error: 'unclear_input' });
    }

    const candidate = {
      skillName: String(parsed.skillName || parsed.name || '').trim(),
      tagline: String(parsed.tagline || '').trim(),
      icon: String(parsed.icon || 'code').trim().toLowerCase(),
      accentColor: String(parsed.accentColor || 'teal').trim(),
      steps: (Array.isArray(parsed.steps) ? parsed.steps : []).map((s) => ({
        title: String(s.title || '').trim(),
        description: String(s.description || s.desc || '').trim(),
      })),
    };

    const validated = generatedSkillSchema.safeParse(candidate);
    if (!validated.success) {
      console.warn('[AI Gen] Schema validation error:', validated.error.issues);
      return res.status(502).json({
        error: 'Ascend AI is currently busy. Please try again shortly.',
      });
    }

    const finalOutput = validated.data;
    const formattedSteps = finalOutput.steps.map((st, i) => ({
      id: `ai-step-${Date.now()}-${i}`,
      title: st.title,
      description: st.description,
      desc: st.description,
    }));

    const responsePayload = {
      skillName: finalOutput.skillName,
      name: finalOutput.skillName,
      tagline: finalOutput.tagline,
      icon: finalOutput.icon,
      accentColor: finalOutput.accentColor,
      steps: formattedSteps,
    };

    // Cache valid result for 10 minutes
    skillGenCache.set(cacheKey, responsePayload);

    return res.json(responsePayload);
  } catch (err) {
    if (err instanceof AiLimitError) {
      return res.status(429).json({ error: err.message });
    }
    console.error('AI generate-skill unexpected error:', err.message);
    return res.status(503).json({
      error: 'Ascend AI is currently busy. Please try again shortly.',
    });
  } finally {
    if (releaseLease) releaseLease();
  }
});

// Built-in offline dictionary fallback for task parsing (English & Roman Hinglish)
const HINDI_TO_ENG = {
  'स्लीपिंग': 'Sleeping', 'सोना': 'Sleep', 'सोने': 'Sleep', 'नींद': 'Sleep', 'आराम': 'Rest',
  'जिम': 'Gym', 'कसरत': 'Workout', 'व्यायाम': 'Exercise', 'दौड़ना': 'Running', 'रनिंग': 'Running',
  'टहलना': 'Walk', 'वॉक': 'Walk', 'योगा': 'Yoga', 'योग': 'Yoga', 'कॉलेज': 'College', 'स्कूल': 'School',
  'पढ़ाई': 'Study', 'पढ़ना': 'Study', 'कोडिंग': 'Coding', 'प्रोग्रामिंग': 'Programming',
  'रिवीजन': 'Revision', 'असाइनमेंट': 'Assignment', 'होमवर्क': 'Homework', 'नाश्ता': 'Breakfast',
  'ब्रेकफास्ट': 'Breakfast', 'खाना': 'Meal', 'लंच': 'Lunch', 'डिनर': 'Dinner', 'चाय': 'Tea Break',
  'कॉफी': 'Coffee Break', 'नहाना': 'Freshen Up', 'फ्रेश': 'Freshen Up', 'पूजा': 'Prayer',
  'मंदिर': 'Temple Visit', 'गीता': 'Bhagavad Gita', 'भगवद गीता': 'Bhagavad Gita', 'ऑफिस': 'Office Work',
  'काम': 'Work', 'दफ्तर': 'Office', 'प्रोजेक्ट': 'Project Work', 'मीटिंग': 'Meeting',
  'बाजार': 'Market', 'मार्केट': 'Market', 'खरीदारी': 'Shopping', 'sona': 'Sleep', 'gym': 'Gym',
  'college': 'College', 'padhai': 'Study', 'padhna': 'Study', 'coding': 'Coding', 'lunch': 'Lunch',
  'dinner': 'Dinner', 'breakfast': 'Breakfast', 'nashta': 'Breakfast', 'khana': 'Meal',
  'fresh hona': 'Freshen Up', 'puja': 'Prayer', 'mandir': 'Temple Visit', 'gita': 'Bhagavad Gita',
  'kaam': 'Work', 'office': 'Office Work', 'project': 'Project Work'
};

export function fallbackParseTasks(transcript) {
  if (!transcript || !transcript.trim()) return [];
  const pattern = /phir|uske\s+baad|after\s+that|and\s+then|then|\baur\b|\band\b|फिर|उसके\s*बाद|और|तथा|[,.\n;।]+/gi;
  const parts = transcript.split(pattern);
  const tasks = parts
    .map((p) => {
      const raw = p.replace(/[।.,;!?]/g, '').trim();
      let cleaned = raw
        .replace(/\b(hai|karna|karne|padhna|padhne|jana|jane|hona|hone|matlab|ok|umm|pls|please)\b|है|करना|करने|जाना|जाने|पढ़ना|पढ़ने|होना|होने|मतलब|प्लीज/gi, '')
        .trim();
      if (!cleaned) return '';
      const lower = cleaned.toLowerCase();
      const mapped = HINDI_TO_ENG[cleaned] || HINDI_TO_ENG[lower] || cleaned;
      return mapped
        .split(/\s+/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
    })
    .filter((t) => t.length > 1);

  return tasks.length > 0 ? tasks : [transcript.trim()];
}

// POST /api/ai/parse-tasks
router.post('/parse-tasks', async (req, res) => {
  const startTime = performance.now();
  let releaseLease = null;
  try {
    const { transcript } = req.body || {};
    if (!transcript || typeof transcript !== 'string' || !transcript.trim()) {
      return res.json({ tasks: [] });
    }

    const safeTranscript = transcript.trim().slice(0, 2000);
    const cacheKey = safeTranscript.toLowerCase();

    // 10-Minute LRU Cache hit check
    const cached = taskParseCache.get(cacheKey);
    if (cached) {
      if (!process.env.BENCHMARK && config.NODE_ENV !== 'production') {
        const dur = Math.round(performance.now() - startTime);
        console.log(`[AI Timing] /api/ai/parse-tasks duration: ${dur}ms (cached: true)`);
      }
      return res.json({ tasks: cached });
    }

    if (!config.GEMINI_API_KEY && !config.GROQ_API_KEY) {
      const fallbackTasks = fallbackParseTasks(safeTranscript);
      taskParseCache.set(cacheKey, fallbackTasks);
      return res.json({ tasks: fallbackTasks });
    }

    try {
      await AiUsage.checkAndRecord(req.userId, 'parse-tasks');
    } catch (limitErr) {
      // Under quota exhaustion or user limit, fallback immediately to local parse
      const fallbackTasks = fallbackParseTasks(safeTranscript);
      taskParseCache.set(cacheKey, fallbackTasks);
      return res.json({ tasks: fallbackTasks });
    }

    try {
      releaseLease = await globalAiQueue.acquire();
    } catch (queueErr) {
      // Under high concurrency/queue full, return immediate local fallback parse
      const fallbackTasks = fallbackParseTasks(safeTranscript);
      taskParseCache.set(cacheKey, fallbackTasks);
      return res.json({ tasks: fallbackTasks });
    }

    const systemPrompt = `Split the continuous speech into clean task titles in English or Roman Hinglish (never Devanagari).
Return ONLY valid JSON: {"tasks": ["Gym", "Freshen Up", "College"]}.

Text: ${safeTranscript}`;

    const aiResult = await callAiFast({
      prompt: systemPrompt,
      timeoutMs: 4000,
      maxOutputTokens: 200,
    });

    const dur = Math.round(performance.now() - startTime);
    console.log(`[AI Timing] /api/ai/parse-tasks duration: ${dur}ms (provider: ${aiResult?.provider || 'fallback'})`);

    if (!aiResult || !aiResult.text) {
      const fallbackTasks = fallbackParseTasks(safeTranscript);
      taskParseCache.set(cacheKey, fallbackTasks);
      return res.json({ tasks: fallbackTasks });
    }

    const cleaned = aiResult.text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/g, '')
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const fallbackTasks = fallbackParseTasks(safeTranscript);
      taskParseCache.set(cacheKey, fallbackTasks);
      return res.json({ tasks: fallbackTasks });
    }

    const taskList = Array.isArray(parsed?.tasks)
      ? parsed.tasks
      : Array.isArray(parsed)
      ? parsed
      : null;

    if (!taskList) {
      const fallbackTasks = fallbackParseTasks(safeTranscript);
      taskParseCache.set(cacheKey, fallbackTasks);
      return res.json({ tasks: fallbackTasks });
    }

    const cleanedTasks = taskList
      .map((t) => String(t || '').trim())
      .filter((t) => t.length > 0 && t.length < 100);

    const finalTasks = cleanedTasks.length > 0 ? cleanedTasks : fallbackParseTasks(safeTranscript);

    // Cache identical transcripts for 10 minutes (LRU)
    taskParseCache.set(cacheKey, finalTasks);

    return res.json({ tasks: finalTasks });
  } catch (err) {
    if (err instanceof AiLimitError) {
      return res.status(429).json({ error: err.message });
    }
    console.error('AI parse-tasks error:', err.message);
    const transcript = req.body?.transcript || '';
    return res.json({ tasks: fallbackParseTasks(transcript) });
  } finally {
    if (releaseLease) releaseLease();
  }
});

export default router;

