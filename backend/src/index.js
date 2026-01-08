const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const scrapeRoutes = require('./routes/scrape.routes');

const app = express();
const PORT = process.env.PORT || 3000;

// Allow all origins - make API accessible to everyone
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

const limiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 10,
  message: {
    success: false,
    error: 'Too many requests, please try again later.'
  }
});

app.use('/api', limiter);

app.use('/api', scrapeRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Scraper API running on http://localhost:${PORT}`);
  console.log(`📡 POST /api/scrape - Start scraping a website`);
  console.log(`❤️  GET /health - Health check`);
});

module.exports = app;
