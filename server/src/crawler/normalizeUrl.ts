export interface UrlInfo {
  isValid: boolean;
  isCrawlable: boolean;
  normalizedUrl?: string;
  isInternal: boolean;
  reason?: string;
}

const NON_CRAWLABLE_SCHEMES = [
  'mailto:',
  'tel:',
  'javascript:',
  'sms:',
  'data:',
  'ftp:',
  'file:',
  'blob:',
];

/**
 * Normalizes a URL against a base URL and determines if it is internal and crawlable.
 */
export function normalizeUrl(rawUrl: string, baseUrl: string): UrlInfo {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { isValid: false, isCrawlable: false, isInternal: false, reason: 'Empty or non-string URL' };
  }

  const trimmed = rawUrl.trim();

  // Check for non-crawlable schemes
  const lower = trimmed.toLowerCase();
  for (const scheme of NON_CRAWLABLE_SCHEMES) {
    if (lower.startsWith(scheme)) {
      return {
        isValid: true,
        isCrawlable: false,
        isInternal: false,
        reason: `Ignored protocol scheme (${scheme})`,
      };
    }
  }

  // Handle fragment-only URLs like "#top"
  if (trimmed.startsWith('#')) {
    return {
      isValid: true,
      isCrawlable: false,
      isInternal: true,
      reason: 'Fragment-only anchor',
    };
  }

  try {
    const base = new URL(baseUrl);
    const resolved = new URL(trimmed, base);

    // Only support http: and https: protocols
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
      return {
        isValid: false,
        isCrawlable: false,
        isInternal: false,
        reason: `Unsupported protocol: ${resolved.protocol}`,
      };
    }

    // Strip hash fragment because it points to the same document
    resolved.hash = '';

    // Standardize pathname: remove duplicate slashes
    resolved.pathname = resolved.pathname.replace(/\/{2,}/g, '/');

    // Remove trailing slash if not root path (e.g. /about/ -> /about) to avoid duplicate crawls
    if (resolved.pathname.length > 1 && resolved.pathname.endsWith('/')) {
      resolved.pathname = resolved.pathname.slice(0, -1);
    }

    const normalizedUrl = resolved.toString();
    const isInternal = resolved.hostname === base.hostname;

    return {
      isValid: true,
      isCrawlable: true,
      normalizedUrl,
      isInternal,
    };
  } catch (err: any) {
    return {
      isValid: false,
      isCrawlable: false,
      isInternal: false,
      reason: `Malformed URL: ${err.message}`,
    };
  }
}

/**
 * Checks if a target URL is internal relative to a base site URL.
 */
export function isInternalUrl(targetUrl: string, siteUrl: string): boolean {
  try {
    const target = new URL(targetUrl);
    const site = new URL(siteUrl);
    return target.hostname === site.hostname;
  } catch {
    return false;
  }
}
