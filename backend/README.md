# GAB-On Lite - Website Scraper Backend

A Node.js backend service that scrapes public websites and returns structured JSON data. Built for the GAB-On Lite project.

## Features

- 🔍 **Website Scraping** - Extract content from any public website
- 📄 **Multi-page Crawling** - Crawl up to 5 internal pages (configurable)
- 📊 **Structured Output** - Clean JSON format with pages, headings, content, images, and links
- 🛡️ **Rate Limiting** - Built-in protection against abuse
- ⚡ **Error Handling** - Graceful handling of timeouts, blocked sites, and invalid URLs
- 🔒 **Safe Scraping** - Respects page limits and doesn't overload target sites

## Quick Start

### Prerequisites

- Node.js 18+ 
- npm or yarn

### Installation

```bash
# Navigate to the project directory
cd gab-on-scraper-backend

# Install dependencies
npm install

# Start the development server
npm run dev

# Or start the production server
npm start
```

The server will start at `http://localhost:3000`

## API Reference

### Scrape Website

**Endpoint:** `POST /api/scrape`

**Request Body:**
```json
{
  "url": "https://example.com",
  "maxPages": 5
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| url | string | Yes | The public website URL to scrape (must include http/https) |
| maxPages | number | No | Maximum pages to crawl (1-10, default: 5) |

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "siteTitle": "Example Site",
    "baseUrl": "https://example.com",
    "scrapedAt": "2026-01-07T10:30:00.000Z",
    "totalPages": 3,
    "pages": [
      {
        "url": "/",
        "fullUrl": "https://example.com/",
        "title": "Example Site - Home",
        "metaDescription": "Welcome to Example Site",
        "headings": [
          { "level": "h1", "text": "Welcome" },
          { "level": "h2", "text": "Our Services" }
        ],
        "content": [
          "We build amazing products...",
          "Our team is dedicated to excellence..."
        ],
        "images": [
          { "src": "https://example.com/hero.jpg", "alt": "Hero image" }
        ],
        "internalLinks": ["/about", "/contact", "/services"],
        "externalLinks": ["https://twitter.com/example"]
      }
    ]
  }
}
```

**Error Response (400/500):**
```json
{
  "success": false,
  "error": "Website not found. Please check the URL."
}
```

### Health Check

**Endpoint:** `GET /health`

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-01-07T10:30:00.000Z"
}
```

## Extracted Data

The scraper extracts the following content from each page:

| Field | Description |
|-------|-------------|
| title | Page title from `<title>` tag or first `<h1>` |
| metaDescription | Content from meta description or og:description |
| headings | All h1, h2, h3 headings with their level |
| content | Paragraph text (excluding nav, footer, sidebar) |
| images | Image URLs with alt text |
| internalLinks | Links to other pages on the same domain |
| externalLinks | Links to external websites |

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| PORT | 3000 | Server port |
| NODE_ENV | development | Environment mode |

### Rate Limiting

By default, the API limits each IP to 10 requests per minute. This can be adjusted in `src/index.js`.

## Project Structure

```
gab-on-scraper-backend/
├── src/
│   ├── index.js              # Express app entry point
│   ├── routes/
│   │   └── scrape.routes.js  # API route definitions
│   ├── services/
│   │   └── scraper.service.js # Core scraping logic
│   └── utils/
│       └── AppError.js       # Custom error class
├── package.json
├── .env.example
├── .gitignore
└── README.md
```

## Error Handling

The API handles the following error scenarios:

- **Invalid URL** - Returns 400 with validation message
- **Website not found** - Returns 400 when domain doesn't exist
- **Connection refused** - Returns 503 when site is down
- **Timeout** - Returns error after 10 seconds per page
- **Rate limit exceeded** - Returns 429 when too many requests

## Limitations

- Only scrapes publicly accessible content
- No support for JavaScript-rendered content (SPA)
- No authentication-protected pages
- Maximum 10 pages per request
- 10-second timeout per page

## Technologies

- **Express.js** - Web framework
- **Axios** - HTTP client
- **Cheerio** - HTML parser
- **express-rate-limit** - Rate limiting
- **express-validator** - Input validation

## License

MIT
