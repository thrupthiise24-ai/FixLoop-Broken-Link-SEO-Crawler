import * as cheerio from 'cheerio';
import { PageParseResult } from '../../../shared/types.js';

/**
 * Parses HTML document and extracts links, title, meta tags, headings, and images.
 */
export function parseHtml(html: string, pageUrl: string): PageParseResult {
  const result: PageParseResult = {
    url: pageUrl,
    h1_tags: [],
    links: [],
    images: [],
  };

  if (!html || typeof html !== 'string') {
    return result;
  }

  try {
    const $ = cheerio.load(html);

    // 1. Extract Title
    const title = $('title').first().text().trim();
    if (title) {
      result.title = title;
    }

    // 2. Extract Meta Description
    const metaDescription =
      $('meta[name="description" i]').attr('content') ||
      $('meta[property="og:description" i]').attr('content');
    if (metaDescription) {
      result.meta_description = metaDescription.trim();
    }

    // 3. Extract H1 Headings
    $('h1').each((_, el) => {
      const text = $(el).text().trim();
      if (text) {
        result.h1_tags.push(text);
      }
    });

    // 4. Extract Links
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;

      const text = $(el).text().trim();
      // Check if inside nav, header, or footer navigation
      const isNav =
        $(el).closest('nav').length > 0 ||
        $(el).closest('header').length > 0 ||
        $(el).closest('[role="navigation"]').length > 0 ||
        $(el).hasClass('nav-link') ||
        $(el).parents('.navbar, .navigation, .nav, .menu').length > 0;

      result.links.push({
        href: href.trim(),
        text: text,
        isNav: Boolean(isNav),
      });
    });

    // 5. Extract Images
    $('img').each((_, el) => {
      const src = $(el).attr('src');
      if (!src) return;

      const altAttr = $(el).attr('alt');
      const hasAlt = typeof altAttr === 'string';

      result.images.push({
        src: src.trim(),
        alt: hasAlt ? altAttr.trim() : undefined,
        hasAlt,
      });
    });
  } catch (err: any) {
    // Basic regex fallback if parser encounters an unexpected error
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    if (titleMatch) {
      result.title = titleMatch[1].trim();
    }
  }

  return result;
}
