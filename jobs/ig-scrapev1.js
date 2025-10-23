/* eslint-disable no-console */
//
// Instagram Scraper (Node.js) — full file with robust login + keyword search output
// Dependencies: selenium-webdriver, chromedriver, cheerio, fs-extra, dayjs, (optional) kleur
//
// npm i selenium-webdriver chromedriver cheerio fs-extra dayjs
// npm i kleur   # optional for colored logs
//
const fs = require('fs-extra');
const path = require('path');
const dayjs = require('dayjs');
const cheerio = require('cheerio');
const { Builder, By, Key, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const { cyan, green, red, yellow, magenta, blue } = (() => {
  try { return require('kleur'); } catch { return new Proxy({}, { get: () => (s) => s }); }
})();

const PREFIX = 'https://www.instagram.com';
const CONFIG_FILE = 'config.json';
let config = {};

// ----------------------------- Logging ---------------------------------------
function setupLogging(logFile) {
  const dir = path.dirname(logFile || '');
  if (dir && !fs.existsSync(dir)) {
    try { fs.mkdirpSync(dir); }
    catch (e) { console.log(red(`❌ Failed to create log directory '${dir}': ${e}`)); }
  }
  info('📝 Logging initialized.');
}
function ts() { return dayjs().format('YYYY-MM-DD HH:mm:ss'); }
function writeLog(level, msg) {
  try {
    const logFile = config?.log_file || 'instagram.log';
    fs.appendFileSync(logFile, `${ts()} - ${level.toUpperCase()} - ${msg}\n`);
  } catch {}
}
const info = (m) => { console.log(m); writeLog('info', stripAnsi(m)); };
const warn = (m) => { console.log(yellow(m)); writeLog('warn', stripAnsi(m)); };
const err  = (m) => { console.log(red(m)); writeLog('error', stripAnsi(m)); };
function stripAnsi(s) { return String(s).replace(/\x1b\[[0-9;]*m/g, ''); }

// ----------------------------- Config I/O ------------------------------------
async function loadConfig(configFile = CONFIG_FILE) {
  console.log(`📄 Loading configuration from: ${cyan(configFile)}`);
  try {
    const raw = await fs.readFile(configFile, 'utf-8');
    config = JSON.parse(raw);
    console.log('✅ Configuration loaded successfully.');
    info(`Configuration loaded from ${configFile}`);
    config.queries ??= {};
    config.completed_queries ??= {};
    config.default_timeout ??= 10;
    config.search_path ??= 'search/';
    return true;
  } catch (e) {
    if (e.code === 'ENOENT') {
      err(`❌ Error: Configuration file '${configFile}' not found.`);
    } else if (e.name === 'SyntaxError') {
      err(`❌ Error: Could not decode JSON from '${configFile}'. Details: ${e.message}`);
    } else {
      err(`❌ Unexpected error loading config: ${e.message}`);
    }
    return false;
  }
}

async function updateConfig(configFile = CONFIG_FILE) {
  info(`Attempting to update configuration file: ${configFile}`);
  try {
    const dir = path.dirname(configFile);
    if (dir) await fs.mkdirp(dir);
    await fs.writeFile(configFile, JSON.stringify(config, null, 4), 'utf-8');
    info('✅ Configuration file updated successfully.');
  } catch (e) {
    err(`❌ Error writing configuration to ${configFile}: ${e.message}`);
  }
}

// ----------------------------- WebDriver -------------------------------------
async function setupDriver() {
  info('⚙️ Setting up WebDriver...');
  console.log('⚙️ Setting up WebDriver...');

  const options = new chrome.Options();
  const driverPath = config.driver_executable_path;

  if (config.headless) {
    info('👻 Headless mode enabled.');
    console.log('👻 Headless mode enabled.');
    options.addArguments('--headless=new', '--window-size=1920,1080', '--disable-gpu');
  } else {
    options.addArguments('--window-size=1280,900');
  }

  const prefs = {};
  if (config.disable_saving_password) {
    prefs['credentials_enable_service'] = false;
    prefs['profile.password_manager_enabled'] = false;
  }
  if (config.disable_images) {
    info('🖼️ Disabling images.');
    console.log('🖼️ Disabling images.');
    prefs['profile.managed_default_content_settings.images'] = 2;
  } else {
    prefs['profile.managed_default_content_settings.images'] = 1;
  }
  if (config.disable_videos) {
    info('🎬 Disabling videos.');
    console.log('🎬 Disabling videos.');
    prefs['profile.managed_default_content_settings.media_stream'] = 2;
  }
  if (Object.keys(prefs).length) options.setUserPreferences(prefs);

  options.addArguments(
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled'
  );
  options.excludeSwitches('enable-automation');
  options.addArguments('--disable-features=AutomationControlled');

  if (driverPath) {
    if (!fs.existsSync(driverPath)) {
      warn(`❗ Specified chromedriver path does not exist: ${cyan(driverPath)} — falling back to system PATH.`);
    } else {
      info(`🚗 Using specified chromedriver executable: ${driverPath}`);
      console.log(`🚗 Using specified chromedriver executable: ${cyan(driverPath)}`);
    }
  } else {
    info('🤔 No driver_executable_path found in config. Will use PATH (chromedriver package).');
  }

  try {
    info('🚀 Initializing Chrome WebDriver...');
    console.log('🚀 Initializing Chrome WebDriver...');
    const driver = await new Builder().forBrowser('chrome').setChromeOptions(options).build();
    await driver.executeScript("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})");
    info('✅ WebDriver initialized successfully.');
    console.log('✅ WebDriver initialized successfully.');
    return driver;
  } catch (e) {
    err(`❌ WebDriver Error: Could not initialize Chrome. Details: ${e.message}`);
    throw e;
  }
}

async function navigateToUrl(driver, url) {
  try {
    info(`🌍 Navigating to: ${url}`);
    console.log(`🌍 Navigating to: ${url}`);
    await driver.get(url);
    await driver.sleep(2000);
    return true;
  } catch (e) {
    err(`❌ WebDriver Error navigating to ${url}: ${e.message}`);
    return false;
  }
}

async function closeDriver(driver) {
  if (!driver) return;
  console.log('🚪 Closing WebDriver...');
  try {
    await driver.quit();
    info('✅ WebDriver closed.');
    console.log('✅ WebDriver closed.');
  } catch (e) {
    err(`❌ WebDriver Error closing session: ${e.message}`);
  }
}

// ----------------------------- DOM helpers -----------------------------------
async function getElement(driver, by, timeoutSec) {
  const timeout = (timeoutSec ?? config.default_timeout) * 1000;
  try {
    await driver.wait(until.elementLocated(by), timeout);
    return await driver.findElement(by);
  } catch {
    return null;
  }
}
async function getElementByXPath(driver, xpath, timeoutSec) {
  return getElement(driver, By.xpath(xpath), timeoutSec);
}
async function takeScreenshot(driver, filename = 'screenshot.png') {
  try {
    await fs.mkdirp(path.dirname(filename));
    const image = await driver.takeScreenshot();
    await fs.writeFile(filename, image, 'base64');
    info(`📸 Screenshot saved to ${filename}`);
    console.log(`📸 Screenshot saved to ${green(filename)}`);
    return true;
  } catch (e) {
    err(`❌ Error taking screenshot: ${e.message}`);
    return false;
  }
}
async function getSoup(driver) {
  try {
    const html = await driver.getPageSource();
    if (!html || html.length < 500) warn('⚠️ Page source seems empty or too short. Possible page load issue.');
    return cheerio.load(html);
  } catch (e) {
    err(`❌ Error getting page source: ${e.message}`);
    return null;
  }
}
async function sleepProgress(seconds) {
  process.stdout.write(magenta('Sleeping... '));
  for (let i = 0; i < seconds; i++) { process.stdout.write('.'); await new Promise(r => setTimeout(r, 1000)); }
  process.stdout.write('\n');
}
function getToday() { return dayjs().format('YYYY-MM-DD HH:mm:ss'); }

// ----------------------------- Robust login ----------------------------------
async function safeClick(driver, el) {
  try {
    await driver.wait(until.elementIsVisible(el), 8000);
    await driver.wait(until.elementIsEnabled(el), 8000);
    await el.click();
  } catch {
    await driver.executeScript('arguments[0].scrollIntoView({block:"center"});', el);
    await driver.executeScript('arguments[0].click();', el);
  }
}

async function maybeDismissOverlays(driver) {
  const cookieButtonsX = [
    "//button[.//span[normalize-space()='Allow all cookies']]",
    "//button[.//span[contains(.,'Only allow essential cookies')]]",
    "//button[normalize-space()='Allow all cookies']",
    "//button[normalize-space()='Only allow essential cookies']",
    "//button[normalize-space()='Allow all']"
  ];
  for (const xp of cookieButtonsX) {
    const els = await driver.findElements(By.xpath(xp));
    if (els.length) {
      try { await safeClick(driver, els[0]); await driver.sleep(300); return; } catch {}
    }
  }
  try { await driver.actions().sendKeys(Key.ESCAPE).perform(); } catch {}
  const closeOneTapX = [
    "//div[@role='dialog']//button[@aria-label='Close']",
    "//div[@role='dialog']//div[@aria-label='Close']"
  ];
  for (const xp of closeOneTapX) {
    const els = await driver.findElements(By.xpath(xp));
    if (els.length) {
      try { await safeClick(driver, els[0]); await driver.sleep(200); } catch {}
    }
  }
}

async function login(driver) {
  const username = config.username;
  const password = config.password;
  if (!username || !password) {
    console.log('❌ Username or password missing in config.json.');
    return false;
  }

  console.log('🔑 Attempting Instagram login...');
  if (!(await navigateToUrl(driver, 'https://www.instagram.com/'))) return false;

  const usernameSel = By.css("input[name='username']");
  const passwordSel = By.css("input[name='password']");
  const submitSel   = By.css("button[type='submit']");

  await driver.wait(until.elementLocated(usernameSel), 15000);
  await driver.wait(until.elementLocated(passwordSel), 15000);
  await maybeDismissOverlays(driver);

  const userEl = await driver.findElement(usernameSel);
  const passEl = await driver.findElement(passwordSel);
  await userEl.clear(); await userEl.sendKeys(username);
  await passEl.clear(); await passEl.sendKeys(password);

  try {
    await passEl.sendKeys(Key.ENTER);
  } catch {
    try {
      const submitEl = await driver.findElement(submitSel);
      await safeClick(driver, submitEl);
    } catch (e) {
      try { await driver.actions().sendKeys(Key.ESCAPE).perform(); } catch {}
      const submitEl = await driver.findElement(submitSel);
      await safeClick(driver, submitEl);
    }
  }

  await driver.sleep(2000);
  await maybeDismissOverlays(driver);
  const notNowX = [
    "//button[normalize-space()='Not Now']",
    "//div[@role='dialog']//button[normalize-space()='Not Now']"
  ];
  for (const xp of notNowX) {
    const els = await driver.findElements(By.xpath(xp));
    if (els.length) {
      try { await safeClick(driver, els[0]); await driver.sleep(500); } catch {}
    }
  }

  try {
    await driver.wait(until.urlContains('instagram.com'), 10000);
    await driver.wait(async () => {
      const url = await driver.getCurrentUrl();
      return !/accounts\/login/i.test(url);
    }, 8000);
    console.log('✅ Login successful (URL changed off login).');
    return true;
  } catch {
    console.log('❌ Login may have failed (still on login page).');
    await takeScreenshot(driver, 'error_login_unexpected.png');
    return false;
  }
}

// ----------------------------- Generic search collector ----------------------
// This collector is more robust than the old container-class approach.
// It scrolls and grabs all anchors that look like post or reel links.
async function collect_search_links_generic(driver, desiredCount = 100, maxScrolls = 200) {
  const seen = new Set();
  const results = [];

  let body;
  try { body = await driver.findElement(By.tagName('body')); }
  catch { err('❌ Cannot find page body element to send scroll keys.'); return []; }

  let scrolls = 0;
  let noNewStreak = 0;

  while (scrolls < maxScrolls && results.length < desiredCount) {
    const $ = await getSoup(driver);
    if ($) {
      $('a[href^="/p/"], a[href^="/reel/"]').each((_, a) => {
        const href = $(a).attr('href');
        if (!href) return;
        const abs = PREFIX + href;
        if (!seen.has(abs)) {
          seen.add(abs);
          results.push(abs);
        }
      });
    }

    const before = results.length;
    await body.sendKeys(Key.PAGE_DOWN);
    scrolls += 1;
    process.stdout.write(`\r📜 Scrolled (${scrolls}). Collected ${results.length} links...`);
    await driver.sleep(1200);
    const after = results.length;
    if (after === before) noNewStreak += 1; else noNewStreak = 0;
    if (noNewStreak >= 10) { // stop if nothing new for 10 consecutive scrolls
      break;
    }
  }
  console.log(`\n🔗 Collected ${results.length} links from search.`);
  return results;
}

// ----------------------------- Media scraping per post -----------------------
async function scrape_media_from_post(driver, url) {
  const out = { url, type: url.includes('/reel/') ? 'reel' : (url.includes('/p/') ? 'post' : 'unknown'), image: null, video: null, title: null };
  const ok = await navigateToUrl(driver, url);
  if (!ok) return out;
  await driver.sleep(1500);

  const $ = await getSoup(driver);
  if (!$) return out;

  // Prefer OpenGraph – usually stable across redesigns
  const ogImage = $('meta[property="og:image"]').attr('content') || null;
  const ogVideo = $('meta[property="og:video"]').attr('content') || null;
  const ogTitle = $('meta[property="og:title"]').attr('content') || null;

  out.image = ogImage;
  out.video = ogVideo;
  out.title = ogTitle;

  // Fallback: find first <img> / <video> if OG missing
  if (!out.image) {
    const imgSrc = $('article img').first().attr('src');
    if (imgSrc) out.image = imgSrc;
  }
  if (!out.video) {
    const vidSrc = $('article video').first().attr('src');
    if (vidSrc) out.video = vidSrc;
  }
  return out;
}

// ----------------------------- Old search / reels handlers (unchanged) -------
async function search_scraper(driver) {
  console.log('📜 Starting search results scroll and scrape...');
  const allLinks = [];
  const processed = new Set();

  let body;
  try { body = await driver.findElement(By.tagName('body')); }
  catch { err('❌ Cannot find page body element to send scroll keys.'); return []; }

  const postCountTarget = Number(config.search_post_count || 100);
  let scrollAttempts = 0;

  console.log(`🎯 Aiming for approximately ${postCountTarget} posts.`);

  while (true) {
    if (allLinks.length >= postCountTarget) {
      console.log(`\n✅ Reached target post count (${allLinks.length} >= ${postCountTarget}).`);
      break;
    }
    try {
      await body.sendKeys(Key.PAGE_DOWN);
      scrollAttempts += 1;
      process.stdout.write(`\r📜 Scrolled (${scrollAttempts}). Found ${allLinks.length} links...`);
      await driver.sleep(1500);
    } catch (e) {
      err(`\n❌ WebDriver Error sending scroll key: ${e.message}`);
      break;
    }
    try {
      const $ = await getSoup(driver);
      if ($) {
        $('a[href^="/p/"]').each((_, a) => {
          const href = $(a).attr('href');
          if (!href) return;
          const abs = PREFIX + href;
          if (!processed.has(abs)) { processed.add(abs); allLinks.push(abs); }
        });
      }
    } catch { console.log(yellow(`\n⚠️ Continuing despite scraping error.`)); }
  }

  console.log(`\n🏁 Finished search scraping. Found ${allLinks.length} unique post links.`);
  return allLinks;
}

async function search_handler(driver, query) {
  console.log(cyan(`🔍 Searching Instagram for: #${query}`));
  info(`Starting search for query: ${query}`);

  const searchUrl = `https://www.instagram.com/explore/search/keyword/?q=%23${encodeURIComponent(query)}`;
  if (!(await navigateToUrl(driver, searchUrl))) {
    err(`❌ Failed to navigate to search page for #${query}. Skipping.`);
    return;
  }

  console.log(yellow(`🔗 Scraping links for #${query}...`));
  info(`Scraping links for search query: ${query}`);

  let allLinks = [];
  while (true) {
    const $ = await getSoup(driver);
    if ($ && $.text().includes("We couldn't find anything for that search")) { allLinks = []; break; }
    allLinks = await collect_search_links_generic(driver, config.search_post_count || 100);
    break;
  }

  if (!allLinks || allLinks.length === 0) {
    console.log(yellow(`⚠️ No links found or scraped for #${query}.`));
    config.completed_queries[query] = {
      type: 'search', post_count: 0, updated: getToday(), saved_file: null, status: 'No Results Found/Scraped'
    };
    if (config.queries?.[query]) delete config.queries[query];
    await updateConfig();
    return;
  }

  const filename = path.join(config.search_path || 'search/', `${query}.json`);
  console.log(`💾 Preparing to save/update results to: ${green(filename)}`);
  info(`Saving/updating search results to: ${filename}`);

  let existing = {};
  let newFile = true;
  if (await fs.pathExists(filename)) {
    newFile = false;
    console.log('📄 Existing file found. Loading previous data...');
    try { existing = JSON.parse(await fs.readFile(filename, 'utf-8')); console.log(`📊 Loaded ${Object.keys(existing).length} existing links.`); }
    catch { existing = {}; newFile = true; }
  }

  const temp = { ...existing };
  let added = 0;
  for (const link of allLinks) {
    if (!temp[link]) { temp[link] = false; added += 1; }
  }

  if (added > 0 || newFile) {
    console.log(`➕ Found ${added} new links to add.`);
    try {
      await fs.mkdirp(path.dirname(filename));
      await fs.writeFile(filename, JSON.stringify(temp, null, 4), 'utf-8');
      console.log(`✅ Successfully saved ${Object.keys(temp).length} total links to ${green(filename)}`);
      info(`Saved ${Object.keys(temp).length} links to ${filename}. Added ${added} new links.`);
    } catch (e) {
      err(`❌ File Error writing search results to ${filename}: ${e.message}`);
      return;
    }
  } else {
    console.log('✅ No new links found for this search.');
  }

  config.completed_queries[query] ??= {};
  Object.assign(config.completed_queries[query], {
    type: 'search',
    post_count: added,
    updated: getToday(),
    saved_file: filename,
    status: 'Completed'
  });
  if (config.queries?.[query]) delete config.queries[query];
  await updateConfig();
}

// Reels (unchanged core)
async function scroll_to_the_last(driver) {
  console.log('📜 Scrolling down to find the end of the page...');
  let body;
  try { body = await driver.findElement(By.tagName('body')); }
  catch { err('❌ Cannot find page body element to send scroll keys.'); return 0; }

  let first = await getSoup(driver);
  if (!first) { console.log(yellow('⚠️ Could not get initial page source for comparison.')); return 10; }

  let total = 0;
  const maxScrolls = 200;

  while (total < maxScrolls) {
    try {
      await body.sendKeys(Key.PAGE_DOWN);
      total += 1;
      process.stdout.write(`\r📜 Scrolling down... (Scroll ${total})`);
      await driver.sleep(3000);

      const second = await getSoup(driver);
      if (!second) { console.log(`\n${yellow('⚠️ Failed to get page source for comparison, stopping scroll.')}`); break; }
      if (second.html() === first.html()) {
        console.log('\n M Page content stabilized. Reached the end (based on soup comparison).');
        break;
      }
      first = second;
    } catch (e) {
      err(`\n❌ Error during scroll: ${e.message}`);
      break;
    }
  }

  if (total >= maxScrolls) console.log(`\n${yellow(`⚠️ Reached scroll limit (${maxScrolls}) before page stabilized.`)}`);
  console.log(`\n🏁 Finished scrolling down. Performed ${total} scrolls.`);
  const scrollUpCount = total + 10;
  console.log(`   (Will attempt ${scrollUpCount} scrolls UP in the scraper)`);
  return scrollUpCount;
}

async function user_reels_scraper(driver, count) {
  console.log(`📜 Starting Reels scraping (scrolling UP ${count} times)...`);
  const body = await driver.findElement(By.tagName('body'));
  const all = [];

  async function temp_scrape() {
    const $ = await getSoup(driver);
    const container = $('div.xg7h5cd.x1n2onr6').first();
    if (!container || container.length === 0) return;
    const links = [];
    container.find('a').each((i, a) => {
      const href = $(a).attr('href');
      if (href) links.push(PREFIX + href);
    });
    let added = 0;
    for (const l of links) {
      if (!all.includes(l)) { all.push(l); added += 1; }
    }
    console.log(all.length, added);
  }

  for (let i = 0; i < count; i++) {
    await body.sendKeys(Key.PAGE_UP);
    await driver.sleep(1000);
    await temp_scrape();
  }
  return all;
}

async function user_reels_handler(driver, user, update) {
  console.log(magenta(`👤 Processing user: ${user}`));
  info(`Starting Reels scrape for user: ${user}`);

  const savePath = path.join(config.user_reels_path || 'user reels/', `${user}.json`);
  const userLink = `https://www.instagram.com/${user}/reels/`;

  if (!(await navigateToUrl(driver, userLink))) {
    err(`❌ Failed to navigate to user Reels page for ${user}. Skipping.`);
    return;
  }

  console.log('📊 Fetching user profile info...');
  info(`Fetching profile info for ${user}`);
  let posts = 'N/A', followers = 'N/A', following = 'N/A';
  try {
    const $ = await getSoup(driver);
    const infoClass = 'x5n08af x1s688f';
    const spans = $(`span.${infoClass.split(' ').join('.')}`);
    if (spans && spans.length >= 3) {
      posts     = $(spans[0]).text().trim() || 'N/A';
      followers = $(spans[1]).text().trim() || 'N/A';
      following = $(spans[2]).text().trim() || 'N/A';
      console.log(`    Posts: ${posts}, Followers: ${followers}, Following: ${following}`);
    } else {
      console.log(yellow(`⚠️ Could not find expected user info elements (found ${spans.length} spans). Using defaults.`));
    }
  } catch (e) {
    err(`❌ Error extracting user info: ${e.message}`);
  }

  const pageDownsToScrollUp = await scroll_to_the_last(driver);
  const allReels = await user_reels_scraper(driver, pageDownsToScrollUp);

  if (!allReels || allReels.length === 0) {
    console.log(yellow(`⚠️ No Reel links scraped for user ${user}.`));
    config.completed_queries[user] = {
      type: 'user_reels',
      info: { url: userLink, posts, followers, following },
      post_saved: 0,
      saved_file: null,
      updated: getToday(),
      status: 'No Reels Found/Scraped'
    };
    if (config.queries?.[user]) delete config.queries[user];
    await updateConfig();
    return;
  }

  console.log(`💾 Preparing to save/update Reels results to: ${green(savePath)}`);
  info(`Saving/updating Reels results for ${user} to: ${savePath}`);

  let existing = {};
  let newFile = true;

  // (follow/unfollow best effort — left as-is)
  let followed = false;
  try {
    const xpathBtn = '/html/body/div[1]/div/div/div[2]/div/div/div[1]/div[2]/div/div[1]/section/main/div/header/section[2]/div/div/div[2]/div/div[1]/button';
    const btn = await getElementByXPath(driver, xpathBtn);
    if (config.follow_user_reels) {
      if (btn && (await btn.getText()) === 'Follow') await btn.click();
      followed = true;
    } else {
      if (btn && (await btn.getText()) === 'Following') {
        await btn.click();
        const unfollowBtn = await getElementByXPath(driver, '/html/body/div[5]/div[2]/div/div/div[1]/div/div[2]/div/div/div/div/div[2]/div/div/div/div[8]/div[1]/div/div/div[1]/div/div/span/span');
        if (unfollowBtn) await unfollowBtn.click();
      }
      followed = false;
    }
  } catch (e) {
    err(`❌ Unexpected error toggling follow state: ${e.message}`);
  }

  if (update && await fs.pathExists(savePath)) {
    newFile = false;
    console.log('📄 Update mode: Loading existing file...');
    try { existing = JSON.parse(await fs.readFile(savePath, 'utf-8')); console.log(`📊 Loaded ${Object.keys(existing).length} existing Reel links.`); }
    catch { existing = {}; newFile = true; }
  } else if (await fs.pathExists(savePath)) {
    newFile = false;
    console.log('📄 Existing file found (not in update mode). Loading previous data...');
    try { existing = JSON.parse(await fs.readFile(savePath, 'utf-8')); console.log(`📊 Loaded ${Object.keys(existing).length} existing Reel links.`); }
    catch { existing = {}; newFile = true; }
  } else {
    console.log('📄 No existing file found. Will create a new one.');
    newFile = true;
  }

  const temp = { ...existing };
  let added = 0;
  for (const r of allReels) {
    if (!temp[r]) { temp[r] = false; added += 1; }
  }

  if (added > 0 || newFile) {
    console.log(`➕ Found ${added} new Reel links to add.`);
    try {
      await fs.mkdirp(path.dirname(savePath));
      await fs.writeFile(savePath, JSON.stringify(temp, null, 4), 'utf-8');
      console.log(`✅ Successfully saved ${Object.keys(temp).length} total Reel links to ${green(savePath)}`);
      info(`Saved ${Object.keys(temp).length} Reel links for ${user}. Added ${added} new links.`);
    } catch (e) {
      err(`❌ File Error writing Reels results to ${savePath}: ${e.message}`);
      return;
    }
  } else {
    console.log('✅ No new Reel links found for this user.');
  }

  config.completed_queries[user] ??= {};
  config.completed_queries[user].type = 'user_reels';
  config.completed_queries[user].info ??= {};
  Object.assign(config.completed_queries[user].info, { url: userLink, posts, following, followers });
  config.completed_queries[user].post_saved = Object.keys(temp).length;
  config.completed_queries[user].saved_file = savePath;
  config.completed_queries[user].updated = getToday();
  config.completed_queries[user].status = 'Completed';
  config.completed_queries[user].followed = followed;

  if (config.queries?.[user]) delete config.queries[user];
  await updateConfig();
}

// ----------------------------- Quick search mode -----------------------------
// CLI: node instagram_scraper.js "Donald Trump" [maxItems]
// - Searches keyword (not just hashtag)
// - Collects post/reel links
// - Opens each and extracts og:image / og:video
// - Saves JSON to search/results_<slug>.json and prints a summary
async function quick_keyword_search_and_output(driver, term, maxItems = 25) {
  const encoded = encodeURIComponent(term);
  const url = `https://www.instagram.com/explore/search/keyword/?q=${encoded}`;
  console.log(cyan(`🔎 Quick search for: ${term}`));
  if (!(await navigateToUrl(driver, url))) {
    err('❌ Could not open search page.');
    return;
  }

  const desired = Math.min(Number(config.search_post_count || 100), maxItems);
  const links = await collect_search_links_generic(driver, desired, 200);

  if (!links.length) {
    console.log(yellow('⚠️ No links found.'));
    return;
  }

  const limited = links.slice(0, desired);
  console.log(`🧩 Extracting media from ${limited.length} items...`);
  const results = [];
  for (let i = 0; i < limited.length; i++) {
    const l = limited[i];
    process.stdout.write(`\r  (${i+1}/${limited.length}) ${l}                      `);
    try {
      const media = await scrape_media_from_post(driver, l);
      results.push(media);
    } catch (e) {
      results.push({ url: l, error: e.message });
    }
  }
  process.stdout.write('\n');

  // Save + print
  const slug = term.toLowerCase().replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
  const outFile = path.join(config.search_path || 'search/', `results_${slug}.json`);
  await fs.mkdirp(path.dirname(outFile));
  await fs.writeFile(outFile, JSON.stringify(results, null, 2), 'utf-8');

  console.log(green(`\n✅ Saved ${results.length} items to ${outFile}\n`));
  // Pretty print brief table
  console.log('URL | TYPE | IMAGE | VIDEO | TITLE');
  console.log('-'.repeat(120));
  for (const r of results) {
    console.log([
      r.url,
      r.type || '',
      r.image ? 'image✓' : '',
      r.video ? 'video✓' : '',
      (r.title || '').slice(0, 60)
    ].join(' | '));
  }
}

// ----------------------------- Main ------------------------------------------
async function main() {
  if (!(await loadConfig())) return;

  try {
    const userReelsDir = config.user_reels_path || 'user reels/';
    const searchDir = config.search_path || 'search/';
    const logFile = config.log_file || 'instagram.log';

    await fs.mkdirp(userReelsDir);
    console.log(`📁 Ensured user reels directory exists: ${cyan(userReelsDir)}`);
    await fs.mkdirp(searchDir);
    console.log(`📁 Ensured search directory exists: ${cyan(searchDir)}`);

    config.user_reels_path = userReelsDir;
    config.search_path = searchDir;
    config.log_file = logFile;
  } catch (e) {
    err(`❌ Error creating necessary directories: ${e.message}`);
    return;
  }

  setupLogging(config.log_file);

  let driver;
  try {
    driver = await setupDriver();
    if (!driver) { err('❌ WebDriver setup failed. Exiting.'); return; }

    if (!(await login(driver))) {
      err('❌ Login failed. Cannot proceed. Exiting.');
      return;
    }

    // --- NEW: Quick keyword search mode ---
    const termArg = process.argv[2];                 // e.g., "Donald Trump"
    const maxArg  = Number(process.argv[3] || 25);   // optional cap
    if (termArg) {
      await quick_keyword_search_and_output(driver, termArg, maxArg);
      return; // stop after quick run
    }

    // --- Original config-driven flow ---
    const pending = { ...(config.queries || {}) };
    const keys = Object.keys(pending);
    if (keys.length === 0) {
      console.log(yellow('🤔 No queries found in config file to process.'));
    } else {
      console.log(`✨ Starting processing of ${keys.length} queries...`);
      for (const query of keys) {
        console.log('-'.repeat(40));
        const type = pending[query];
        try {
          if (type === 'user_reels') {
            await user_reels_handler(driver, query, false);
          } else if (type === 'search') {
            await search_handler(driver, query);
          } else {
            console.log(yellow(`⚠️ Unknown query type '${type}' for query '${query}'. Skipping.`));
            config.completed_queries[query] = { type, status: 'Unknown Type', updated: getToday() };
            delete config.queries[query];
            await updateConfig();
          }
        } catch (e) {
          err(`❌ A critical error occurred processing query '${query}' (${type}): ${e.message}`);
          config.completed_queries[query] = { type, status: `Runtime Error: ${e.message}`, updated: getToday() };
          delete config.queries[query];
          await updateConfig();
        }
      }

      console.log('-'.repeat(40));
      const remaining = Object.keys(config.queries || {}).length;
      if (remaining === 0) {
        console.log(green('✅ All queries processed or removed due to errors.'));
      } else {
        console.log(yellow(`⚠️ Query processing finished, but ${remaining} queries remain (likely due to errors).`));
      }
    }
  } catch (e) {
    err(`💥 Unexpected critical error in main: ${e.message}`);
  } finally {
    if (driver) await closeDriver(driver);
  }
}

// ----------------------------- Bootstrap -------------------------------------
if (require.main === module) {
  console.log('\n' + '='.repeat(55));
  console.log(`🚀 Instagram Scraper Script Started at ${getToday()}`);
  console.log('='.repeat(55) + '\n');
  main().then(() => {
    console.log('\n' + '='.repeat(55));
    console.log(`🏁 Script Finished at ${getToday()}`);
    console.log('='.repeat(55) + '\n');
  });
}
