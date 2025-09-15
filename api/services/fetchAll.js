require('dotenv').config();
const mongoose = require('mongoose');
const fetchNewsByQuery = require('./fetch_google_news_rss');

const searchQueries = [
  'breaking news',
  'world headlines',
  'current events',
  'technology',
  'science',
  'business',
  'health',
  'sports',
  'entertainment',
  'politics',
  'economy',
  'environment',
  'education',
  'art and culture',
  'travel',
  'finance',
  'startups',
  'artificial intelligence',
  'space exploration',
  'renewable energy',
  'global health',
  'human rights',
  'social justice',
  'europe news',
  'asia pacific developments',
  'africa current affairs',
  'middle east conflict',
  'americas politics'
];

(async () => {
  await mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  for (const query of searchQueries) {
    await fetchNewsByQuery(query);
  }

  mongoose.disconnect();
})();
