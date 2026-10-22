import { load } from "cheerio";
import { isSameOrigin, normalizeUrl } from "./normalizeUrl";

export interface ParsedLink {
  url: string;
  text: string;
  internal: boolean;
  isNavigation: boolean;
}

export interface ParsedPage {
  title: string | null;
  metaDescription: string | null;
  h1Count: number;
  imagesMissingAlt: string[];
  links: ParsedLink[];
}

function cleanText(value: string | undefined): string | null {
  if (value === undefined) return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned || null;
}

export function parseHtml(html: string, pageUrl: string): ParsedPage {
  const $ = load(html);
  const title = cleanText($("title").first().text());
  const metaDescription = cleanText(
    $("meta[name='description' i]").first().attr("content"),
  );
  const links: ParsedLink[] = [];
  const seenLinks = new Set<string>();

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href") ?? "";
    const url = normalizeUrl(href, pageUrl);
    if (!url || seenLinks.has(url)) return;
    seenLinks.add(url);
    links.push({
      url,
      text: cleanText($(element).text()) ?? "",
      internal: isSameOrigin(url, pageUrl),
      isNavigation: $(element).closest("nav, header").length > 0,
    });
  });

  const imagesMissingAlt: string[] = [];
  $("img").each((index, element) => {
    if (Object.prototype.hasOwnProperty.call(element.attribs ?? {}, "alt")) return;
    const src = $(element).attr("src") ?? $(element).attr("data-src") ?? "";
    imagesMissingAlt.push(normalizeUrl(src, pageUrl) ?? `${pageUrl}#image-${index + 1}`);
  });

  return {
    title,
    metaDescription,
    h1Count: $("h1").length,
    imagesMissingAlt,
    links,
  };
}
