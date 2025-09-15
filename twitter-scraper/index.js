const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const storagePath = path.resolve(__dirname, 'auth.json');
  const browser = await chromium.launch({ headless: false });

  const context = fs.existsSync(storagePath)
    ? await browser.newContext({ storageState: storagePath }) // Reuse session
    : await browser.newContext(); // First-time login

  const page = await context.newPage();

  page.on('request', request => {
  const url = request.url();
  if (url.includes('searchtimeline')) {
    console.log('[REQUEST]', url);
  }
});

page.on('response', async response => {
  const url = response.url();
  if (url.includes('searchtimeline')) {
    console.log('[RESPONSE]', url);
    try {
      const body = await response.text(); // be cautious with large payloads
      console.log('[RESPONSE BODY]', body.slice(0, 500)); // trimmed for log
    } catch (e) {
      console.error('Failed to read response body:', e);
    }
  }
});

  if (!fs.existsSync(storagePath)) {
    // First-time login
    await page.goto('https://x.com/i/flow/login');

    const usernameSelector = 'input[name="text"]';
    await page.waitForSelector(usernameSelector);
    await page.fill(usernameSelector, 'wrestlewor83049');
    await page.getByRole('button', { name: 'Next' }).click();

    const passwordSelector = 'input[name="password"]';
    await page.waitForSelector(passwordSelector, { timeout: 10000 });
    await page.fill(passwordSelector, 'Donegal1');

    console.log('Password entered.');

    const loginButtonSelector = 'button[data-testid="LoginForm_Login_Button"]';
    await page.waitForFunction(selector => {
      const btn = document.querySelector(selector);
      return btn && !btn.disabled;
    }, loginButtonSelector);

    await page.click(loginButtonSelector);
    console.log('"Log in" button clicked.');

    // Wait to confirm login visually
    await page.waitForTimeout(10000);

    // Save auth session
    await context.storageState({ path: storagePath });
    console.log('Login session saved to auth.json');
  }

  // Search step (now works whether fresh login or reused session)
  const searchTerm = 'LiverpoolFC';
  await page.goto(`https://x.com/search?q=${encodeURIComponent(searchTerm)}&src=typed_query`);
  console.log(`Searching for "${searchTerm}"...`);

  await page.waitForSelector('article', { timeout: 15000 });


    // Now scrape tweet contents
    const tweets = await page.$$eval('div[data-testid="cellInnerDiv"]', (tweetDivs) =>
    tweetDivs.map((div) => {
        const text = Array.from(div.querySelectorAll('div[lang]'))
        .map(el => el.innerText.trim())
        .filter(Boolean)
        .join('\n');

        const images = Array.from(div.querySelectorAll('img'))
        .map(img => img.src)
        .filter(src => !src.includes('profile_images')); // exclude avatars

        return {
        text,
        images
        };
    })
    );

// Remove empty entries
const cleanedTweets = tweets.filter(tweet => tweet.text || tweet.images.length > 0);

console.log(JSON.stringify(cleanedTweets, null, 2));

  // Optionally keep browser open
  // await browser.close();
})();
