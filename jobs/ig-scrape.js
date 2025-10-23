// ig_hashtag_scrape.js
// Usage: node ig_hashtag_scrape.js "cats" 20
// This script DOES NOT log in. It visits the public hashtag page and scrapes visible posts.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

async function scrapeHashtag(topic, maxPosts = 20) {
  const url = `https://www.instagram.com/explore/tags/${encodeURIComponent(topic)}/`;
  const browser = await chromium.launch({ headless: true }); // set headless:false for debugging
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    viewport: { width: 1200, height: 900 },
  });

  const page = await context.newPage();

  try {
    console.log(`Going to ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait a bit for client-side content to load
    await page.waitForTimeout(3000);

    // Sometimes Instagram shows a cookie / consent dialog or a login interstitial.
    // Try to close cookie banners if present (best-effort, harmless).
    try {
      const cookieButton = await page.$('button:has-text("Accept")');
      if (cookieButton) {
        await cookieButton.click();
        await page.waitForTimeout(500);
      }
    } catch (e) {
      // ignore
    }

    // Scroll to load more posts until we collect enough or max scrolls reached
    let posts = new Map();
    const maxScrolls = 10;
    for (let i = 0; i < maxScrolls && posts.size < maxPosts; i++) {
      // select anchors that link to individual posts: href starts with "/p/"
      const anchors = await page.$$(`a[href^="/p/"]`);
      for (const a of anchors) {
        try {
          const href = await a.getAttribute('href');
          if (!href) continue;
          if (!posts.has(href)) {
            // try to extract an image alt (if exists)
            const img = await a.$('img');
            let alt = null;
            if (img) {
              alt = await img.getAttribute('alt');
            }
            // title or aria-label could be present too
            posts.set(href, { href: `https://www.instagram.com${href}`, alt });
            if (posts.size >= maxPosts) break;
          }
        } catch (err) {
          // ignore per-item errors
        }
      }

      if (posts.size >= maxPosts) break;

      // Scroll down to load more
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 1.2));
      await page.waitForTimeout(2000);
    }

    // Optionally: try visiting each post briefly to capture caption snippet (best-effort)
    const results = [];
    for (const [href, meta] of posts) {
      const absolute = meta.href;
      const item = { url: absolute, alt: meta.alt || null };

      // Fetch small data from the post page if accessible without login
      try {
        const postPage = await context.newPage();
        await postPage.goto(absolute, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await postPage.waitForTimeout(1500);
        // caption might be in article > div > div > ul li > div > div > div > span
        const captionHandle = await postPage.$('article div > div > ul li div div div span') || await postPage.$('article div > div > div > div span');
        if (captionHandle) {
          const captionText = (await captionHandle.innerText()).trim();
          item.caption_snippet = captionText.length > 300 ? captionText.slice(0, 300) + '…' : captionText;
        }
        await postPage.close();
      } catch (err) {
        // Many post pages redirect to login or are blocked; ignore errors
      }

      results.push(item);
      if (results.length >= maxPosts) break;
    }

    // Save a screenshot of the hashtag page
    const outDir = path.resolve(process.cwd(), 'ig_scrape_output');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
    const screenshotPath = path.join(outDir, `${topic.replace(/\W+/g, '_')}_page.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`Screenshot saved to ${screenshotPath}`);

    // Save results
    const jsonPath = path.join(outDir, `${topic.replace(/\W+/g, '_')}_results.json`);
    fs.writeFileSync(jsonPath, JSON.stringify({ topic, scraped_at: new Date().toISOString(), results }, null, 2));
    console.log(`Results saved to ${jsonPath}`);

    await browser.close();
    return { screenshotPath, jsonPath, resultsCount: results.length };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

// CLI
(async () => {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('Usage: node ig_hashtag_scrape.js "topic" [maxPosts]');
    process.exit(2);
  }
  const topic = args[0];
  const maxPosts = args[1] ? parseInt(args[1], 10) : 20;
  try {
    const res = await scrapeHashtag(topic, maxPosts);
    console.log('Done:', res);
  } catch (err) {
    console.error('Error:', err.message || err);
    process.exit(1);
  }
})();
