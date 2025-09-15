const express = require('express');
const newsRoutes = require('./routes/news.routes');
const cors = require('cors');
const fetchAndStoreNews = require('./services/fetch_google_news_rss');

const app = express();

app.use(cors());
// Middleware
app.use(express.json());


// API Routes
app.use('/api/news', newsRoutes);

// Utility Route
app.get('/fetch-news', async (req, res) => {
  try {
    await fetchAndStoreNews();
    res.send('News fetched and stored!');
  } catch (err) {
    res.status(500).send('Error fetching news');
  }
});

module.exports = app;
