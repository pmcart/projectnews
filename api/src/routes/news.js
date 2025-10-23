import express from "express";
import { getCollection } from "../db.js";
import { execFile } from "node:child_process";
import path from "node:path";

const router = express.Router();

/**
 * Where the ingest job lives. Override with NEWS_JOB_SCRIPT if your file
 * is elsewhere (e.g. monorepo ./ingest/newsJob.js).
 */
const JOB_SCRIPT =
  process.env.NEWS_JOB_SCRIPT ||
  path.resolve(process.cwd(), "rss-feeds-job.js");

/** simple in-memory lock so we don't spawn duplicates for the same key */
const inflight = new Map(); // key -> Promise

function keyFor(region, category) {
  return `${region.toLowerCase()}_${(category || "all").toLowerCase()}`;
}

function toCollectionName(region, category) {
  const r = String(region || "us").toLowerCase();
  const c = String(category || "all").toLowerCase();
  return `${r}_${c}`;
}

/**
 * Run the RSS ingest job via child process.
 * Uses the same Node executable (process.execPath).
 */
function runNewsJob({ region, category }) {
  return new Promise((resolve, reject) => {
    const args = [JOB_SCRIPT, `--region=${region}`];
    if (category) args.push(`--category=${category}`);
    execFile(
      process.execPath,
      args,
      {
        env: process.env,
        cwd: process.cwd(),
        timeout: Number(process.env.NEWS_JOB_TIMEOUT_MS || 120_000),
      },
      (err, stdout, stderr) => {
        if (stdout) console.log("[newsJob stdout]", String(stdout).slice(0, 2000));
        if (stderr) console.warn("[newsJob stderr]", String(stderr).slice(0, 2000));
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

/**
 * Ensure there are docs in the target collection.
 * If empty, spawn the ingest job (de-duped by in-memory lock).
 */
async function ensureIngestIfEmpty(region, category) {
  const collectionName = toCollectionName(region, category);
  const col = await getCollection(`regional_news.${collectionName}`);

  // fastest cheap check
  const hasAny = await col.estimatedDocumentCount().then((c) => c > 0).catch(() => false);
  if (hasAny) return { triggered: false };

  const lockKey = keyFor(region, category);
  if (!inflight.has(lockKey)) {
    const p = runNewsJob({ region, category })
      .catch((e) => {
        console.error("newsJob failed:", e?.message || e);
      })
      .finally(() => inflight.delete(lockKey));
    inflight.set(lockKey, p);
  }
  await inflight.get(lockKey);
  return { triggered: true };
}

/**
 * GET /api/news?region=us&category=science
 * If category omitted -> us_all.
 * If collection empty -> run newsJob.js, then re-query.
 */
router.get("/", async (req, res) => {
  try {
    const region = (req.query.region || "us").toString();
    const category = req.query.category ? req.query.category.toString() : undefined;

    const limit = Math.min(Number(req.query.limit) || 50, Number(process.env.MAX_LIMIT || 200));
    const skip = Math.max(Number(req.query.skip) || 0, 0);

    const collectionName = toCollectionName(region, category);
    const col = await getCollection(`regional_news.${collectionName}`);

    // Try fetch
    let cursor = col.find({}, { projection: undefined }).sort({ pubDate: -1, _id: -1 }).skip(skip).limit(limit);
    let docs = await cursor.toArray();
    let total = await col.estimatedDocumentCount();

    // If nothing, try to ingest, then re-query
    let ingestionTriggered = false;
    if (total === 0) {
      const { triggered } = await ensureIngestIfEmpty(region, category);
      ingestionTriggered = triggered;

      // re-query after ingest attempt
      cursor = col.find({}, { projection: undefined }).sort({ pubDate: -1, _id: -1 }).skip(skip).limit(limit);
      docs = await cursor.toArray();
      total = await col.estimatedDocumentCount();
    }

    res.json({
      region: region.toLowerCase(),
      category: (category || "all").toLowerCase(),
      collection: collectionName,
      ingestionTriggered,
      total,
      limit,
      skip,
      results: docs,
    });
  } catch (err) {
    console.error("Error fetching regional news:", err);
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

export default router;
