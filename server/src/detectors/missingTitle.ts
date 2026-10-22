import {
  Detector,
  DetectorContext,
  ProposedIssue,
} from '../../../shared/types.js';

const GENERIC_TITLES = new Set([
  'untitled',
  'home',
  'homepage',
  'page',
  'index',
  'new page',
  'document',
  'default',
  'welcome',
]);

export class MissingTitleDetector implements Detector {
  public name = 'title_checks';

  public detect(context: DetectorContext): ProposedIssue[] {
    const issues: ProposedIssue[] = [];
    const { page, parseResult, allPagesInRun } = context;

    const title = parseResult?.title ?? page.title;

    // 1. Missing or empty title (Must have)
    if (!title || title.trim() === '') {
      issues.push({
        type: 'missing_title',
        severity: 'high',
        source_page_id: page.id,
        source_page_url: page.url,
        title: `Missing Page Title on ${page.url}`,
        description: `Page ${page.url} is missing an HTML <title> tag. Search engines rely on page titles as the primary headline in search results and browser tabs.`,
        suggested_fix: `Add a descriptive, unique <title> tag (between 30 and 60 characters) inside the <head> section of ${page.url}.`,
        evidence: [
          {
            kind: 'missing_title_evidence',
            payload: {
              page_url: page.url,
              detected_title: null,
              checked_at: new Date().toISOString(),
            },
          },
        ],
      });
      return issues; // No need to check length/duplicate if title is missing
    }

    const trimmedTitle = title.trim();

    // 2. Generic title check (Should have)
    if (GENERIC_TITLES.has(trimmedTitle.toLowerCase())) {
      issues.push({
        type: 'missing_title',
        severity: 'medium',
        source_page_id: page.id,
        source_page_url: page.url,
        title: `Generic Page Title ("${trimmedTitle}") on ${page.url}`,
        description: `The page title "${trimmedTitle}" is generic and lacks descriptive keywords about the page content.`,
        suggested_fix: `Replace the generic title with a specific, descriptive title reflecting the page's actual topic and brand name.`,
        evidence: [
          {
            kind: 'generic_title_evidence',
            payload: {
              page_url: page.url,
              title: trimmedTitle,
              checked_at: new Date().toISOString(),
            },
          },
        ],
      });
    }

    // 3. Duplicate title check across run (Should have)
    if (allPagesInRun && allPagesInRun.length > 0) {
      const duplicates = allPagesInRun.filter(
        (p) => p.id !== page.id && p.title && p.title.trim().toLowerCase() === trimmedTitle.toLowerCase()
      );
      if (duplicates.length > 0) {
        issues.push({
          type: 'duplicate_title',
          severity: 'medium',
          source_page_id: page.id,
          source_page_url: page.url,
          title: `Duplicate Page Title ("${trimmedTitle}") on ${page.url}`,
          description: `The title "${trimmedTitle}" is identical to the title on ${duplicates.length} other page(s) (e.g. ${duplicates[0].url}). Every page should have a unique title.`,
          suggested_fix: `Craft a unique <title> for ${page.url} distinguishing its specific purpose or content from other pages on the site.`,
          evidence: [
            {
              kind: 'duplicate_title_evidence',
              payload: {
                page_url: page.url,
                title: trimmedTitle,
                conflicting_urls: duplicates.map((d) => d.url),
                checked_at: new Date().toISOString(),
              },
            },
          ],
        });
      }
    }

    return issues;
  }
}
