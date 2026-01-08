const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');
const https = require('https');
const AppError = require('../utils/AppError');

// Conditional Puppeteer imports for serverless vs local
let puppeteer;
let chromium;
const isVercel = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME;

if (isVercel) {
  puppeteer = require('puppeteer-core');
  chromium = require('@sparticuz/chromium');
}

// Create HTTPS agent that ignores certificate errors
const httpsAgent = new https.Agent({
  rejectUnauthorized: false
});

class ScraperService {
  constructor(options = {}) {
    this.maxPages = options.maxPages || 5;
    this.timeout = options.timeout || 30000;
    this.visitedUrls = new Set();
    this.baseUrl = null;
    this.baseDomain = null;
    this.browser = null;
    this.usePuppeteer = false;
  }

  async getBrowser() {
    if (!this.browser) {
      if (isVercel) {
        // Serverless environment (Vercel)
        this.browser = await puppeteer.launch({
          args: chromium.args,
          defaultViewport: chromium.defaultViewport,
          executablePath: await chromium.executablePath(),
          headless: chromium.headless,
          ignoreHTTPSErrors: true
        });
      } else {
        // Local development - use puppeteer with system Chrome or skip
        try {
          const localPuppeteer = require('puppeteer');
          this.browser = await localPuppeteer.launch({
            headless: 'new',
            ignoreHTTPSErrors: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
          });
        } catch (e) {
          console.log('Puppeteer not available locally, skipping browser-based scraping');
          return null;
        }
      }
    }
    return this.browser;
  }

  async closeBrowser() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  async scrape(url) {
    try {
      const parsedUrl = new URL(url);
      this.baseUrl = `${parsedUrl.protocol}//${parsedUrl.host}`;
      this.baseDomain = parsedUrl.host;

      // First try with axios (faster)
      let pages;
      try {
        this.usePuppeteer = false;
        pages = await this.crawlPages(url);
      } catch (axiosError) {
        // If blocked (403, Cloudflare, etc.), retry with Puppeteer
        console.log('Axios failed, trying with Puppeteer for Cloudflare bypass...');
        this.usePuppeteer = true;
        this.visitedUrls.clear();
        pages = await this.crawlPages(url);
        await this.closeBrowser();
      }

      const siteTitle = pages.length > 0 ? pages[0].title : '';

      return {
        siteTitle,
        baseUrl: this.baseUrl,
        scrapedAt: new Date().toISOString(),
        totalPages: pages.length,
        pages
      };

    } catch (error) {
      await this.closeBrowser();
      
      if (error instanceof AppError) {
        throw error;
      }
      
      if (error.code === 'ENOTFOUND') {
        throw new AppError('Website not found. Please check the URL.', 400);
      }
      
      if (error.code === 'ECONNREFUSED') {
        throw new AppError('Connection refused. The website may be down.', 503);
      }

      if (error.code === 'CERT_HAS_EXPIRED' || error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || 
          error.code === 'SELF_SIGNED_CERT_IN_CHAIN' || error.code === 'ERR_TLS_CERT_ALTNAME_INVALID' ||
          error.message.includes('certificate')) {
        throw new AppError('SSL certificate error. The website has an invalid certificate.', 400);
      }

      if (error.message.includes('Invalid URL')) {
        throw new AppError('Invalid URL format provided.', 400);
      }

      throw new AppError('Failed to scrape the website. Please try again.', 500);
    }
  }

  async crawlPages(startUrl) {
    const pages = [];
    const urlsToVisit = [startUrl];

    while (urlsToVisit.length > 0 && pages.length < this.maxPages) {
      const currentUrl = urlsToVisit.shift();
      
      if (this.visitedUrls.has(currentUrl)) {
        continue;
      }

      try {
        const pageData = await this.scrapePage(currentUrl);
        
        if (pageData) {
          pages.push(pageData);
          this.visitedUrls.add(currentUrl);

          if (pages.length < this.maxPages) {
            for (const link of pageData.internalLinks) {
              const fullUrl = this.resolveUrl(link);
              if (fullUrl && !this.visitedUrls.has(fullUrl) && !urlsToVisit.includes(fullUrl)) {
                urlsToVisit.push(fullUrl);
              }
            }
          }
        }
      } catch (error) {
        console.warn(`⚠️ Failed to scrape ${currentUrl}: ${error.message}`);
        this.visitedUrls.add(currentUrl);
        
        if (pages.length === 0 && urlsToVisit.length === 0) {
          if (error.response?.status === 403) {
            throw new AppError('Access denied (403). This website blocks automated scraping requests.', 403);
          }
          if (error.response?.status === 429) {
            throw new AppError('Too many requests (429). Please try again later.', 429);
          }
          throw error;
        }
      }
    }

    if (pages.length === 0) {
      throw new AppError('Could not scrape any pages from this website. The site may block scraping or require authentication.', 403);
    }

    return pages;
  }

  async scrapePage(url) {
    let html;
    
    if (this.usePuppeteer) {
      html = await this.scrapeWithPuppeteer(url);
    } else {
      html = await this.scrapeWithAxios(url);
    }

    if (!html) return null;

    const $ = cheerio.load(html);
    const parsedUrl = new URL(url);

    const pageData = {
      url: parsedUrl.pathname || '/',
      fullUrl: url,
      title: this.extractTitle($),
      metaDescription: this.extractMetaDescription($),
      headings: this.extractHeadings($),
      content: this.extractContent($),
      images: this.extractImages($, url),
      internalLinks: this.extractInternalLinks($, url),
      externalLinks: this.extractExternalLinks($, url)
    };

    return pageData;
  }

  async scrapeWithAxios(url) {
    const response = await axios.get(url, {
      timeout: this.timeout,
      httpsAgent: httpsAgent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1'
      },
      maxRedirects: 5
    });

    const contentType = response.headers['content-type'] || '';
    if (!contentType.includes('text/html')) {
      return null;
    }

    // Check for Cloudflare challenge page
    if (response.data.includes('cf-browser-verification') || 
        response.data.includes('cf_clearance') ||
        response.data.includes('Checking your browser') ||
        response.data.includes('Just a moment...')) {
      throw new Error('Cloudflare protection detected');
    }

    return response.data;
  }

  async scrapeWithPuppeteer(url) {
    const browser = await this.getBrowser();
    const page = await browser.newPage();

    try {
      // Set a realistic viewport
      await page.setViewport({ width: 1920, height: 1080 });

      // Set user agent
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      // Set extra headers
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8'
      });

      // Navigate to the page and wait for it to load
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: this.timeout
      });

      // Wait additional time for Cloudflare challenge to complete
      await page.waitForTimeout(3000);

      // Check if still on Cloudflare page
      const content = await page.content();
      if (content.includes('Checking your browser') || content.includes('Just a moment...')) {
        // Wait more for the challenge to resolve
        await page.waitForTimeout(5000);
      }

      const html = await page.content();
      await page.close();

      return html;
    } catch (error) {
      await page.close();
      throw error;
    }
  }

  extractTitle($) {
    return $('title').first().text().trim() || 
           $('h1').first().text().trim() || 
           'Untitled Page';
  }

  extractMetaDescription($) {
    return $('meta[name="description"]').attr('content')?.trim() ||
           $('meta[property="og:description"]').attr('content')?.trim() ||
           '';
  }

  extractHeadings($) {
    const headings = [];
    
    $('h1, h2, h3').each((_, element) => {
      const text = $(element).text().trim();
      const tag = element.tagName.toLowerCase();
      
      if (text && text.length > 0 && text.length < 500) {
        headings.push({
          level: tag,
          text: text
        });
      }
    });

    return headings.slice(0, 50);
  }

  extractContent($) {
    const content = [];
    
    $('script, style, nav, footer, header, aside, .nav, .footer, .header, .sidebar').remove();

    $('p').each((_, element) => {
      const text = $(element).text().trim();
      
      if (text && text.length > 20 && text.length < 5000) {
        content.push(text);
      }
    });

    return content.slice(0, 100);
  }

  extractImages($, pageUrl) {
    const images = [];
    const seen = new Set();

    $('img').each((_, element) => {
      let src = $(element).attr('src') || $(element).attr('data-src');
      const alt = $(element).attr('alt') || '';
      
      if (src && !seen.has(src)) {
        try {
          const absoluteUrl = new URL(src, pageUrl).href;
          
          if (!this.isTrackingPixel(absoluteUrl)) {
            images.push({
              src: absoluteUrl,
              alt: alt.trim()
            });
            seen.add(src);
          }
        } catch (e) {
        }
      }
    });

    return images.slice(0, 50);
  }

  isTrackingPixel(url) {
    const trackingPatterns = [
      /pixel/i,
      /tracker/i,
      /beacon/i,
      /1x1/i,
      /spacer/i,
      /\.gif$/i
    ];
    
    return trackingPatterns.some(pattern => pattern.test(url));
  }

  extractInternalLinks($, pageUrl) {
    const links = [];
    const seen = new Set();

    $('a[href]').each((_, element) => {
      const href = $(element).attr('href');
      
      if (href && !seen.has(href)) {
        try {
          const absoluteUrl = new URL(href, pageUrl);
          
          if (absoluteUrl.host === this.baseDomain) {
            const path = absoluteUrl.pathname;
            
            if (this.isValidPageLink(path)) {
              links.push(path);
              seen.add(href);
            }
          }
        } catch (e) {
        }
      }
    });

    return [...new Set(links)].slice(0, 100);
  }

  extractExternalLinks($, pageUrl) {
    const links = [];
    const seen = new Set();

    $('a[href]').each((_, element) => {
      const href = $(element).attr('href');
      
      if (href && !seen.has(href)) {
        try {
          const absoluteUrl = new URL(href, pageUrl);
          
          if (absoluteUrl.host !== this.baseDomain && 
              (absoluteUrl.protocol === 'http:' || absoluteUrl.protocol === 'https:')) {
            links.push(absoluteUrl.href);
            seen.add(href);
          }
        } catch (e) {
        }
      }
    });

    return links.slice(0, 50);
  }

  isValidPageLink(path) {
    const invalidExtensions = [
      '.pdf', '.doc', '.docx', '.xls', '.xlsx',
      '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp',
      '.mp3', '.mp4', '.avi', '.mov',
      '.zip', '.rar', '.tar', '.gz'
    ];

    const invalidPatterns = [
      /^#/,           // Anchor links
      /^mailto:/i,    // Email links
      /^tel:/i,       // Phone links
      /^javascript:/i // JavaScript links
    ];

    const hasInvalidExtension = invalidExtensions.some(ext => 
      path.toLowerCase().endsWith(ext)
    );

    const hasInvalidPattern = invalidPatterns.some(pattern => 
      pattern.test(path)
    );

    return !hasInvalidExtension && !hasInvalidPattern;
  }

  resolveUrl(path) {
    try {
      return new URL(path, this.baseUrl).href;
    } catch (e) {
      return null;
    }
  }
}

module.exports = ScraperService;
