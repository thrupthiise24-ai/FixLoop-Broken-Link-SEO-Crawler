const NON_HTTP_SCHEMES = /^(?:mailto:|tel:|javascript:|data:|blob:)/i;

/** Resolve an href and remove fragments; return null for non-page schemes. */
export function normalizeUrl(input: string, baseUrl?: string): string | null {
  const value = input.trim();
  if (!value || value.startsWith("#") || NON_HTTP_SCHEMES.test(value)) return null;
  try {
    const url = baseUrl ? new URL(value, baseUrl) : new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    url.hash = "";
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/$/, "");
    return url.toString();
  } catch {
    return null;
  }
}

export function isSameOrigin(left: string, right: string): boolean {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}

export function getPathScope(siteUrl: string): string {
  try {
    const pathname = new URL(siteUrl).pathname.replace(/\/+$/, "");
    return pathname === "" || pathname === "/" ? "/" : pathname;
  } catch {
    return "/";
  }
}

export function isWithinPathScope(url: string, scopePath: string): boolean {
  try {
    if (scopePath === "/") return true;
    const path = new URL(url).pathname;
    return path === scopePath || path.startsWith(`${scopePath}/`);
  } catch {
    return false;
  }
}

export function normalizeSiteUrl(siteUrl: string): string {
  const normalized = normalizeUrl(siteUrl);
  if (!normalized) throw new Error("A valid HTTP or HTTPS site URL is required.");
  return normalized;
}
