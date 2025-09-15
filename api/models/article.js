const mongoose = require('mongoose');

const articleSchema = new mongoose.Schema({
  guid: { type: String, unique: true },
  title: String,
  link: String,
  pubDate: Date,
  description: String,
  source: String,
});

module.exports = mongoose.model('Article', articleSchema,  'news_articles');
