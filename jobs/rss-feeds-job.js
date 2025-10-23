// newsJob.js
import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';
import Parser from 'rss-parser';
import * as cheerio from 'cheerio';
import { fetch } from 'undici';

dotenv.config();

/**
 * RSS parser with extra fields mapped.
 */
const parser = new Parser({
  // Ask rss-parser to preserve some namespaced fields if present
  customFields: {
    item: [
      ['media:content', 'mediaContent', { keepArray: true }],
      ['media:thumbnail', 'mediaThumbnail', { keepArray: true }],
      ['enclosure', 'enclosure'],
      ['source', 'source'], // e.g. <source url="...">Name</source>
      ['guid', 'guid'],
      ['content:encoded', 'contentEncoded'],
    ],
    feed: [
      ['image', 'feedImage'],
    ]
  }
});

/**
 * Build a Google News RSS URL for region + optional category.
 */
function buildGoogleNewsRssUrl({ region = 'US', category }) {
  const upperRegion = String(region || 'US').toUpperCase();
  const hl = `en-${upperRegion}`;
  const gl = upperRegion;
  const ceid = `${upperRegion}:en`;

  if (!category) {
    return `https://news.google.com/rss?hl=${hl}&gl=${gl}&ceid=${ceid}`;
  }

  const topicMap = {
    world: 'WORLD',
    nation: 'NATION',
    business: 'BUSINESS',
    technology: 'TECHNOLOGY',
    entertainment: 'ENTERTAINMENT',
    science: 'SCIENCE',
    sports: 'SPORTS',
    health: 'HEALTH',
  };

  const code = topicMap[String(category).toLowerCase()] || String(category).toUpperCase();
  return `https://news.google.com/rss/headlines/section/topic/${code}?hl=${hl}&gl=${gl}&ceid=${ceid}`;
}

/**
 * Collection naming: regional_news/<region>_<category|all>
 */
function toCollectionName(region, category) {
  const r = String(region || 'US').toLowerCase();
  const c = String(category || 'all').toLowerCase();
  return `${r}_${c}`;
}

/**
 * A gentle concurrency runner to avoid hammering publisher sites.
 */
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let i = 0;
  let inFlight = 0;

  return new Promise((resolve, reject) => {
    const next = () => {
      if (i >= items.length && inFlight === 0) return resolve(results);
      while (inFlight < limit && i < items.length) {
        const idx = i++;
        inFlight++;
        Promise.resolve(worker(items[idx], idx))
          .then((val) => { results[idx] = val; })
          .catch((err) => { results[idx] = { error: err?.message || String(err) }; })
          .finally(() => { inFlight--; next(); });
      }
    };
    next();
  });
}

/**
 * Try to extract an image URL from typical RSS fields.
 */
function pickImageUrlFromRSS(item) {
  // 1) media:content (can be array)
  const mc = item.mediaContent;
  if (Array.isArray(mc)) {
    for (const m of mc) {
      const attrs = m?.$ || m;
      if (attrs?.url) return attrs.url;
      if (Array.isArray(m)) {
        // sometimes rss-parser maps children weirdly; be defensive
        for (const mm of m) {
          const a = mm?.$ || mm;
          if (a?.url) return a.url;
        }
      }
    }
  }

  // 2) media:thumbnail
  const mt = item.mediaThumbnail;
  if (Array.isArray(mt)) {
    for (const t of mt) {
      const attrs = t?.$ || t;
      if (attrs?.url) return attrs.url;
    }
  }

  // 3) enclosure
  if (item.enclosure?.url) return item.enclosure.url;

  // 4) sometimes an image URL hides in contentEncoded/content/snippet
  const blob = [
    item.contentEncoded,
    item.content,
    item.contentSnippet,
    item.description
  ].filter(Boolean).join('\n');

  const m = blob.match(/https?:\/\/[^\s"'<>]+\.(?:png|jpe?g|gif|webp)/i);
  if (m) return m[0];

  return null;
}

/**
 * Resolve a Google News redirect to the publisher URL and scrape OG/Twitter meta.
 * Also returns possibly better title/description if the page provides them.
 */
async function resolveAndScrapeOg(link) {
  try {
    // Follow redirects and capture the final URL
    const res = await fetch(link, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        // Be polite and non-botty
        'user-agent':
          'Mozilla/5.0 (compatible; NewsIngest/1.0; +https://example.com/bot) node-fetch',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });

    const finalUrl = res.url || link;
    const contentType = res.headers.get('content-type') || '';

    // Bail if it's not HTML
    if (!contentType.includes('text/html')) {
      return { resolvedLink: finalUrl, ogImageURL: null, ogTitle: null, ogDescription: null };
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    // prefer og:image, fall back to twitter:image, og:image:secure_url
    const ogImageURL =
      $('meta[property="og:image"]').attr('content') ||
      $('meta[name="twitter:image"]').attr('content') ||
      $('meta[property="og:image:secure_url"]').attr('content') ||
      null;

    const ogTitle =
      $('meta[property="og:title"]').attr('content') ||
      $('meta[name="twitter:title"]').attr('content') ||
      $('title').text()?.trim() ||
      null;

    const ogDescription =
      $('meta[property="og:description"]').attr('content') ||
      $('meta[name="description"]').attr('content') ||
      $('meta[name="twitter:description"]').attr('content') ||
      null;

    return { resolvedLink: finalUrl, ogImageURL, ogTitle, ogDescription };
  } catch (e) {
    return { resolvedLink: null, ogImageURL: null, ogTitle: null, ogDescription: null, error: e?.message || String(e) };
  }
}

/**
 * Extract a short text-only summary from Google's HTML description list.
 */
function extractSummaryFromGoogleDescription(descHtml) {
  if (!descHtml) return null;
  try {
    const $ = cheerio.load(descHtml);
    // Often description is an <ol><li><a>Title</a> <font>Source</font>...</li>...</ol>
    // Grab the first <li> text sans source tail.
    const firstLi = $('li').first();
    if (!firstLi.length) return null;
    // Get anchor text
    const headline = firstLi.find('a').first().text().trim();
    const source = firstLi.find('font').first().text().trim();
    return headline || (source ? `From ${source}` : null);
  } catch {
    return null;
  }
}

/**
 * Fetch and enrich items from Google News.
 */
async function fetchNews({ region, category }) {
  const url = buildGoogleNewsRssUrl({ region, category });
  const feed = await parser.parseURL(url);

  const now = new Date();
  const regionUpper = String(region || 'US').toUpperCase();
  const categoryNorm = category ? String(category).toLowerCase() : 'all';

  const baseItems = (feed.items || []).map((item) => {
    // Source can be an object with attributes: { _: 'Name', $: { url: '...' } }
    let sourceName = null;
    let sourceUrl = null;
    if (item.source) {
      if (typeof item.source === 'string') {
        sourceName = item.source;
      } else if (item.source?._ || item.source?.$) {
        sourceName = (item.source._ || '').trim() || null;
        sourceUrl = item.source.$?.url || null;
      }
    }

    const imageFromRSS = pickImageUrlFromRSS(item);
    const shortSummary = extractSummaryFromGoogleDescription(item.description);

    return {
      title: item.title || null,
      link: item.link || null, // Google News redirect link
      description: item.contentSnippet || shortSummary || null,
      rawDescriptionHtml: item.description || null, // keep the raw HTML (optional)
      imageURL: imageFromRSS, // may be null; we’ll try OG later
      pubDate: item.isoDate ? new Date(item.isoDate) : (item.pubDate ? new Date(item.pubDate) : null),
      guid: item.guid || null,
      sourceName,
      sourceUrl,
      region: regionUpper,
      category: categoryNorm,
      fetchedAt: now,
      _raw: {
        feedTitle: feed.title || null,
      },
    };
  }).filter(x => x.link);

  // Enrich missing images / better titles by scraping OG for a subset or all
  const enriched = await mapWithConcurrency(baseItems, 5, async (doc) => {
    if (doc.imageURL && doc.title && doc.description) {
      // Already decent—still resolve the final link so you have canonical
      const { resolvedLink } = await resolveAndScrapeOg(doc.link);
      if (resolvedLink) doc.resolvedLink = resolvedLink;
      return doc;
    }

    const { resolvedLink, ogImageURL, ogTitle, ogDescription } = await resolveAndScrapeOg(doc.link);

    if (resolvedLink) doc.resolvedLink = resolvedLink;
    if (!doc.imageURL && ogImageURL) doc.imageURL = ogImageURL;
    // If the feed title/description is sparse, prefer OG
    if ((!doc.title || doc.title.length < 5) && ogTitle) doc.title = ogTitle;
    if ((!doc.description || doc.description.length < 20) && ogDescription) doc.description = ogDescription;

    return doc;
  });

  return enriched;
}

/**
 * Save items into MongoDB Atlas.
 */
async function saveToMongo(docs, { region, category }) {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is not set. Put it in your .env file.');
  }

  const client = new MongoClient(process.env.MONGODB_URI);
  const dbName = 'regional_news';
  const collectionName = toCollectionName(region, category);

  await client.connect();
  try {
    const db = client.db(dbName);
    const col = db.collection(collectionName);

    // Upsert by link OR resolvedLink if present (prefer resolvedLink)
    await col.createIndex({ resolvedLink: 1 }, { sparse: true, unique: true });
    await col.createIndex({ link: 1 }, { unique: true });

    if (!docs.length) return { upserted: 0, matched: 0, modified: 0, errors: 0 };

    const ops = docs.map((d) => {
      const filter = d.resolvedLink ? { $or: [{ resolvedLink: d.resolvedLink }, { link: d.link }] } : { link: d.link };
      return {
        updateOne: {
          filter,
          update: { $set: d },
          upsert: true,
        },
      };
    });

    const res = await col.bulkWrite(ops, { ordered: false });
    return {
      upserted: res.upsertedCount ?? 0,
      matched: res.matchedCount ?? 0,
      modified: res.modifiedCount ?? 0,
      errors: 0,
    };
  } catch (err) {
    if (err && err.result) {
      const r = err.result;
      return {
        upserted: r.upsertedCount ?? 0,
        matched: r.matchedCount ?? 0,
        modified: r.modifiedCount ?? 0,
        errors: (r.writeErrors && r.writeErrors.length) || 1,
      };
    }
    throw err;
  } finally {
    await client.close();
  }
}

/**
 * Simple argv parser: --region=US --category=science
 */
function parseArgs(argv) {
  const out = {};
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/**
 * Main
 */
(async function main() {
  try {
    const { region = 'US', category } = parseArgs(process.argv);

    const items = await fetchNews({ region, category });
    const stats = await saveToMongo(items, { region, category });

    console.log(
      JSON.stringify(
        {
          region,
          collection: toCollectionName(region, category),
          totalFetched: items.length,
          ...stats,
          sample: items[0] ? {
            title: items[0].title,
            link: items[0].link,
            resolvedLink: items[0].resolvedLink || null,
            imageURL: items[0].imageURL || null,
            sourceName: items[0].sourceName || null,
            sourceUrl: items[0].sourceUrl || null,
            pubDate: items[0].pubDate || null,
          } : null
        },
        null,
        2,
      ),
    );
  } catch (e) {
    console.error('Job failed:', e?.message || e);
    process.exitCode = 1;
  }
})();
