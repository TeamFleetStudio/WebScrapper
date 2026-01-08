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
      const stealthArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080',
        '--start-maximized',
        '--hide-scrollbars',
        '--mute-audio',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-extensions',
        '--disable-sync',
        '--disable-translate',
        '--metrics-recording-only',
        '--no-first-run',
        '--safebrowsing-disable-auto-update'
      ];

      if (isVercel) {
        // Serverless environment (Vercel)
        this.browser = await puppeteer.launch({
          args: [...chromium.args, ...stealthArgs],
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
            args: stealthArgs
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

  // Special handler for LeetCode using their GraphQL API
  async scrapeLeetCode(url, parsedUrl) {
    // Extract username from URL like /u/username/ or /username/
    const pathParts = parsedUrl.pathname.split('/').filter(p => p);
    let username = null;
    
    if (pathParts[0] === 'u' && pathParts[1]) {
      username = pathParts[1];
    } else if (pathParts[0] && !['problems', 'contest', 'discuss', 'explore'].includes(pathParts[0])) {
      username = pathParts[0];
    }

    if (username) {
      // Use LeetCode's public GraphQL API
      const graphqlUrl = 'https://leetcode.com/graphql';
      
      const query = `
        query userPublicProfile($username: String!) {
          matchedUser(username: $username) {
            username
            profile {
              realName
              aboutMe
              userAvatar
              reputation
              ranking
              company
              school
              websites
              countryName
              skillTags
            }
            submitStats: submitStatsGlobal {
              acSubmissionNum {
                difficulty
                count
                submissions
              }
            }
            badges {
              name
              icon
            }
          }
        }
      `;

      try {
        const response = await axios.post(graphqlUrl, {
          query,
          variables: { username }
        }, {
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://leetcode.com',
            'Origin': 'https://leetcode.com'
          },
          timeout: this.timeout
        });

        const userData = response.data?.data?.matchedUser;
        
        if (!userData) {
          throw new AppError('LeetCode user not found.', 404);
        }

        const profile = userData.profile || {};
        const stats = userData.submitStats?.acSubmissionNum || [];
        
        // Format the data as a page
        const content = [];
        if (profile.aboutMe) content.push(profile.aboutMe);
        if (profile.company) content.push(`Company: ${profile.company}`);
        if (profile.school) content.push(`School: ${profile.school}`);
        if (profile.countryName) content.push(`Country: ${profile.countryName}`);
        
        // Add problem stats
        stats.forEach(stat => {
          content.push(`${stat.difficulty}: ${stat.count} problems solved (${stat.submissions} submissions)`);
        });

        return {
          siteTitle: `${userData.username} - LeetCode Profile`,
          baseUrl: 'https://leetcode.com',
          scrapedAt: new Date().toISOString(),
          totalPages: 1,
          pages: [{
            url: parsedUrl.pathname,
            fullUrl: url,
            title: `${userData.username} - LeetCode Profile`,
            metaDescription: profile.aboutMe || `LeetCode profile for ${userData.username}`,
            headings: [
              { level: 'h1', text: userData.username },
              { level: 'h2', text: `Ranking: #${profile.ranking || 'N/A'}` },
              { level: 'h2', text: `Reputation: ${profile.reputation || 0}` }
            ],
            content,
            images: profile.userAvatar ? [{ src: profile.userAvatar, alt: 'Profile Avatar' }] : [],
            internalLinks: [],
            externalLinks: profile.websites || [],
            leetcodeData: {
              username: userData.username,
              profile,
              stats,
              badges: userData.badges || []
            }
          }]
        };
      } catch (error) {
        if (error instanceof AppError) throw error;
        console.error('LeetCode API error:', error.message);
        throw new AppError('Failed to fetch LeetCode profile. The user may not exist or the service is temporarily unavailable.', 503);
      }
    }

    // If not a user profile, try regular scraping
    throw new AppError('LeetCode pages other than user profiles cannot be scraped due to heavy JavaScript rendering.', 400);
  }

  async scrape(url) {
    try {
      const parsedUrl = new URL(url);
      this.baseUrl = `${parsedUrl.protocol}//${parsedUrl.host}`;
      this.baseDomain = parsedUrl.host;

      // Special handling for LeetCode
      if (parsedUrl.host.includes('leetcode.com')) {
        return await this.scrapeLeetCode(url, parsedUrl);
      }

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
    if (!browser) {
      throw new Error('Browser not available');
    }
    const page = await browser.newPage();

    try {
      // Stealth mode - hide automation indicators
      await page.evaluateOnNewDocument(() => {
        // Override webdriver property
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined,
        });
        
        // Override plugins
        Object.defineProperty(navigator, 'plugins', {
          get: () => [1, 2, 3, 4, 5],
        });
        
        // Override languages
        Object.defineProperty(navigator, 'languages', {
          get: () => ['en-US', 'en'],
        });
        
        // Override chrome property
        window.chrome = {
          runtime: {},
        };
        
        // Override permissions
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) => (
          parameters.name === 'notifications' ?
            Promise.resolve({ state: Notification.permission }) :
            originalQuery(parameters)
        );
      });

      // Set a realistic viewport
      await page.setViewport({ width: 1920, height: 1080 });

      // Set user agent
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      // Set extra headers
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"'
      });

      // Navigate to the page and wait for it to load
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: this.timeout
      });

      // Wait for page to fully load and any JS to execute
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Scroll down to trigger lazy loading
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight / 2);
      });
      
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Check if blocked or on challenge page
      const content = await page.content();
      if (content.includes('Checking your browser') || 
          content.includes('Just a moment...') ||
          content.includes('Access Denied') ||
          content.includes('403 Forbidden')) {
        // Wait more for the challenge to resolve
        await new Promise(resolve => setTimeout(resolve, 8000));
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
