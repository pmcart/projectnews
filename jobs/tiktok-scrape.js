
require('dotenv').config();
const { MongoClient, ServerApiVersion } = require('mongodb');
const { chromium } = require('playwright');

const {
  // SECURITY: no dangerous default. Require MONGO_URL to be set.
  MONGO_URI,
  DB_NAME = 'org1',
  HEADLESS = 'true',
  MAX_TWEETS = '50',
  TIKTOK_REGION = 'IE',
  QUERY_MAXLEN = '180',

  // --- rate-limit & retry controls (tunable)
  QPM = '6',                 // max queries per minute (spread evenly)
  MIN_DELAY_MS = '0',        // extra floor between queries
  JITTER_MS = '750',         // random +/- jitter per query
  RETRIES = '4',             // max retries per failed query
  BACKOFF_BASE_MS = '1500',  // base backoff
  BACKOFF_FACTOR = '1.8',    // exponential factor
  BACKOFF_MAX_MS = '20000',  // max backoff cap
} = process.env;

if (!MONGO_URI) {
  console.error('Missing MONGO_URL (set it in your environment or .env file)');
  process.exit(1);
}

const maxTweets = Math.max(1, Number(MAX_TWEETS));
const queryMaxLen = Math.max(30, Math.min(500, Number(QUERY_MAXLEN)));

const qpm = Math.max(1, Number(QPM));
const minDelayMs = Math.max(0, Number(MIN_DELAY_MS));
const jitterMs = Math.max(0, Number(JITTER_MS));
const retries = Math.max(0, Number(RETRIES));
const backoffBase = Math.max(0, Number(BACKOFF_BASE_MS));
const backoffFactor = Math.max(1, Number(BACKOFF_FACTOR));
const backoffMax = Math.max(0, Number(BACKOFF_MAX_MS));

const SLOT_MS = Math.ceil(60000 / qpm);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (ms) => {
  if (ms <= 0 || jitterMs <= 0) return ms;
  const delta = Math.floor(Math.random() * (2 * jitterMs)) - jitterMs; // [-jitter, +jitter]
  return Math.max(0, ms + delta);
};

// Simple leaky-bucket rate limiter: ensures at least SLOT_MS + MIN_DELAY_MS (±jitter) between queries
class RateLimiter {
  constructor() {
    this.nextAt = 0;
  }
  async acquire() {
    const now = Date.now();
    const wait = Math.max(0, this.nextAt - now);
    if (wait > 0) await sleep(wait);
    // schedule the next slot
    const gap = jitter(SLOT_MS + minDelayMs);
    this.nextAt = Math.max(Date.now(), this.nextAt) + gap;
  }
}

function truncateQuery(q) {
  if (!q) return '';
  const s = String(q).replace(/\s+/g, ' ').trim();
  return s.length > queryMaxLen ? s.slice(0, queryMaxLen) : s;
}

async function openBrowser() {
  const browser = await chromium.launch({ headless: HEADLESS.toLowerCase() === 'true' });
  const ctx = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
  });
  const page = await ctx.newPage();
  await page.goto('https://www.tiktok.com/', { waitUntil: 'domcontentloaded' });
  // Gracefully accept cookies if a banner exists
  try {
    await page.getByRole('button', { name: /accept|agree|allow/i }).first().click({ timeout: 3000 });
  } catch {}
  return { browser, ctx, page };
}

// --- TikTok fetch with status surfaced so we can backoff on 429/403/5xx
async function rawTikTokSearch(page, url) {
  return page.evaluate(async (u) => {
    try {
      const r = await fetch(u, { credentials: 'include' });
      let body = null;
      try { body = await r.json(); } catch {}
      return { ok: r.ok, status: r.status, body };
    } catch (e) {
      return { ok: false, status: 0, body: null };
    }
  }, url);
}

function buildTikTokSearchUrl(q, region = 'IE') {
  const params = new URLSearchParams({
    WebIdLastTime: String(Math.floor(Date.now() / 1000)),
    aid: '1988',
    app_language: 'en',
    app_name: 'tiktok_web',
    browser_language: 'en-US',
    browser_name: 'Mozilla',
    browser_online: 'true',
    browser_platform: 'Win32',
    device_platform: 'web_pc',
    device_type: 'web_h265',
    from_page: 'search',
    keyword: q,
    offset: '0',
    os: 'windows',
    region,
    search_source: 'normal_search',
    tz_name: 'Europe/Dublin',
    webcast_language: 'en',
  });
  return `https://www.tiktok.com/api/search/general/full/?${params.toString()}`;
}

function extractSearchItems(data) {
  // TikTok often nests results; walk and lift item entries
  const items = [];
  const walk = (v) => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v && typeof v === 'object') {
      if (v.item?.id) items.push(v.item);
      Object.values(v).forEach(walk);
    }
  };
  walk(data);
  return items;
}

async function tiktokSearch(page, q, region = 'IE', limit = 10) {
  const url = buildTikTokSearchUrl(q, region);
  const res = await rawTikTokSearch(page, url);
  if (!res.ok) {
    const err = new Error(`TikTok HTTP ${res.status || 0}`);
    err.status = res.status || 0;
    throw err;
  }

  const items = extractSearchItems(res.body || {});
  const out = items
    .map((it) => ({
      tiktokId: String(it?.id ?? ''),
      username: it?.author?.uniqueId ?? null,
      url: (it?.author?.uniqueId && it?.id) ? `https://www.tiktok.com/@${it.author.uniqueId}/video/${it.id}` : null,
      desc: it?.desc || '',
      createTime: it?.createTime ? new Date(Number(it.createTime) * 1000) : null,
    }))
    .filter((v) => v.url && v.tiktokId) // keep only valid links
    .sort((a, b) => ((b.createTime ?? 0) - (a.createTime ?? 0)))
  // Deduplicate by tiktokId just in case
  const seen = new Set();
  const deduped = [];
  for (const it of out) {
    if (!seen.has(it.tiktokId)) {
      seen.add(it.tiktokId);
      deduped.push(it);
    }
  }
  return deduped.slice(0, limit);
}

// wrapper that applies rate limit + retries with exponential backoff + jitter
async function limitedSearchWithRetries(rl, page, query, region) {
  let attempt = 0;
  while (true) {
    await rl.acquire(); // <- stagger before each call

    try {
      return await tiktokSearch(page, query, region, 10);
    } catch (e) {
      attempt++;
      const status = e.status || 0;
      const retriable =
        status === 0 || status === 429 || status === 403 || (status >= 500 && status < 600);

      if (!retriable || attempt > retries) {
        throw e;
      }

      // exponential backoff with cap + jitter
      const backoff =
        Math.min(backoffMax, Math.floor(backoffBase * Math.pow(backoffFactor, attempt - 1)));
      const wait = jitter(backoff);
      console.warn(`Retry ${attempt} after ${wait}ms (status ${status}) for query "${query.slice(0, 60)}"...`);
      await sleep(wait);
    }
  }
}

(async () => {
  let client, browser, ctx;
  try {
    // --- Mongo
    client = new MongoClient(MONGO_URI, {
      serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
      maxPoolSize: 10,
    });
    await client.connect();
    const db = client.db(DB_NAME);
    const tweetsCol = db.collection('tweets');
    const resultsCol = db.collection('tweet_tiktoks');

    // Indexes (idempotent)
    await Promise.all([
      resultsCol.createIndex({ tweetId: 1, tiktokId: 1 }, { unique: true, name: 'tweetId_tiktokId_unique' }),
      resultsCol.createIndex({ tweetId: 1, createdAt: -1 }, { name: 'tweetId_createdAt' }),
      tweetsCol.createIndex({ tiktoks_processed: 1, datetime: -1 }, { name: 'processed_datetime' }),
    ]);

    // Pull unprocessed tweets with non-empty text
    const tweets = await tweetsCol
      .find({ tiktoks_processed: { $ne: true }, text: { $type: 'string', $ne: '' } })
      .sort({ datetime: -1 })
      .limit(maxTweets)
      .toArray();

    if (!tweets.length) {
      console.log('No unprocessed tweets found.');
      await client.close();
      process.exit(0);
    }

    // --- Browser
    ({ browser, ctx, page } = await openBrowser());

    // Small randomized initial delay so multiple workers started together desynchronize
    await sleep(jitter(500 + Math.floor(Math.random() * 1000)));

    const rl = new RateLimiter();

    let processed = 0;
    for (const tw of tweets) {
      const query = truncateQuery(tw.text || '');
      const now = new Date();

      // Always compute tweetId consistently
      const tweetId = tw.tweetId
        || (tw.url ? (tw.url.match(/status\/(\d+)/)?.[1] ?? null) : null)
        || null;

      if (!query) {
        await tweetsCol.updateOne(
          { _id: tw._id },
          { $set: { tiktoks_processed: true, tiktoks_processedAt: now, tiktoks_count: 0 } }
        );
        processed++;
        continue;
      }

      // Perform TikTok search with rate limiting + backoff
      let items = [];
      try {
        items = await limitedSearchWithRetries(rl, page, query, TIKTOK_REGION);
      } catch (e) {
        console.warn(`TikTok search failed for tweet ${tweetId || tw.url || tw._id}: ${e.message}`);
      }

      if (items.length) {
        // Prepare bulk upserts for tweet_tiktoks
        const ops = items.map((it) => ({
          updateOne: {
            filter: { tweetId, tiktokId: it.tiktokId },
            update: {
              // IMPORTANT: do not mix multiple operators on the same top-level path.
              $setOnInsert: {
                tweetId,
                tweetUrl: tw.url || null,
                query,
                tiktokId: it.tiktokId,
                tiktokUrl: it.url,
                tiktokUsername: it.username || null,
                tiktokDesc: it.desc || '',
                tiktokCreateTime: it.createTime || null,
                createdAt: now,
              },
              $set: { lastSeenAt: now },
            },
            upsert: true,
          },
        }));

        if (ops.length) {
          try {
            await resultsCol.bulkWrite(ops, { ordered: false });
          } catch (e) {
            // Ignore dup key races; rethrow anything else
            if (!/E11000 duplicate key error/.test(e.message)) throw e;
          }
        }
      }

      // Mark processed regardless (this collection has no `videos` field, so no conflict)
      await tweetsCol.updateOne(
        { _id: tw._id },
        {
          $set: {
            tiktoks_processed: true,
            tiktoks_processedAt: now,
            tiktoks_count: items.length,
          },
        }
      );

      processed++;
    }

    // Clean close
    await ctx?.close().catch(() => {});
    await browser?.close().catch(() => {});
    await client.close().catch(() => {});
    console.log(`Done. Processed ${processed} tweet(s).`);
  } catch (err) {
    // Best-effort close on error
    try { await ctx?.close(); } catch {}
    try { await browser?.close(); } catch {}
    try { await client?.close(); } catch {}
    console.error('Fatal error:', err);
    process.exit(1);
  }
})();
