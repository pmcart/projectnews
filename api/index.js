require('dotenv').config();
const app = require('./app');
const connectDB = require('./config/db');
const fetchAndStoreNews = require('./services/fetch_google_news_rss');

const PORT = process.env.PORT || 3000;

(async () => {
  try {
    await connectDB(); // Connect to MongoDB
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
  }
})();
