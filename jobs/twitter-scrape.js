// twitter-scrape.js
// Robust session handling + simplified login + improved video sniff + Mongo upsert

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { MongoClient, ServerApiVersion } = require('mongodb');

const {
  // Credentials / session
  TWITTER_USERNAME: USERNAME,
  TWITTER_PASSWORD: PASSWORD,
  HEADLESS = 'false',
  FORCE_FRESH_LOGIN = 'true',

  // Targets / scraping behavior
  ACCOUNTS = 'sentdefender, WarMonitors, Osinttechnical,visegrad24,WarMonitor3,OsintUpdates,OSINTWarfare,Osint613,Faytuks',
  LIMIT = '5',
  INCLUDE_RETWEETS = 'false',
  PER_PAGE_DELAY_MS = '2500',
  MAX_CONCURRENCY = '2',

  // Video sniffing
  FETCH_VIDEOS = 'true',
  VIDEO_SNIFF_TIMEOUT_MS = '4500',
  VIDEO_SNIFF_CONCURRENCY = '2',

  // Logging
  LOG_LEVEL = 'info',            // silent|error|warn|info|debug
  DEBUG_MEDIA = 'false',         // log each captured media URL
  DEBUG_HTML_SNAPSHOT = 'false', // log HTML length of tweet page

  // Mongo
  MONGO_URL = 'mongodb://localhost:27017/',
  DB_NAME = 'org1'
} = process.env;

// ---------- derived config ----------
const limit = Number(LIMIT);
const includeRetweets = String(INCLUDE_RETWEETS).toLowerCase() === 'true';
const perPageDelay = Number(PER_PAGE_DELAY_MS);
const maxConcurrency = Math.max(1, Number(MAX_CONCURRENCY));
const fetchVideos = String(FETCH_VIDEOS).toLowerCase() === 'true';
const videoSniffTimeout = Math.max(1500, Number(VIDEO_SNIFF_TIMEOUT_MS) || 4500);
const videoSniffConcurrency = Math.max(1, Number(VIDEO_SNIFF_CONCURRENCY) || 2);
const debugMedia = String(DEBUG_MEDIA).toLowerCase() === 'true';
const debugHtmlSnap = String(DEBUG_HTML_SNAPSHOT).toLowerCase() === 'true';
const forceFreshLogin = String(FORCE_FRESH_LOGIN).toLowerCase() === 'true';

// ---------- paths ----------
const STORAGE_PATH = path.resolve(__dirname, 'auth.json');
const LASTSEEN_PATH = path.resolve(__dirname, 'lastSeen.json');

// ---------- globals ----------
let mongoClient;
let db;
let tweetsCol;

// ---------- logging helpers ----------
const LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };
const CUR = LEVELS[String(LOG_LEVEL).toLowerCase()] ?? LEVELS.info;
const log = {
  error: (...a) => CUR >= LEVELS.error && console.error('[E]', ...a),
  warn : (...a) => CUR >= LEVELS.warn  && console.warn ('[W]', ...a),
  info : (...a) => CUR >= LEVELS.info  && console.log  ('[I]', ...a),
  debug: (...a) => CUR >= LEVELS.debug && console.log  ('[D]', ...a),
};

// ---------- small utils ----------
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function jitter(ms) { return ms + Math.floor(Math.random() * ms); }
function loadLastSeen() {
  try { return JSON.parse(fs.readFileSync(LASTSEEN_PATH, 'utf-8')); } catch { return {}; }
}
function saveLastSeen(map) { fs.writeFileSync(LASTSEEN_PATH, JSON.stringify(map, null, 2)); }
function uniq(arr) { return Array.from(new Set((arr || []).filter(Boolean))); }

// ---------- storage state helpers ----------
function readStorageStateSafe(p = STORAGE_PATH) {
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch { return null; }
}
function looksLoggedInStorage(state) {
  if (!state || !Array.isArray(state.cookies)) return false;
  const now = Date.now() / 1000;
  const inScope = c =>
    (!c.expires || c.expires > now - 60) &&
    (c.domain?.includes('x.com') || c.domain?.includes('twitter.com'));
  const names = new Set(state.cookies.filter(inScope).map(c => c.name));
  return names.has('auth_token') && names.has('twid');
}
function nukeStorageState(p = STORAGE_PATH) {
  try { fs.unlinkSync(p); log.warn('[session] removed bad storage:', p); } catch {}
}

// ---------- navigation & consent helpers ----------
async function gotoSafe(page, url, label = 'page', timeout = 45000) {
  for (const u of [url, url.replace('x.com', 'twitter.com')]) {
    try {
      await page.goto(u, { waitUntil: 'domcontentloaded', timeout });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      return true;
    } catch (e) {
      log.warn(`[gotoSafe] ${label} failed for ${u}:`, e.message);
    }
  }
  return false;
}

async function handleConsent(page) {
  const picks = [
    '[data-testid="confirmationSheetConfirm"]',
    'button:has-text("Accept all")',
    'button:has-text("Accept All")',
    'button:has-text("Accept & continue")',
    'button:has-text("Accept")',
    'a:has-text("Accept all")',
    '[aria-label*="Accept"]',
    '[aria-label*="agree"]',
    '[aria-label*="consent"]'
  ];
  for (const sel of picks) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
        await btn.click({ delay: 50 }).catch(() => {});
        await page.waitForTimeout(400);
      }
    } catch {}
  }
}

// ---------- main IIFE ----------
(async () => {
  // --- MongoDB
  mongoClient = new MongoClient(MONGO_URL, {
    serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
    maxPoolSize: 10,
    connectTimeoutMS: 15000,
    socketTimeoutMS: 45000,
    retryWrites: true
  });
  await mongoClient.connect();
  db = mongoClient.db(DB_NAME);
  tweetsCol = db.collection('tweets');
  log.info('Connected to Mongo. Ensuring indexes…');
  await tweetsCol.createIndex({ url: 1 }, { name: 'url_unique', unique: true });
  await tweetsCol.createIndex({ account: 1, datetime: -1 }, { name: 'account_datetime' });
  await tweetsCol.createIndex({ tweetId: 1 }, { name: 'tweetId' });

  // --- Browser & context
  const browser = await chromium.launch({
    headless: String(HEADLESS).toLowerCase() === 'true',
    args: [
      '--lang=en-US,en',
      '--disable-blink-features=AutomationControlled',
    ],
    // channel: 'chrome', // uncomment to use system Chrome in headful
  });
  log.info('Browser launched. Headless:', HEADLESS);

  const stored = forceFreshLogin ? null : readStorageStateSafe();

  let context;
  if (stored && looksLoggedInStorage(stored)) {
    log.info('[session] using existing storage state');
    context = await browser.newContext({
      storageState: STORAGE_PATH,
      locale: 'en-US',
      viewport: { width: 1366, height: 900 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
    });
  } else {
    if (stored) log.warn('[session] storage exists but does not look logged-in; ignoring it');
    context = await browser.newContext({
      locale: 'en-US',
      viewport: { width: 1366, height: 900 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
    });
  }

  // tiny stealth tweak
  await context.addInitScript(() => {
    try { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); } catch {}
  });

  let page = await context.newPage();

  // ---------- session / login helpers (simplified & robust) ----------

  // Quick cookie-based session check
  async function isSessionValid(context) {
    try {
      const cookies = await context.cookies();
      const now = Date.now() / 1000;
      const inScope = (c) =>
        (!c.expires || c.expires > now - 60) &&
        (c.domain?.includes('x.com') || c.domain?.includes('twitter.com'));
      const names = new Set(cookies.filter(inScope).map(c => c.name));
      return names.has('auth_token') && names.has('twid');
    } catch {
      return false;
    }
  }

  // DOM/URL based check that we actually reached a logged-in surface
  async function loggedIn(page) {
    try {
      const ok = await gotoSafe(page, 'https://x.com/home', 'home');
      if (!ok) return false;

      await handleConsent(page);

      // If we got bounced to login/flow, definitely not logged in
      const url = page.url();
      if (/\/i\/flow\/login|\/login/i.test(url)) return false;

      // Look for elements only present when authenticated
      const profile = page.locator('a[aria-label*="Profile"], [data-testid="AppTabBar_Profile_Link"]');
      const compose = page.locator('[data-testid="SideNav_NewTweet_Button"], [data-testid="AppTabBar_NewTweet_Button"]');

      if (await profile.first().isVisible({ timeout: 6000 }).catch(() => false)) return true;
      if (await compose.first().isVisible({ timeout: 6000 }).catch(() => false)) return true;

      // If we still see a login CTA, we’re not logged in
      const loginCta = page.locator('a:has-text("Log in"), a:has-text("Sign in"), [data-testid="login"], [href*="/login"]');
      if (await loginCta.first().isVisible({ timeout: 1000 }).catch(() => false)) return false;

      return false;
    } catch {
      return false;
    }
  }

  // Simple, deterministic login flow (Enter-first, then Next)
  async function doLogin() {
    if (!USERNAME || !PASSWORD) throw new Error('Missing USERNAME/PASSWORD');
    console.log('Logging in to X/Twitter...');

    await page.goto('https://x.com/i/flow/login', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
    await handleConsent(page);

    // USERNAME
    const usernameInput = page.locator('input[name="text"]');
    await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
    await usernameInput.fill(USERNAME);
    console.log('Entered username');
    await page.waitForTimeout(500);

    // Prefer Enter; fallback to Next click
    await usernameInput.press('Enter').catch(() => {});
    await page.waitForTimeout(4000);

    let passwordInput = page.locator('input[name="password"]');
    if (!(await passwordInput.isVisible().catch(() => false))) {
      const nextBtn = page.locator('button:has-text("Next"), div[role="button"]:has-text("Next")');
      if (await nextBtn.isVisible().catch(() => false)) {
        await nextBtn.click();
        console.log('Clicked Next');
      }
      await page.waitForTimeout(4000);
    }

    // PASSWORD
    passwordInput = page.locator('input[name="password"]');
    await passwordInput.waitFor({ state: 'visible', timeout: 15000 });
    await passwordInput.fill(PASSWORD);
    console.log('Entered password');

    const loginBtn = page.locator(
      'div[role="button"][data-testid="LoginForm_Login_Button"], button[data-testid="LoginForm_Login_Button"], button:has-text("Log in")'
    );
    if (await loginBtn.isVisible().catch(() => false)) {
      await loginBtn.click();
      console.log('Clicked login');
    } else {
      await passwordInput.press('Enter').catch(() => {});
      console.log('Pressed Enter to submit login');
    }

    // Give time to land; if challenged, you’ll still be on login
    await page.waitForTimeout(8000);

    // Save session (IMPORTANT: correct path constant)
    await context.storageState({ path: STORAGE_PATH });
    console.log('Login session saved to auth.json');
  }

  // Ensure we’re logged in; if not, do a simple login
  async function ensureLoggedIn() {
    // Fast cookie check; avoids nav if obviously valid
    const cookieValid = await isSessionValid(context);
    if (!cookieValid) {
      console.log('[session] cookies not valid; performing login');
      await doLogin();
      return;
    }

    // Confirm the session actually works by loading /home
    if (await loggedIn(page)) {
      console.log('[session] already logged in');
      return;
    }

    // If storage existed but didn’t work at runtime, wipe it then fresh login
    // const stored = readStorageStateSafe();
    // if (stored) {
    //   nukeStorageState();
    //   await context.close().catch(() => {});
    //   context = await browser.newContext({
    //     locale: 'en-US',
    //     viewport: { width: 1366, height: 900 },
    //     userAgent:
    //       'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    //     extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
    //   });
    //   await context.addInitScript(() => {
    //     try { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); } catch {}
    //   });
    //   page = await context.newPage();
    // }

    await doLogin();
  }

  await ensureLoggedIn();

  // --- video sniff helper
  async function collectVideoUrlsForTweet(tweetUrl) {
    const p = await context.newPage();
    const found = new Set();

    const mediaRegex =
      /https:\/\/(?:video|pbs)\.twimg\.com\/[^\s"'()<>]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>]*)?/ig;

    const mediaAccept = (u) => {
      try {
        const url = new URL(u);
        if (!/\.twimg\.com$/.test(url.hostname)) return false;
        if (/\.m3u8(\?|$)/i.test(url.pathname + url.search)) return true;
        if (/\.mp4(\?|$)/i.test(url.pathname + url.search)) return true;
        return false;
      } catch { return false; }
    };

    let fromReq = 0, fromResp = 0, fromHTML = 0, fromPerf = 0, fromInline = 0;

    const reqHandler = (req) => {
      const u = req.url();
      if (mediaAccept(u)) { fromReq++; found.add(u); if (debugMedia) log.debug('[media:req]', u); }
    };
    const respHandler = (resp) => {
      const u = resp.url();
      if (mediaAccept(u)) { fromResp++; found.add(u); if (debugMedia) log.debug('[media:resp]', u); }
    };
    p.on('request', reqHandler);
    p.on('response', respHandler);

    try {
      log.debug('→ Sniff start:', tweetUrl);
      await p.goto(tweetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await handleConsent(p);

      await p.evaluate(() => window.scrollBy(0, window.innerHeight * 0.4)).catch(() => {});

      const videoPlayer = p.locator('[data-testid="videoPlayer"], video');
      if (await videoPlayer.first().isVisible().catch(() => false)) {
        await videoPlayer.first().click({ trial: true }).catch(() => {});
        await videoPlayer.first().click().catch(() => {});
      }

      const playButton = p.locator('div[role="button"][data-testid*="play"], [aria-label*="Play"]');
      if (await playButton.first().isVisible().catch(() => false)) {
        await playButton.first().click().catch(() => {});
      }

      await p.evaluate(async () => {
        const v = document.querySelector('video');
        if (v) {
          try { v.muted = true; } catch {}
          try { await v.play(); } catch {}
        }
      }).catch(() => {});

      await p.waitForTimeout(videoSniffTimeout);

      // HTML / boot JSON
      try {
        const html = await p.content();
        if (debugHtmlSnap) log.debug('[html:length]', html?.length ?? 0);
        for (const m of html.matchAll(mediaRegex)) {
          fromHTML++; found.add(m[0]);
          if (debugMedia) log.debug('[media:html]', m[0]);
        }
      } catch {}

      // inline <video> sources
      try {
        const inlineSources = await p.$$eval('video source[src], video[src]', els =>
          Array.from(els)
            .map(el => el.getAttribute('src') || '')
            .filter(Boolean)
            .filter(u => !u.startsWith('blob:'))
        );
        for (const s of inlineSources) {
          if (mediaAccept(s)) { fromInline++; found.add(s); if (debugMedia) log.debug('[media:inline]', s); }
        }
      } catch {}

      // Performance API
      try {
        const perfUrls = await p.evaluate(() => performance.getEntriesByType('resource').map(e => e.name));
        for (const u of perfUrls) {
          if (mediaAccept(u)) { fromPerf++; found.add(u); if (debugMedia) log.debug('[media:perf]', u); }
        }
      } catch {}

      // tiny grace for late playlist
      try {
        await p.waitForEvent('response', {
          timeout: 1200,
          predicate: r => mediaAccept(r.url())
        }).then(r => {
          const u = r.url();
          fromResp++; found.add(u);
          if (debugMedia) log.debug('[media:resp-late]', u);
        }).catch(() => {});
      } catch {}

      const all = uniq(Array.from(found));
      const masters = all.filter(u => /master\.m3u8/i.test(u));
      const playlists = all.filter(u => /\.m3u8(\?|$)/i.test(u));
      const mp4s = all.filter(u => /\.mp4(\?|$)/i.test(u));

      const prioritized = masters.length ? masters : (playlists.length ? playlists : mp4s);
      const finalList = prioritized.length ? prioritized : all;

      log.debug('← Sniff done:', {
        url: tweetUrl,
        counts: { req: fromReq, resp: fromResp, html: fromHTML, perf: fromPerf, inline: fromInline },
        unique: all.length,
        returned: finalList.length
      });

      return finalList;
    } catch (e) {
      log.warn('Sniff error for', tweetUrl, e.message);
      return [];
    } finally {
      p.off('request', reqHandler);
      p.off('response', respHandler);
      await p.close().catch(() => {});
    }
  }

  // --- core extractor per account
  async function extractTweetsForAccount(account) {
    const page = await context.newPage();
    log.info(`[${account}] visiting profile…`);

    const watchdog = setInterval(async () => {
      try {
        const body = await page.content();
        if (/captcha|verify|challenge|rate limit|Something went wrong/i.test(body)) {
          throw new Error('Challenge or rate limit detected');
        }
      } catch (_) {}
    }, 1500);

    try {
      await gotoSafe(page, `https://x.com/${account}`, 'profile');
      await handleConsent(page);
      await page.waitForSelector('main article', { timeout: 30000 });

      // Ensure "Posts" tab (if present)
      const postsTab = page.getByRole('tab', { name: /^Posts$/i });
      if (await postsTab.isVisible().catch(() => false)) {
        await postsTab.click();
        await page.waitForLoadState('domcontentloaded');
      }

      const seen = new Map();
      let triesWithoutNew = 0;

      async function extractBatch() {
        return await page.$$eval(
          'article',
          (articles, { account, includeRetweets }) => {
            const out = [];

            const isReplyArticle = (a) => {
              const hasReplyingToText = a.innerText && /(^|\n)\s*replying to/i.test(a.innerText);
              const hasReplyAria = !!a.querySelector('[aria-label^="Replying to"]');
              const spanReplyCrumb = Array.from(a.querySelectorAll('span')).some(s =>
                /replying to/i.test(s.textContent || '')
              );
              return hasReplyingToText || hasReplyAria || spanReplyCrumb;
            };

            for (const a of articles) {
              if (isReplyArticle(a)) continue;

              const anchors = Array.from(a.querySelectorAll('a[href*="/status/"]'));
              const mainStatusAnchor = anchors.find(an => an.querySelector('time')) || anchors[0];
              if (!mainStatusAnchor) continue;

              const href = mainStatusAnchor.getAttribute('href') || '';
              const url = href.startsWith('http') ? href : `https://x.com${href}`;

              if (!includeRetweets) {
                try {
                  const pth = new URL(url).pathname;
                  if (!pth.startsWith(`/${account}/status/`)) continue;
                } catch {}
                if (a.querySelector('div[data-testid="socialContext"]')) continue; // RT banner
              }

              const pinnedIcon = a.querySelector('svg[aria-label="Pinned"], svg[aria-label="Pinned post"]');
              const pinnedText = Array.from(a.querySelectorAll('span')).some(s => /pinned/i.test(s.textContent || ''));
              if (pinnedIcon || pinnedText) continue;

              const textEl = a.querySelector('div[data-testid="tweetText"]');
              const text = textEl ? textEl.innerText.trim() : '';

              const images = Array.from(a.querySelectorAll('img'))
                .map(img => img.src)
                .filter(src => src && /twimg\.com\/media/.test(src));

              const timeEl = mainStatusAnchor.querySelector('time');
              const datetime = timeEl ? timeEl.getAttribute('datetime') : null;

              const hasVideoHint =
                !!a.querySelector('[data-testid="videoPlayer"], [aria-label*="Embedded video"], [data-testid="inlineVideo"]');

              if (!text && images.length === 0 && !url) continue;

              out.push({ text, images, datetime, url, hasVideoHint });
            }

            return out;
          },
          { account, includeRetweets }
        );
      }

      while (seen.size < limit && triesWithoutNew < 8) {
        const batch = await extractBatch();
        log.debug(`[${account}] batch size:`, batch.length);

        let newlyAdded = 0;
        for (const t of batch) {
          const key = t.url || `${t.datetime}-${(t.text || '').slice(0, 50)}`;
          if (!seen.has(key)) {
            seen.set(key, t);
            newlyAdded++;
          }
        }

        log.debug(`[${account}] newly added: ${newlyAdded} (seen: ${seen.size})`);
        if (seen.size >= limit) break;

        triesWithoutNew = newlyAdded === 0 ? triesWithoutNew + 1 : 0;
        await page.evaluate(() => window.scrollBy(0, window.innerHeight * 1.2));
        await page.waitForTimeout(1000 + Math.floor(Math.random() * 500));
      }

      // Sort and cap
      const tweets = Array.from(seen.values())
        .sort((a, b) => {
          const ta = a.datetime ? Date.parse(a.datetime) : 0;
          const tb = b.datetime ? Date.parse(b.datetime) : 0;
          return tb - ta;
        })
        .slice(0, limit);

      const withHint = tweets.filter(t => t.hasVideoHint).length;
      log.info(`[${account}] collected ${tweets.length} tweets (video-hinted: ${withHint})`);

      // Resolve video URLs (prioritize hinted ones)
      if (fetchVideos && tweets.length) {
        const queue = tweets.slice().sort((a, b) => Number(b.hasVideoHint) - Number(a.hasVideoHint));
        const workers = Array.from(
          { length: Math.min(videoSniffConcurrency, queue.length) },
          async (_, idx) => {
            while (queue.length) {
              const t = queue.shift();
              log.info(`[${account}][W${idx}] sniffing`, t.url, 'hint:', t.hasVideoHint);
              try {
                const vids = await collectVideoUrlsForTweet(t.url);
                t.videos = vids;
                log.info(`[${account}][W${idx}] found ${vids.length} video URL(s)`);
                if (CUR >= LEVELS.debug && vids.length) vids.forEach(v => log.debug('   ↳', v));
              } catch (e) {
                t.videos = [];
                log.warn(`[${account}][W${idx}] sniff error:`, e.message);
              }
            }
          }
        );
        await Promise.all(workers);
      } else {
        for (const t of tweets) t.videos = [];
      }

      return tweets;
    } finally {
      clearInterval(watchdog);
      await page.close();
    }
  }

  const accounts = ACCOUNTS.split(',').map(s => s.trim()).filter(Boolean);
  const lastSeen = loadLastSeen();

  // --- account workers
  const queue = [...accounts];
  const results = {};
  const workers = Array.from({ length: Math.min(maxConcurrency, queue.length) }, async (_, idx) => {
    while (queue.length) {
      const account = queue.shift();
      log.info(`[W${idx}] processing account:`, account);
      await sleep(jitter(perPageDelay));

      try {
        const tweets = await extractTweetsForAccount(account);

        if (!tweets.length) {
          log.warn(`[${account}] no tweets extracted this run`);
        }

        // Mongo upsert (avoid $setOnInsert/$set conflict on 'videos')
        if (tweets.length) {
          const now = new Date();
          const ops = tweets.map(t => {
            const dt = t.datetime ? new Date(t.datetime) : null;
            const validDt = dt && !isNaN(dt.getTime()) ? dt : null;

            let tweetId = null;
            try {
              const m = /status\/(\d+)/.exec(new URL(t.url).pathname);
              tweetId = m ? m[1] : null;
            } catch {}

            const $set = { lastSeenAt: now };
            if (Array.isArray(t.videos)) $set.videos = t.videos;

            const $setOnInsert = {
              account,
              text: t.text || '',
              images: t.images || [],
              datetime: validDt,
              url: t.url,
              fetchedAt: now,
              tweetId,
              tiktoks_processed: false,
            };
            if (!('videos' in $set)) $setOnInsert.videos = [];

            return {
              updateOne: {
                filter: { url: t.url },
                update: { $set, $setOnInsert },
                upsert: true
              }
            };
          });

          log.debug(`[${account}] bulkWrite ops:`, ops.length);
          try {
            const res = await tweetsCol.bulkWrite(ops, { ordered: false });
            log.info(`[${account}] bulkWrite ok`);
            if (CUR >= LEVELS.debug) log.debug(JSON.stringify(res.result || res, null, 0));
          } catch (e) {
            if (!/E11000 duplicate key error/.test(String(e.message))) {
              log.error(`[${account}] bulkWrite error:`, e.message);
              throw e;
            } else {
              log.warn(`[${account}] duplicate key(s) encountered, continuing`);
            }
          }
        }

        const latestUrl = tweets[0]?.url;
        if (latestUrl && lastSeen[account] === latestUrl) {
          log.info(`[${account}] no new tweets since last run`);
        } else {
          lastSeen[account] = latestUrl || lastSeen[account];
          const videosFound = tweets.reduce((n, t) => n + (t.videos?.length || 0), 0);
          log.info(`[${account}] upserted ${tweets.length} tweets (videos total: ${videosFound})`);
        }

        results[account] = { ok: true, count: tweets.length };
      } catch (e) {
        log.error(`[${account}] error:`, e.message);
        results[account] = { ok: false, error: e.message };
      }
    }
  });

  await Promise.all(workers);
  saveLastSeen(lastSeen);

  // tidy shutdown
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
  await mongoClient.close().catch(() => {});
  log.info('Done:', results);
})().catch(async (err) => {
  console.error('Fatal error:', err);
  try { await mongoClient?.close(); } catch {}
  process.exit(1);
});

// graceful shutdown
process.on('SIGINT', async () => {
  try { await mongoClient?.close(); } catch {}
  process.exit(0);
});
process.on('SIGTERM', async () => {
  try { await mongoClient?.close(); } catch {}
  process.exit(0);
});
