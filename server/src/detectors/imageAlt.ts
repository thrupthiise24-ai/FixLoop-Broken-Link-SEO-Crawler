import {
  Detector,
  DetectorContext,
  ProposedIssue,
} from '../../../shared/types.js';

export class ImageAltDetector implements Detector {
  public name = 'image_alt';

  public detect(context: DetectorContext): ProposedIssue[] {
    const issues: ProposedIssue[] = [];
    const { page, parseResult } = context;

    if (!parseResult || !parseResult.images) {
      return issues;
    }

    const missingAltImages = parseResult.images.filter((img) => !img.hasAlt);

    if (missingAltImages.length > 0) {
      const sampleSrcs = missingAltImages.slice(0, 3).map((img) => img.src);
      const isMultiple = missingAltImages.length > 1;

      issues.push({
        type: 'missing_alt',
        severity: 'medium',
        source_page_id: page.id,
        source_page_url: page.url,
        bad_url: missingAltImages[0].src,
        title: `${missingAltImages.length} Image${isMultiple ? 's' : ''} Missing Alt Text on ${page.url}`,
        description: `Found ${missingAltImages.length} image(s) on ${page.url} without an alt attribute (${sampleSrcs.join(', ')}${missingAltImages.length > 3 ? '...' : ''}). Missing alt text harms web accessibility (WCAG) and image SEO.`,
        suggested_fix: `Add a meaningful alt="..." attribute to each image describing its visual content or function, or use alt="" if the image is purely decorative.`,
        evidence: [
          {
            kind: 'missing_alt_evidence',
            payload: {
              page_url: page.url,
              missing_count: missingAltImages.length,
              images: missingAltImages.map((img) => ({ src: img.src })),
              checked_at: new Date().toISOString(),
            },
          },
        ],
      });
    }

    return issues;
  }
}
