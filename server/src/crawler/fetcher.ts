import type { LinkOutcome } from "../../../shared/types";
import { normalizeUrl } from "./normalizeUrl";

export interface FetchResult {
  requestedUrl: string;
  finalUrl: string;
  statusCode: number | null;
  redirectChain: string[];
  body: string;
  contentType: string | null;
  outcome: LinkOutcome;
  error?: string;
  checkedAt: string;
}

export interface FetcherOptions {
  timeoutMs?: number;
  maxRedirects?: number;
  retries?: number;
  rateLimitMs?: number;
  maxBodyBytes?: number;
  userAgent?: string;
}

export interface FetchRequestOptions {
  method?: "GET" | "HEAD";
  /** Set false for status-only probes, including GET fallbacks for unsupported HEAD. */
  readBody?: boolean;
}

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

async function readBodyLimited(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    const remaining = maxBytes - size;
    if (remaining <= 0) {
      await reader.cancel();
      break;
    }
    const chunk = value.byteLength > remaining ? value.slice(0, remaining) : value;
    chunks.push(chunk);
    size += chunk.byteLength;
    if (chunk.byteLength < value.byteLength || size >= maxBytes) {
      await reader.cancel();
      break;
    }
  }
  const buffer = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(buffer);
}

export class PoliteFetcher {
  private readonly timeoutMs: number;
  private readonly maxRedirects: number;
  private readonly retries: number;
  private readonly rateLimitMs: number;
  private readonly maxBodyBytes: number;
  private readonly userAgent: string;
  private readonly lastRequestAt = new Map<string, number>();
  private readonly originDelayMs = new Map<string, number>();
  private readonly originTail = new Map<string, Promise<void>>();

  constructor(options: FetcherOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.maxRedirects = options.maxRedirects ?? 10;
    this.retries = options.retries ?? 1;
    this.rateLimitMs = options.rateLimitMs ?? 20;
    this.maxBodyBytes = options.maxBodyBytes ?? 1_500_000;
    this.userAgent = options.userAgent ?? "FixLoopBot/1.0 (+authorized SEO audit)";
  }

  setOriginCrawlDelay(origin: string, delayMs: number): void {
    if (!Number.isFinite(delayMs) || delayMs < 0) return;
    this.originDelayMs.set(origin, Math.max(this.originDelayMs.get(origin) ?? 0, delayMs));
  }

  async fetch(url: string, requestOptions: FetchRequestOptions = {}): Promise<FetchResult> {
    const normalized = normalizeUrl(url);
    if (!normalized) {
      return this.errorResult(url, url, "error", "Only HTTP and HTTPS URLs can be fetched.");
    }

    let last: FetchResult | undefined;
    const method = requestOptions.method ?? "GET";
    const readBody = method !== "HEAD" && (requestOptions.readBody ?? true);
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      last = await this.fetchOnce(normalized, method, readBody);
      const retryable = last.outcome === "timeout" ||
        (last.statusCode !== null && last.statusCode >= 500) ||
        (last.statusCode === null && last.outcome === "error");
      if (!retryable || attempt >= this.retries) return last;
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
    return last ?? this.errorResult(normalized, normalized, "error", "Fetch failed.");
  }

  private async fetchOnce(startUrl: string, method: "GET" | "HEAD", readBody: boolean): Promise<FetchResult> {
    const checkedAt = new Date().toISOString();
    const chain = [startUrl];
    const visited = new Set<string>(chain);
    let currentUrl = startUrl;

    try {
      for (let hop = 0; hop <= this.maxRedirects; hop++) {
        const { response, body } = await this.requestHop(currentUrl, method, readBody);

        if (REDIRECT_CODES.has(response.status)) {
          const location = response.headers.get("location");
          if (!location) {
            return {
              requestedUrl: startUrl,
              finalUrl: currentUrl,
              statusCode: response.status,
              redirectChain: chain,
              body: "",
              contentType: response.headers.get("content-type"),
              outcome: "error",
              error: `HTTP ${response.status} response had no Location header.`,
              checkedAt,
            };
          }
          const nextUrl = normalizeUrl(location, currentUrl);
          if (!nextUrl) {
            return {
              requestedUrl: startUrl,
              finalUrl: currentUrl,
              statusCode: response.status,
              redirectChain: chain,
              body: "",
              contentType: response.headers.get("content-type"),
              outcome: "error",
              error: "Redirect target was not an HTTP or HTTPS URL.",
              checkedAt,
            };
          }
          if (visited.has(nextUrl)) {
            return {
              requestedUrl: startUrl,
              finalUrl: nextUrl,
              statusCode: response.status,
              redirectChain: [...chain, nextUrl],
              body: "",
              contentType: response.headers.get("content-type"),
              outcome: "error",
              error: "Redirect loop detected.",
              checkedAt,
            };
          }
          if (hop === this.maxRedirects) {
            return {
              requestedUrl: startUrl,
              finalUrl: currentUrl,
              statusCode: response.status,
              redirectChain: chain,
              body: "",
              contentType: response.headers.get("content-type"),
              outcome: "error",
              error: `Redirect limit (${this.maxRedirects}) exceeded.`,
              checkedAt,
            };
          }
          currentUrl = nextUrl;
          chain.push(currentUrl);
          visited.add(currentUrl);
          continue;
        }

        const contentType = response.headers.get("content-type");
        const outcome: LinkOutcome = response.status >= 400 ? "error" : "ok";
        return {
          requestedUrl: startUrl,
          finalUrl: currentUrl,
          statusCode: response.status,
          redirectChain: chain,
          body,
          contentType,
          outcome,
          checkedAt,
        };
      }
      return this.errorResult(startUrl, currentUrl, "error", "Redirect limit exceeded.", chain);
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
      return this.errorResult(
        startUrl,
        currentUrl,
        timedOut ? "timeout" : "error",
        error instanceof Error ? error.message : String(error),
        chain,
        checkedAt,
      );
    }
  }

  private async requestHop(
    url: string,
    method: "GET" | "HEAD",
    readBody: boolean,
  ): Promise<{ response: Response; body: string }> {
    await this.waitForOrigin(new URL(url).origin);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": this.userAgent,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      const isText = contentType.startsWith("text/") ||
        contentType.includes("application/xhtml+xml") ||
        contentType.includes("application/xml") ||
        contentType.includes("application/json");
      const body = !readBody || method === "HEAD" || REDIRECT_CODES.has(response.status) || !isText
        ? ""
        : await readBodyLimited(response, this.maxBodyBytes);
      if ((!readBody || method === "HEAD" || REDIRECT_CODES.has(response.status) || !isText) && response.body) {
        await response.body.cancel().catch(() => undefined);
      }
      return { response, body };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async waitForOrigin(origin: string): Promise<void> {
    const previous = this.originTail.get(origin) ?? Promise.resolve();
    let release!: () => void;
    const slot = new Promise<void>((resolve) => { release = resolve; });
    this.originTail.set(origin, previous.then(() => slot));
    await previous;
    const last = this.lastRequestAt.get(origin) ?? 0;
    const minimumDelay = Math.max(this.rateLimitMs, this.originDelayMs.get(origin) ?? 0);
    const delay = Math.max(0, last + minimumDelay - Date.now());
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    this.lastRequestAt.set(origin, Date.now());
    release();
  }

  private errorResult(
    requestedUrl: string,
    finalUrl: string,
    outcome: LinkOutcome,
    error: string,
    redirectChain: string[] = [requestedUrl],
    checkedAt = new Date().toISOString(),
  ): FetchResult {
    return {
      requestedUrl,
      finalUrl,
      statusCode: null,
      redirectChain,
      body: "",
      contentType: null,
      outcome,
      error,
      checkedAt,
    };
  }
}
