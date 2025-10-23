import express from "express";
import OpenAI from "openai";
import { ObjectId } from "mongodb";
import { getCollection } from "../db.js";
import z from "zod";

const router = express.Router();

/**
 * ENV CONFIG
 * - OPENAI_API_KEY must be set in the environment
 * - OPENAI_MODEL optional (default: gpt-4o)
 * - TWEETS_DB optional namespace for collections (default: "tweets")
 * - TWEETS_COLLECTION optional (default: "tweets")
 */
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o";
const TWEETS_DB = process.env.TWEETS_DB || "tweets";
const TWEETS_COLLECTION = process.env.TWEETS_COLLECTION || "tweets";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---- Validation ----
const reqSchema = z.object({
  tweetId: z.string().min(1, "tweetId required"),
  persona: z.string().min(1),
  sentiment: z.enum(["Negative", "Neutral", "Positive"]),
  style: z.enum([
    "Press Release",
    "News Article",
    "Social Media Post",
    "Speech Excerpt",
    "Op-Ed",
    "Blog Post",
  ]),
  platform: z.string().optional().nullable(),
  region: z.string().optional().nullable(),
  urgency: z.enum(["Routine", "Time-sensitive", "Crisis / Rapid Response"]).optional().nullable(),
  tone: z.string().optional().nullable(),
  audience: z.string().optional().nullable(),
  title: z.string().optional().nullable(),
  comments: z.string().max(1200).optional().nullable(),
  readingLevel: z.number().int().min(4).max(16),
  length: z.number().int().min(50).max(1200),
  includeQuotes: z.boolean(),
  includeDisclaimers: z.boolean(),
  source: z
    .object({ url: z.string().url().optional().nullable(), account: z.string().optional().nullable() })
    .optional()
    .nullable(),
});

// ---- Helpers ----
async function fetchTweet(tweetId) {
  const col = await getCollection("org1.tweets");
  const doc = await col.findOne({ tweetId: String(tweetId).trim() });
  if (!doc) throw new Error("Tweet not found");
  return doc;
}

function styleDirectives(style, platform) {
  switch (style) {
    case "Press Release":
      return `Write a concise press release with: headline, subhead (optional), dateline, body with quotes (if provided), and boilerplate. Avoid marketing fluff. Include contact info placeholder.`;
    case "News Article":
      return `Write an objective inverted-pyramid news piece with a straight lede, nut graf, and 2-4 short paragraphs. No invented facts.`;
    case "Social Media Post":
      return `Draft a platform-appropriate post${platform ? ` for ${platform}` : ""}. Respect typical length limits, include a crisp hook and 1-2 relevant hashtags. No emojis unless essential.`;
    case "Speech Excerpt":
      return `Write a short speech excerpt suitable for delivery. Keep sentences speakable, use cadence and parallelism. Include [PAUSE] markers sparingly.`;
    case "Op-Ed":
      return `Write an op-ed with a clear thesis, 2-3 supporting points, and a firm conclusion. Avoid strawmen; acknowledge counterpoints.`;
    case "Blog Post":
      return `Write a short blog post with a scannable structure: intro, 2-3 sections with mini-headings, and a takeaway.`;
    default:
      return `Write a clear, factual piece.`;
  }
}

function buildSystemPrompt(payload, tweet) {
  const { persona, tone, region, audience, readingLevel, includeDisclaimers } = payload;
  const disclaimers = includeDisclaimers
    ? "\n- Add a brief 'Context & Sources' note with the tweet URL if available."
    : "";
  return (
    `You are an expert ${persona.toLowerCase()} communications writer. ` +
    `Write at a reading grade around ${readingLevel}. ` +
    (tone ? `Adopt a ${tone.toLowerCase()} tone. ` : "") +
    (audience ? `Target audience: ${audience}. ` : "") +
    (region ? `Primary geography: ${region}. ` : "") +
    `Do not fabricate facts. If information is missing, remain silent about it.` +
    disclaimers
  );
}

function buildUserPrompt(payload, tweet) {
  const dir = styleDirectives(payload.style, payload.platform);
  const quoteRule = payload.includeQuotes ? "Use only quotes present in tweet text or notes (if any), with attribution." : "Do not include direct quotes.";
  const sourceUrl = payload.source?.url || tweet?.url || null;

  return `
STYLE: ${payload.style}
SENTIMENT: ${payload.sentiment}
URGENCY: ${payload.urgency || "Routine"}
LENGTH: ~${payload.length} words
${dir}
${quoteRule}

SOURCE TWEET:
— id: ${payload.tweetId}
— account: ${payload.source?.account || tweet?.account || "unknown"}
— url: ${sourceUrl || "n/a"}
— datetime: ${tweet?.datetime || "n/a"}
— text:
${tweet?.text || "(no text)"}
${Array.isArray(tweet?.images) && tweet.images.length ? `— images: ${tweet.images.map((i) => (typeof i === 'string' ? i : i?.url)).filter(Boolean).join(', ')}` : ""}

EXTRA NOTES:
${payload.title ? `Working title: ${payload.title}\n` : ""}${payload.comments || "(none)"}
`;
}

// ---- Route ----
router.post("/", async (req, res) => {
  try {
    const parsed = reqSchema.parse(req.body || {});

    // 1) Fetch tweet from DB (server-side source of truth)
    const tweet = await fetchTweet(parsed.tweetId).catch((e) => {
      // Fallback: if not found server-side, still proceed using any client-provided source url/account
      console.warn("[generate-content] tweet not found in DB:", e?.message || e);
      return null;
    });

    // 2) Build prompts
    const system = buildSystemPrompt(parsed, tweet);
    const user = buildUserPrompt(parsed, tweet);

    // 3) Call OpenAI (Responses API)
    const response = await client.responses.create({
      model: OPENAI_MODEL,
      input: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });

    const output = response.output_text || "";

    // 4) Persist in MongoDB Atlas: org1.generated_content
    //    Assumes your getCollection helper accepts "db.collection" namespace
    let insertResult = null;
    try {
      const col = await getCollection("generated_content");
      insertResult = await col.insertOne({
        tweetId: parsed.tweetId,
        createdAt: new Date(),
        style: parsed.style,
        persona: parsed.persona,
        sentiment: parsed.sentiment,
        platform: parsed.platform ?? null,
        region: parsed.region ?? null,
        urgency: parsed.urgency ?? null,
        tone: parsed.tone ?? null,
        audience: parsed.audience ?? null,
        title: parsed.title ?? null,
        comments: parsed.comments ?? null,
        readingLevel: parsed.readingLevel,
        length: parsed.length,
        includeQuotes: parsed.includeQuotes,
        includeDisclaimers: parsed.includeDisclaimers,
        source: parsed.source ?? null,
        tweetRef: tweet ? { _id: tweet._id, account: tweet.account, url: tweet.url, datetime: tweet.datetime } : null,
        model: OPENAI_MODEL,
        openai: {
          responseId: response.id,
        },
        content: output,
        status: "succeeded",
      });

      // Helpful index hints (run once via Mongo shell/GUI):
      //   db.getSiblingDB('org1').generated_content.createIndex({ tweetId: 1, createdAt: -1 })
      //   db.getSiblingDB('org1').generated_content.createIndex({ createdAt: -1 })
    } catch (e) {
      console.warn("[generate-content] persist warning:", e?.message || e);
    }

    // 5) Respond with persisted _id when available
    return res.json({ ok: true, content: output, model: OPENAI_MODEL, id: insertResult?.insertedId });
  } catch (err) {
    console.error("[generate-content] error:", err);
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid request", details: err.errors });
    }
    return res.status(500).json({ error: "Server error", details: err.message });
  }
});

// ---- GET /api/generate-content/:id ----
// Fetch a single generated document by its ObjectId from org1.generated_content
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    let _id;
    try {
      _id = new ObjectId(id);
    } catch {
      return res.status(400).json({ error: "Invalid id" });
    }

    const col = await getCollection("generated_content");
    const doc = await col.findOne({ _id });
    if (!doc) return res.status(404).json({ error: "Not found" });
    return res.json(doc);
  } catch (err) {
    console.error("[generate-content:GET/:id] error:", err);
    return res.status(500).json({ error: "Server error", details: err && err.message ? err.message : String(err) });
  }
});

// ---- GET /api/generate-content ----
// List generated documents from org1.generated_content with cursor pagination
// Query params:
//   - limit?: number (default 20, max 100)
//   - cursor?: string (ObjectId; returns items with _id < cursor)
//   - tweetId?: string (filter)
//   - style?: string (filter)
//   - persona?: string (filter)
//   - sentiment?: "Negative" | "Neutral" | "Positive" (filter)
//   - includeContent?: "1" to include full content (default excludes content for speed)
router.get("/", async (req, res) => {
  try {
    const {
      limit = "20",
      cursor,
      tweetId,
      style,
      persona,
      sentiment,
      includeContent,
    } = req.query || {};

    const n = Math.min(Math.max(parseInt(String(limit), 10) || 20, 1), 100);

    const q = {};
    if (tweetId) q.tweetId = String(tweetId);
    if (style) q.style = String(style);
    if (persona) q.persona = String(persona);
    if (sentiment) q.sentiment = String(sentiment);
    if (cursor) {
      try {
        q._id = { $lt: new ObjectId(String(cursor)) };
      } catch {
        return res.status(400).json({ error: "Invalid cursor" });
      }
    }

    const col = await getCollection("generated_content");

    // Projection: exclude large content by default
    const projection = includeContent === "1" ? {} : { content: 0 };

    const docs = await col
      .find(q, { projection })
      .sort({ _id: -1 }) // newest first
      .limit(n)
      .toArray();

    const nextCursor = docs.length ? String(docs[docs.length - 1]._id) : null;

    return res.json({
      ok: true,
      results: docs,
      nextCursor,
    });
  } catch (err) {
    console.error("[generate-content:GET list] error:", err);
    return res
      .status(500)
      .json({ error: "Server error", details: err?.message || String(err) });
  }
});


export default router;
