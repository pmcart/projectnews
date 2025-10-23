
import 'dotenv/config';
import { MongoClient, ObjectId } from 'mongodb';
import OpenAI from 'openai';
import pLimit from 'p-limit';

// ---------- config ----------
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || 'org1';
const TWEETS_COLL = process.env.TWEETS_COLL || 'tweets';
const ENRICH_COLL = process.env.ENRICH_COLL || 'tweet_enrichments';

const FETCH_LIMIT = parseInt(getArgValue('--limit') ?? process.env.FETCH_LIMIT ?? '50', 10);
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '5', 10);

// Reasoning-first cascade: fast/cheap o4-mini, escalate hard cases to o3
const PRIMARY_MODEL = process.env.PRIMARY_MODEL || 'o4-mini';
const ESCALATION_MODEL = process.env.ESCALATION_MODEL || 'o3';

const WRITE_BACK_POINTER = (process.env.WRITE_BACK_POINTER || 'true') === 'true';

if (!MONGODB_URI) { console.error('Missing MONGODB_URI'); process.exit(1); }
if (!process.env.OPENAI_API_KEY) { console.error('Missing OPENAI_API_KEY'); process.exit(1); }

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---------- CLI args ----------
const ARG_FORCE = hasArg('--force');
const ARG_PEEK  = hasArg('--peek');
const ARG_ID    = getArgValue('--id'); // tweetId or Mongo _id

function hasArg(flag) { return process.argv.includes(flag); }
function getArgValue(flag) {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && i < process.argv.length - 1) return process.argv[i + 1];
  const pref = `${flag}=`;
  const kv = process.argv.find(a => a.startsWith(pref));
  return kv ? kv.slice(pref.length) : undefined;
}

// ---------- prompt (OSINT / political / intel / media analyst) ----------
const SYS_PROMPT = `
You are an OSINT / political / intelligence / media analyst.
Your task: extract structured intelligence from ONE tweet.

SCOPE
- Use ONLY what is in the tweet text itself. Do NOT assume facts, follow links, or add world knowledge beyond ordinary language understanding.
- If a field cannot be inferred, use null (for scalars) or [] (for lists). Be conservative.

OUTPUT
- Return STRICT JSON that matches the provided schema exactly.
- No extra keys, no comments, no trailing text.
- Keep writing short and neutral (analyst tone).

FIELD RULES:
- category: concise high-level label (e.g., conflict, disaster, politics, economy, crime, cyber, social, sports, other). Null if unclear.
- context: 1–2 neutral sentences summarizing the claim/event. Use “allegedly”, “reportedly” if unconfirmed.
- locations[]: Only if clearly implied in the TEXT (place, country if stated or strongly implied). Do NOT invent coordinates; set lat/lon = null unless explicitly present. If only a country/sea/strait is mentioned, use that as place; country may be null when unclear.
- future_scenarios[]: 2–4 plausible developments tied to the tweet, each with likelihood 0..1 (calibrated).
- knock_on_effects[]: 2–4 second-order impacts (markets, shipping, escalation, protests, sanctions, etc.) with likelihood 0..1.
- entities.people/organizations/equipment: extract proper nouns & distinct references; deduplicate; prefer canonical forms if stated.
- event_type: specific taxonomy-friendly label if evident (e.g., "drone_attack","protest","sanctions","cyber_attack"); null if unclear.
- time_window: past_event | ongoing | next_24h | next_week | unclear.
- sentiment: toward the EVENT, -1..1. If impossible, 0.
- risk_score: 0..1 operational significance based on the text; be conservative.
- credibility: 0..1 from text cues only (hedging, sensationalism, evidence, specificity).
- sources_to_verify: URLs in text or 2–3 short search queries to verify.
- confidence: 0..1 overall confidence in extraction.
- needs_higher_model: true ONLY if sarcasm/irony likely, complex geopolitics/technical nuance, ambiguous actors/locations/date, non-English idioms, or media forensics required.

STYLE & GUARDRAILS
- Do NOT invent names, places, numbers, dates, or links.
- If an emoji/flag implies a country but text is ambiguous, you may set country with lower credibility/confidence.
- Arrays may be empty. Scalars may be null. Numbers are 0..1 (one or two decimals).
- Keep each scenario/effect to a single concise clause.

Return only the JSON object per schema.
`;

// Last-resort schema hint for json-only pass
const SCHEMA_HINT = `
Output a JSON object with these top-level keys:
category, context, locations, future_scenarios, knock_on_effects,
entities, event_type, time_window, sentiment, risk_score, credibility,
sources_to_verify, confidence, needs_higher_model, notes.
If unknown: null (for scalars) or [] (for arrays). Do not include extra keys.`;

// ---------- utilities ----------
function getTweetId(doc) {
  if (doc.tweetId) return String(doc.tweetId);
  const m = typeof doc.url === 'string' && doc.url.match(/status\/(\d+)/);
  if (m) return m[1];
  return String(doc._id);
}
function createHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h += (h<<1)+(h<<4)+(h<<7)+(h<<8)+(h<<24); }
  return (h >>> 0).toString(16);
}
function stripCodeFences(s = '') {
  return s.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
}

// JSON snip extractor that ignores braces inside strings
function extractFirstJsonSnip(text = '') {
  const OPENERS = ['{', '['];
  const CLOSERS = { '{': '}', '[': ']' };
  let start = -1, opener = '', depth = 0;
  let inStr = false, strQuote = '', escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inStr) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === strQuote) { inStr = false; strQuote = ''; }
      continue;
    }

    if (ch === '"' || ch === "'") { inStr = true; strQuote = ch; continue; }

    if (start < 0 && OPENERS.includes(ch)) { start = i; opener = ch; depth = 1; continue; }
    if (start >= 0) {
      if (ch === opener) depth++;
      else if (ch === CLOSERS[opener]) depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return '';
}

function extractJsonFromResponse(resp) {
  // Prefer a structured json content item
  const content = resp?.output?.[0]?.content ?? [];
  const jsonItem =
    content.find(c => c?.type === 'output_json' && c?.json) ||
    content.find(c => c?.json);
  if (jsonItem?.json && typeof jsonItem.json === 'object') return jsonItem.json;

  // Fall back to text fields
  const textFromItems = content.map(c => c?.text).filter(Boolean).join('').trim();
  let text = textFromItems || resp?.output_text || '';
  text = stripCodeFences(text);

  const candidate = extractFirstJsonSnip(text);
  if (!candidate) {
    const err = new Error('No JSON found in response text');
    err.rawText = text.slice(0, 400);
    throw err;
  }
  return JSON.parse(candidate);
}

// ---------- strict JSON Schema (Responses text.format + strict:true) ----------
const enrichmentSchema = {
  name: 'tweet_enrichment',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      category:            { type: ['string','null'] },
      context:             { type: ['string','null'] },

      locations: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            place:   { type: 'string' },
            country: { type: ['string','null'] },
            lat:     { type: ['number','null'] },
            lon:     { type: ['number','null'] }
          },
          required: ['place','country','lat','lon']
        }
      },

      future_scenarios: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            scenario:   { type: 'string' },
            likelihood: { type: 'number' } // 0..1
          },
          required: ['scenario','likelihood']
        }
      },

      knock_on_effects: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            effect:     { type: 'string' },
            likelihood: { type: 'number' } // 0..1
          },
          required: ['effect','likelihood']
        }
      },

      entities: {
        type: 'object',
        additionalProperties: false,
        properties: {
          people:        { type: 'array', items: { type: 'string' } },
          organizations: { type: 'array', items: { type: 'string' } },
          equipment:     { type: 'array', items: { type: 'string' } }
        },
        required: ['people','organizations','equipment']
      },

      event_type:  { type: ['string','null'] },

      time_window: {
        type: ['string','null'],
        enum: ['past_event','ongoing','next_24h','next_week','unclear', null]
      },

      sentiment:    { type: ['number','null'] },   // -1..1
      risk_score:   { type: ['number','null'] },   // 0..1
      credibility:  { type: ['number','null'] },   // 0..1
      sources_to_verify: { type: 'array', items: { type: 'string' } },
      confidence:   { type: 'number' },            // 0..1
      needs_higher_model: { type: 'boolean' },
      notes:        { type: ['string','null'] }
    },
    required: [
      'category','context','locations','future_scenarios','knock_on_effects',
      'entities','event_type','time_window','sentiment','risk_score','credibility',
      'sources_to_verify','confidence','needs_higher_model','notes'
    ]
  }
};

// ---------- model call (resilient cascade) ----------
async function callModel({ tweet, model }) {
  // 1) PRIMARY strict schema
  // 2) PRIMARY loose schema
  // 3) ESCALATION strict schema
  // 4) ESCALATION plain JSON (no schema), with tight instruction
  const tries = [
    { model, variant: 'schema-strict' },
    { model, variant: 'schema-loose' },
    { model: ESCALATION_MODEL, variant: 'schema-strict' },
    { model: ESCALATION_MODEL, variant: 'json-only' }
  ];

  let lastErr;
  for (const t of tries) {
    try {
      const out = await callModelOnce({ tweet, model: t.model, variant: t.variant });
      return out; // success
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('Model failed on all attempts');
}

async function callModelOnce({ tweet, model, variant }) {
  const isReasoning = /^o3($|-)|^o4-mini($|-)/.test(model);

  // base prompts
  const sys = SYS_PROMPT;
  const userBase = `TWEET TEXT:
${tweet.text || ''}

TWEET META:
account=${tweet.account || ''} url=${tweet.url || ''} datetime=${tweet.datetime || ''}`;

  // variant tweaks
  const textFormat =
    variant === 'json-only'
      ? { type: 'json' }
      : {
          type: 'json_schema',
          name: enrichmentSchema.name,
          strict: variant === 'schema-loose' ? false : enrichmentSchema.strict,
          schema: enrichmentSchema.schema
        };

  const user =
    variant === 'json-only'
      ? `${userBase}

Return ONLY a valid JSON object. ${SCHEMA_HINT}`
      : userBase;

  const resp = await openai.responses.create({
    model,
    ...(isReasoning ? { reasoning: { effort: 'medium' } } : {}),
    input: [
      { role: 'system', content: sys },
      { role: 'user',  content: user }
    ],
    ...(isReasoning ? {} : { temperature: 0.2 }), // omit temperature for o3/o4-mini
    max_output_tokens: 1200,
    text: { format: textFormat }
  });

  return extractJsonFromResponse(resp);
}

// ---------- enrichment pipeline ----------
async function enrichOne(db, doc) {
  const tweetId = getTweetId(doc);
  const text = doc.text ?? '';
  let result;
  let modelUsed = PRIMARY_MODEL;

  try {
    result = await callModel({ tweet: doc, model: PRIMARY_MODEL });
    if (result?.needs_higher_model && (result?.confidence ?? 0) < 0.6) {
      // escalate on ambiguous/low-confidence
      result = await callModel({ tweet: doc, model: ESCALATION_MODEL });
      modelUsed = ESCALATION_MODEL;
    }
  } catch (e) {
    console.error('Primary+fallbacks failed:', e.message);
    const raw = (e.rawText || e.message || '').toString().slice(0, 400);
    result = { error: e.message || 'Unknown parse error', raw_snip: raw, needs_higher_model: true, confidence: 0 };
  }

  const now = new Date();
  const success = result && !result.error && typeof result.confidence === 'number';

  const enrichDoc = {
    tweetId,
    tweet_url: doc.url ?? null,
    tweet_datetime: doc.datetime ?? null,
    account: doc.account ?? null,
    ...result,
    model_used: modelUsed,
    hash: createHash(JSON.stringify({ text, modelUsed })),
    updatedAt: now
  };

  // Upsert into enrichment collection
  await db.collection(ENRICH_COLL).updateOne(
    { tweetId },
    { $set: enrichDoc },
    { upsert: true }
  );

  // Only mark tweet as enriched on success
  const setOnSuccess = success ? { enriched: true, enrichedAt: now } : { enriched: false };
  const pointer = success && WRITE_BACK_POINTER
    ? { enrichmentRef: { tweetId, coll: ENRICH_COLL, updatedAt: now } }
    : {};
  await db.collection(TWEETS_COLL).updateOne(
    { _id: doc._id },
    { $set: { ...setOnSuccess, ...pointer } }
  );

  return { tweetId, modelUsed, success };
}

function makeFilter() {
  if (ARG_ID) {
    const ors = [{ tweetId: ARG_ID }];
    try { ors.push({ _id: new ObjectId(ARG_ID) }); } catch (_) {}
    return { $or: ors };
  }
  if (ARG_FORCE) return {}; // process everything
  // default: only not-yet enriched
  return { $or: [ { enriched: { $exists: false } }, { enriched: false } ] };
}

async function main() {
  const mongo = new MongoClient(MONGODB_URI);
  await mongo.connect();
  const db = mongo.db(DB_NAME);

  const filter = makeFilter();
  console.log(`DB: ${DB_NAME}, tweets: ${TWEETS_COLL}, enrichments: ${ENRICH_COLL}`);
  console.log(`Filter: ${JSON.stringify(filter)}`);
  console.log(`Fetch limit: ${FETCH_LIMIT}, Concurrency: ${CONCURRENCY}, Models: ${PRIMARY_MODEL} -> ${ESCALATION_MODEL}`);

  const coll = db.collection(TWEETS_COLL);
  const total = await coll.countDocuments(filter);
  console.log(`Matching tweets: ${total}`);

  if (ARG_PEEK) {
    const sample = await coll.find(filter).project({ _id: 1, tweetId: 1, enriched: 1, url: 1, text: 1 }).limit(5).toArray();
    console.log('Peek (first up to 5 docs):');
    for (const d of sample) {
      console.log({ _id: String(d._id), tweetId: d.tweetId, enriched: d.enriched, url: d.url, text: (d.text || '').slice(0, 120) });
    }
    if (total === 0) { await mongo.close(); console.log('Nothing to process.'); return; }
  }

  if (total === 0) {
    await mongo.close();
    console.log('Nothing to process.');
    return;
  }

  const cursor = coll.find(filter).limit(FETCH_LIMIT);
  const limit = pLimit(CONCURRENCY);
  const tasks = [];
  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    tasks.push(limit(() => enrichOne(db, doc).catch(err => {
      console.error('Failed to enrich tweet', getTweetId(doc), err.message);
    })));
  }

  const results = await Promise.allSettled(tasks);
  const ok = results.filter(r => r.status === 'fulfilled' && r.value?.success).length;
  const fail = results.length - ok;

  await mongo.close();
  console.log(`Enrichment done. Success: ${ok}, Failed (or parse error stored): ${fail}`);
}

main().catch(err => { console.error(err); process.exit(1); });
