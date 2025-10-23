import express from "express";
import { getCollection } from "../db.js";
import { sanitizeFilter, parseJSONParam, parseFieldsParam, getCollectionGuard } from "../middleware/sanitize.js";
import { ObjectId } from "mongodb";

const router = express.Router();

// Guard by allowed collections (optional via env)
router.use("/:collection", getCollectionGuard());

// GET /api/:collection
router.get("/:collection", async (req, res) => {
  try {
    const { collection } = req.params;
    const {
      q, sort, fields, page = "1", limit, skip
    } = req.query;

    const DEFAULT_LIMIT = Number(process.env.DEFAULT_LIMIT || 25);
    const MAX_LIMIT = Number(process.env.MAX_LIMIT || 200);

    // Parse & sanitize
    const filterRaw = parseJSONParam(q) || {};
    const filter = sanitizeFilter(filterRaw);
    const sortSpec = parseJSONParam(sort) || undefined;
    const projection = parseFieldsParam(fields);
    let lim = Math.min(Number(limit || DEFAULT_LIMIT), MAX_LIMIT);
    if (Number.isNaN(lim) || lim <= 0) lim = DEFAULT_LIMIT;
    let skp = Number(skip || 0);
    if (Number.isNaN(skp) || skp < 0) {
      const p = Number(page);
      skp = !Number.isNaN(p) && p > 1 ? (p - 1) * lim : 0;
    }

    const col = await getCollection(collection);
    const cursor = col.find(filter, { projection }).sort(sortSpec).skip(skp).limit(lim);
    const docs = await cursor.toArray();
    const total = await col.countDocuments(filter);

    res.json({
      collection,
      filter,
      sort: sortSpec || null,
      fields: projection ? Object.keys(projection) : null,
      page: Math.floor(skp / lim) + 1,
      limit: lim,
      total,
      results: docs,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

// GET /api/:collection/:id
router.get("/:collection/:id", async (req, res) => {
  try {
    const { collection, id } = req.params;
    const col = await getCollection(collection);

    const _id = ObjectId.isValid(id) ? new ObjectId(id) : id;
    const doc = await col.findOne({ _id });

    if (!doc) return res.status(404).json({ error: "Not found" });

    // OPTIONAL: include enrichment in a single response
    // Usage: GET /api/tweets/:id?include=enrichment
    if (collection === (process.env.TWEETS_COLL || "tweets") &&
        String(req.query.include || "").toLowerCase() === "enrichment") {
      const enrichCol = await getCollection(process.env.ENRICH_COLL || "tweet_enrichments");
      const tweetId = String(doc.tweetId || "");
      const enrichment = tweetId
        ? await enrichCol.findOne({ tweetId })
        : null;
      return res.json({ ...doc, enrichment });
    }

    res.json(doc);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

export default router;
