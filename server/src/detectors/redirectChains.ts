import {
  Detector,
  DetectorContext,
  ProposedIssue,
} from '../../../shared/types.js';

export class RedirectChainsDetector implements Detector {
  public name = 'redirect_chains';

  public detect(context: DetectorContext): ProposedIssue[] {
    const issues: ProposedIssue[] = [];
    const { page, links } = context;

    for (const link of links) {
      const chain = link.redirect_chain || [];
      const hopCount = chain.length;

      // TC2: Flag redirect chains of 3 or more hops
      if (hopCount >= 3) {
        const finalHop = chain[chain.length - 1];
        const finalDestination = finalHop.location || finalHop.url;

        issues.push({
          type: 'redirect_chain',
          severity: hopCount >= 4 ? 'high' : 'medium',
          source_page_id: page.id,
          source_page_url: page.url,
          bad_url: link.target_url,
          title: `Excessive Redirect Chain (${hopCount} hops) found on ${page.url}`,
          description: `The link to ${link.target_url} on ${page.url} triggers a redirect chain of ${hopCount} hops before reaching ${finalDestination}. This degrades page load performance and wastes crawl budget.`,
          suggested_fix: `Update the link on ${page.url} to point directly to the final destination (${finalDestination}) to bypass the intermediate redirect hops.`,
          evidence: [
            {
              kind: 'redirect_chain_hops',
              payload: {
                source_page: page.url,
                initial_target: link.target_url,
                hop_count: hopCount,
                hops: chain,
                final_destination: finalDestination,
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
