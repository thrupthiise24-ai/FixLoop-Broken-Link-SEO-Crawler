import { Detector, DetectorContext, ProposedIssue } from '../../../shared/types.js';
import { BrokenLinksDetector } from './brokenLinks.js';
import { RedirectChainsDetector } from './redirectChains.js';
import { MissingTitleDetector } from './missingTitle.js';
import { MetaDescriptionDetector } from './metaDescription.js';
import { HeadingsDetector } from './headings.js';
import { ImageAltDetector } from './imageAlt.js';

export {
  BrokenLinksDetector,
  RedirectChainsDetector,
  MissingTitleDetector,
  MetaDescriptionDetector,
  HeadingsDetector,
  ImageAltDetector,
};

export class DetectorRegistry {
  private detectors: Detector[] = [];

  constructor() {
    this.registerDefaultDetectors();
  }

  private registerDefaultDetectors(): void {
    this.detectors.push(
      new BrokenLinksDetector(),
      new RedirectChainsDetector(),
      new MissingTitleDetector(),
      new MetaDescriptionDetector(),
      new HeadingsDetector(),
      new ImageAltDetector()
    );
  }

  public register(detector: Detector): void {
    this.detectors.push(detector);
  }

  public runAll(context: DetectorContext): ProposedIssue[] {
    const allIssues: ProposedIssue[] = [];

    for (const detector of this.detectors) {
      try {
        const issues = detector.detect(context);
        allIssues.push(...issues);
      } catch (err: any) {
        console.error(`Detector ${detector.name} failed during evaluation:`, err);
      }
    }

    return allIssues;
  }
}

export const defaultDetectorRegistry = new DetectorRegistry();

export function runAllDetectors(context: DetectorContext): ProposedIssue[] {
  return defaultDetectorRegistry.runAll(context);
}
