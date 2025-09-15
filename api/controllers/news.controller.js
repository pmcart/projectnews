const Article = require('../models/article'); // Adjust path if needed
const mongoose = require('mongoose');

const articleSchema = new mongoose.Schema({
  guid: { type: String, unique: true },
  title: String,
  link: String,
  pubDate: Date,
  description: String,
  source: String,
});

exports.getAllNewsArticles = async (req, res) => {
  try {
    const groupedArticles = {};

    for (const collectionName of validCollections) {
      const ArticleModel = mongoose.model(collectionName, articleSchema, collectionName);
      const articles = await ArticleModel.find().sort({ pubDate: -1 }).limit(3);

      // Optionally convert the collection name to kebab-case or keep as-is
      const key = collectionName.toLowerCase().replace(/\s+/g, '-');
      groupedArticles[key] = articles;
    }

    res.json(groupedArticles);
  } catch (error) {
    console.error('Error fetching grouped articles:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};


const validCollections = [
  'breaking news', 'world headlines', 'current events', 'technology',
  'science', 'business', 'health', 'sports', 'entertainment', 'politics',
  'economy', 'environment', 'education', 'art and culture', 'travel',
  'finance', 'startups', 'artificial intelligence', 'space exploration',
  'renewable energy', 'global health', 'human rights', 'social justice',
  'europe news', 'asia pacific developments', 'africa current affairs',
  'middle east conflict', 'americas politics'
];

exports.getAllNewsArticlesByType = async (req, res) => {
  const type = req.params.type;

  // Match the incoming type with a valid collection (case insensitive)
  const collectionName = validCollections.find(name => name.toLowerCase().replace(/\s+/g, '-') === type.toLowerCase());

  if (!collectionName) {
    return res.status(400).json({ error: 'Invalid news type' });
  }

  try {
    const ArticleModel = mongoose.model(collectionName, articleSchema, collectionName);
    const articles = await ArticleModel.find().sort({ pubDate: -1 });

    res.json(articles);
  } catch (error) {
    console.error(`Error fetching articles from ${collectionName}:`, error);
    res.status(500).json({ error: 'Internal server error' });
  }
};