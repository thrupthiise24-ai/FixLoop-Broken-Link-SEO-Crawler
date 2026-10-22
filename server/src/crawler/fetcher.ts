import { FetchResult, RedirectHop } from '../../../shared/types.js';

export interface FetchOptions {
  timeoutMs?: number;
  maxRedirects?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  userAgent?: string;
  rateLimitMs?: number;
}

export class Fetcher {
  private userAgent: string;
  private timeoutMs: number;
  private maxRedirects: number;
  private maxRetries: number;
  private retryDelayMs: number;
  private rateLimitMs: number;
  private lastRequestTime: number = 0;

  constructor(options: FetchOptions = {}) {
    this.userAgent =
      options.userAgent ||
      'FixLoop-SEO-Crawler/1.0 (+https://github.com/fixloop/seo-crawler; bot@fixloop.dev)';
    this.timeoutMs = options.timeoutMs ?? 10000;
    this.maxRedirects = options.maxRedirects ?? 10;
    this.maxRetries = options.maxRetries ?? 2;
    this.retryDelayMs = options.retryDelayMs ?? 500;
    this.rateLimitMs = options.rateLimitMs ?? 50;
  }

  /**
   * Enforces a polite delay between requests to the same crawler instance.
   */
  private async applyRateLimit(): Promise<void> {
    if (this.rateLimitMs <= 0) return;
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.rateLimitMs) {
      await new Promise((resolve) => setTimeout(resolve, this.rateLimitMs - elapsed));
    }
    this.lastRequestTime = Date.now();
  }

  /**
   * Fetches a single HTTP request with manual redirect tracking, timeout, and retry logic.
   */
  public async fetch(url: string): Promise<FetchResult> {
    let attempts = 0;
    let lastError: Error | null = null;

    while (attempts <= this.maxRetries) {
      try {
        await this.applyRateLimit();
        return await this.executeFetchWithRedirects(url);
      } catch (err: any) {
        lastError = err;
        attempts++;
        if (attempts <= this.maxRetries && this.isRetryable(err)) {
          const delay = this.retryDelayMs * Math.pow(2, attempts - 1);
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          break;
        }
      }
    }

    return {
      finalUrl: url,
      statusCode: 0,
      redirectChain: [],
      durationMs: 0,
      error: lastError ? lastError.message : 'Unknown fetch error',
    };
  }

  /**
   * Executes manual hop-by-hop HTTP requests to capture every redirect in redirectChain.
   */
  private async executeFetchWithRedirects(initialUrl: string): Promise<FetchResult> {
    const startTime = Date.now();
    const redirectChain: RedirectHop[] = [];
    let currentUrl = initialUrl;
    const visitedUrls = new Set<string>();

    for (let hop = 0; hop <= this.maxRedirects; hop++) {
      if (visitedUrls.has(currentUrl)) {
        return {
          finalUrl: currentUrl,
          statusCode: 310, // Circular redirect
          redirectChain,
          durationMs: Date.now() - startTime,
          error: `Redirect loop detected at ${currentUrl}`,
        };
      }
      visitedUrls.add(currentUrl);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      let response: Response;
      try {
        response = await fetch(currentUrl, {
          method: 'GET',
          redirect: 'manual', // DO NOT auto-follow: capture each hop
          signal: controller.signal,
          headers: {
            'User-Agent': this.userAgent,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
          },
        });
      } finally {
        clearTimeout(timer);
      }

      const status = response.status;
      const isRedirect = [301, 302, 303, 307, 308].includes(status);

      if (isRedirect) {
        const locationHeader = response.headers.get('location');
        redirectChain.push({
          url: currentUrl,
          status_code: status,
          location: locationHeader,
        });

        if (!locationHeader) {
          return {
            finalUrl: currentUrl,
            statusCode: status,
            redirectChain,
            durationMs: Date.now() - startTime,
            error: `Redirect status ${status} received without Location header`,
          };
        }

        // Resolve relative redirect locations
        currentUrl = new URL(locationHeader, currentUrl).toString();
      } else {
        // Final destination reached
        const contentType = response.headers.get('content-type');
        let bodyText = '';
        if (contentType && (contentType.includes('text/html') || contentType.includes('application/xhtml+xml'))) {
          bodyText = await response.text();
        }

        return {
          finalUrl: currentUrl,
          statusCode: status,
          redirectChain,
          contentType,
          bodyText,
          durationMs: Date.now() - startTime,
        };
      }
    }

    return {
      finalUrl: currentUrl,
      statusCode: 310,
      redirectChain,
      durationMs: Date.now() - startTime,
      error: `Exceeded maximum redirect limit of ${this.maxRedirects} hops`,
    };
  }

  private isRetryable(err: any): boolean {
    if (!err) return false;
    if (err.name === 'AbortError' || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') {
      return true;
    }
    return false;
  }
}
