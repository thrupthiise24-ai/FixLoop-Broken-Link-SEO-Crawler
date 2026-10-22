import {
  Detector,
  DetectorContext,
  ProposedIssue,
} from '../../../shared/types.js';

export class MetaDescriptionDetector implements Detector {
  public name = 'meta_description';

  public detect(context: DetectorContext): ProposedIssue[] {
    const issues: ProposedIssue[] = [];
    const { page, parseResult, allPagesInRun } = context;

    const desc = parseResult?.meta_description ?? page.meta_description;

    // 1. Missing Meta Description
    if (!desc || desc.trim() === '') {
      issues.push({
        type: 'missing_meta_description',
        severity: 'medium',
        source_page_id: page.id,
        source_page_url: page.url,
        title: `Missing Meta Description on ${page.url}`,
        description: `Page ${page.url} lacks a <meta name="description"> tag. Search engines often use this snippet in search listings.`,
        suggested_fix: `Add a concise, compelling meta description (between 120 and 155 characters) summarizing what users will find on ${page.url}.`,
        evidence: [
          {
            kind: 'meta_description_evidence',
            payload: {
              page_url: page.url,
              meta_description: null,
              checked_at: new Date().toISOString(),
            },
          },
        ],
      });
      return issues;
    }

    const trimmedDesc = desc.trim();

    // 2. Duplicate Meta Description
    if (allPagesInRun && allPagesInRun.length > 0) {
      const duplicates = allPagesInRun.filter(
        (p) =>
          p.id !== page.id &&
          p.meta_description &&
          p.meta_description.trim().toLowerCase() === trimmedDesc.toLowerCase()
      );
      if (duplicates.length > 0) {
        issues.push({
          type: 'missing_meta_description',
          severity: 'low',
          source_page_id: page.id,
          source_page_url: page.url,
          title: `Duplicate Meta Description on ${page.url}`,
          description: `The meta description on ${page.url} is identical to ${duplicates.length} other page(s) (e.g. ${duplicates[0].url}).`,
          suggested_fix: `Provide a unique meta description tailored specifically to ${page.url}.`,
          evidence: [
            {
              kind: 'duplicate_meta_description_evidence',
              payload: {
                page_url: page.url,
                meta_description: trimmedDesc,
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
