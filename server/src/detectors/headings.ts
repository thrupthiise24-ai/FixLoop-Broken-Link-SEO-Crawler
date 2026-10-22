import {
  Detector,
  DetectorContext,
  ProposedIssue,
} from '../../../shared/types.js';

export class HeadingsDetector implements Detector {
  public name = 'headings';

  public detect(context: DetectorContext): ProposedIssue[] {
    const issues: ProposedIssue[] = [];
    const { page, parseResult } = context;

    const h1Tags = parseResult?.h1_tags ?? page.h1_tags ?? [];
    const count = h1Tags.length;

    // 1. Missing H1
    if (count === 0) {
      issues.push({
        type: 'missing_h1',
        severity: 'medium',
        source_page_id: page.id,
        source_page_url: page.url,
        title: `Missing <h1> Heading on ${page.url}`,
        description: `Page ${page.url} has no primary <h1> heading. An <h1> provides semantic structure and signals the main topic of the page to search engines and screen readers.`,
        suggested_fix: `Add a single, clear <h1> tag near the top of the main content on ${page.url}.`,
        evidence: [
          {
            kind: 'heading_evidence',
            payload: {
              page_url: page.url,
              h1_count: 0,
              checked_at: new Date().toISOString(),
            },
          },
        ],
      });
    }

    // 2. Multiple H1 tags
    if (count > 1) {
      issues.push({
        type: 'multiple_h1',
        severity: 'low',
        source_page_id: page.id,
        source_page_url: page.url,
        title: `Multiple <h1> Headings (${count}) on ${page.url}`,
        description: `Page ${page.url} has ${count} separate <h1> tags: "${h1Tags.slice(0, 3).join('", "')}"${count > 3 ? '...' : ''}. Best practice recommends a single <h1> heading per document.`,
        suggested_fix: `Restructure the page so that only the primary title uses <h1>, and demote secondary section headings to <h2> or <h3>.`,
        evidence: [
          {
            kind: 'multiple_headings_evidence',
            payload: {
              page_url: page.url,
              h1_count: count,
              h1_tags: h1Tags,
              checked_at: new Date().toISOString(),
            },
          },
        ],
      });
    }

    return issues;
  }
}
