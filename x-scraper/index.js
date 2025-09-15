const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
require('dotenv').config();

puppeteer.use(StealthPlugin());

const app = express();
const PORT = 3000;

(async () => {
  const searchTerm = 'Elon Musk';

  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  try {
    await page.goto('https://x.com/i/flow/login');
    await new Promise(resolve => setTimeout(resolve, 10000));

    // await page.waitForSelector('input[name="text"]', { visible: true, timeout: 5000 });
    // await page.type('input[name="text"]', process.env.TWITTER_USERNAME);
    // await page.keyboard.press('Enter');

    // await new Promise(resolve => setTimeout(resolve, 10000));
    
    // Continue login or scraping...
  } catch (err) {
    console.error(err);
    await browser.close();
  }
})();

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
