const Parser = require('rss-parser');
const mongoose = require('mongoose');
const { JSDOM } = require('jsdom');
const parser = new Parser({ customFields: { item: ['source', 'guid'] } });

const extractPlainTextFromDescription = (html) => {
  try {
    const dom = new JSDOM(html);
    const items = [...dom.window.document.querySelectorAll('li a')];
    return items.map(el => el.textContent).join(' | ');
  } catch {
    return '';
  }
};

const sanitizeCollectionName = (query) =>
  query.toLowerCase().replace(/\s+/g, '_').replace(/[^\w]/g, '');

const fetchNewsByQuery = async (query) => {
  const encoded = encodeURIComponent(query);
  const url = `https://news.google.com/rss/search?q=${encoded}&hl=en-US&gl=US&ceid=US:en`;

  const feed = await parser.parseURL(url);
  const collectionName = sanitizeCollectionName(query);
  const ArticleModel = mongoose.model(
    collectionName,
    new mongoose.Schema({
      guid: { type: String, unique: true },
      title: String,
      link: String,
      pubDate: Date,
      description: String,
      source: String,
    }),
    collectionName
  );

  for (const item of feed.items) {
    const plainText = extractPlainTextFromDescription(item.description);

    try {
      await ArticleModel.updateOne(
        { guid: item.guid },
        {
          $setOnInsert: {
            title: item.title,
            link: item.link,
            pubDate: new Date(item.pubDate),
            description: plainText,
            source: item.source || '',
          },
        },
        { upsert: true }
      );
    } catch (err) {
      console.error(`Error saving to ${collectionName}:`, err.message);
    }
  }

  console.log(`Fetched and stored: ${query}`);
};

module.exports = fetchNewsByQuery;
