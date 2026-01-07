const express = require('express');
const { body, validationResult } = require('express-validator');
const ScraperService = require('../services/scraper.service');

const router = express.Router();

router.post(
  '/scrape',
  [
    body('url')
      .notEmpty()
      .withMessage('URL is required')
      .isURL({ protocols: ['http', 'https'], require_protocol: true })
      .withMessage('Please provide a valid URL with http or https protocol'),
    body('maxPages')
      .optional()
      .isInt({ min: 1, max: 5 })
      .withMessage('maxPages must be between 1 and 5')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array().map(err => err.msg)
        });
      }

      const { url, maxPages = 5 } = req.body;

      console.log(`📥 Scrape request received for: ${url}`);

      const scraper = new ScraperService({
        maxPages: parseInt(maxPages),
        timeout: 10000
      });

      const result = await scraper.scrape(url);

      console.log(`✅ Successfully scraped ${result.pages.length} pages from ${url}`);

      res.json({
        success: true,
        data: result
      });

    } catch (error) {
      console.error(`❌ Scraping error: ${error.message}`);

      const statusCode = error.statusCode || 500;
      const errorMessage = error.isOperational 
        ? error.message 
        : 'An error occurred while scraping the website';

      res.status(statusCode).json({
        success: false,
        error: errorMessage
      });
    }
  }
);

module.exports = router;
