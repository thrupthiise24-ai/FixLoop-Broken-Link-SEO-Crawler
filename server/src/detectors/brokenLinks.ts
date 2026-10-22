import {
  Detector,
  DetectorContext,
  ProposedIssue,
} from '../../../shared/types.js';

export class BrokenLinksDetector implements Detector {
  public name = 'broken_links';

  public detect(context: DetectorContext): ProposedIssue[] {
    const issues: ProposedIssue[] = [];
    const { page, links } = context;

    for (const link of links) {
      const statusCode = link.status_code;
      const isBroken =
        statusCode === 404 ||
        (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 600) ||
        Boolean(link.error_message);

      if (isBroken) {
        const is404 = statusCode === 404;
        const severity = is404 ? 'high' : 'medium';
        const errorDesc = statusCode ? `HTTP ${statusCode}` : (link.error_message || 'Network unreachable');

        issues.push({
          type: 'broken_link',
          severity,
          source_page_id: page.id,
          source_page_url: page.url,
          bad_url: link.target_url,
          title: `Broken Link (${errorDesc}) found on ${page.url}`,
          description: `The page ${page.url} contains a link to ${link.target_url} which failed with ${errorDesc}.`,
          suggested_fix: `Update or remove the anchor tag pointing to ${link.target_url} on page ${page.url}. If the target page was moved, add a 301 redirect or update the URL to its new location.`,
          evidence: [
            {
              kind: 'broken_link_details',
              payload: {
                source_page: page.url,
                bad_url: link.target_url,
                status_code: statusCode,
                error_message: link.error_message || null,
                is_internal: link.is_internal,
                checked_at: link.checked_at || new Date().toISOString(),
              },
            },
          ],
        });
      }
    }

    return issues;
  }
}
