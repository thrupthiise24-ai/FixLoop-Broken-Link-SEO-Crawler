export type RunStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface Run {
  id: string;
  site_url: string;
  page_limit: number;
  status: RunStatus;
  started_at: string;
  finished_at?: string | null;
}

export interface Page {
  id: string;
  run_id: string;
  url: string;
  depth: number;
  priority: number;
  priority_reason?: string;
  status_code?: number | null;
  title?: string | null;
  meta_description?: string | null;
  h1_count?: number;
  h1_tags?: string[];
  crawled_at?: string | null;
  crawled: boolean;
  not_crawled_reason?: string | null;
}

export interface RedirectHop {
  url: string;
  status_code: number;
  location?: string | null;
}

export interface Link {
  id: string;
  run_id: string;
  source_page_id: string;
  source_page_url: string;
  target_url: string;
  status_code?: number | null;
  redirect_chain?: RedirectHop[];
  checked_at?: string;
  error_message?: string | null;
  is_internal: boolean;
}

export type IssueType =
  | 'broken_link'
  | 'redirect_chain'
  | 'missing_title'
  | 'duplicate_title'
  | 'missing_meta_description'
  | 'missing_h1'
  | 'multiple_h1'
  | 'missing_alt';

export type IssueSeverity = 'high' | 'medium' | 'low';

export type IssueStatus =
  | 'pending_approval'
  | 'open'
  | 'fixed'
  | 'still_failing'
  | 'rejected'
  | 'uncertain';

export interface EvidenceItem {
  id?: string;
  issue_id?: string;
  kind: string;
  payload: Record<string, any>;
  captured_at: string;
}

export interface Issue {
  id: string;
  run_id: string;
  dedupe_key: string;
  type: IssueType;
  severity: IssueSeverity;
  source_page_id: string;
  source_page_url: string;
  bad_url?: string | null;
  status: IssueStatus;
  title: string;
  description: string;
  suggested_fix: string;
  tracker_url?: string | null;
  tracker_issue_id?: string | null;
  evidence?: EvidenceItem[];
  created_at: string;
  approved_at?: string | null;
  closed_at?: string | null;
}

export interface PageParseResult {
  url: string;
  title?: string;
  meta_description?: string;
  h1_tags: string[];
  links: Array<{
    href: string;
    text: string;
    is_nav: boolean;
  }>;
  images: Array<{
    src: string;
    alt?: string;
    has_alt: boolean;
  }>;
}

export interface FetchResult {
  finalUrl: string;
  statusCode: number;
  redirectChain: RedirectHop[];
  contentType?: string | null;
  bodyText?: string;
  durationMs: number;
  error?: string;
}

export interface DetectorEvidence {
  kind: string;
  payload: Record<string, any>;
}

export interface ProposedIssue {
  type: IssueType;
  severity: IssueSeverity;
  source_page_id: string;
  source_page_url: string;
  bad_url?: string;
  title: string;
  description: string;
  suggested_fix: string;
  evidence: DetectorEvidence[];
}

export interface DetectorContext {
  page: Page;
  parseResult?: PageParseResult;
  links: Link[];
  allPagesInRun?: Page[];
}

export interface Detector {
  name: string;
  detect(context: DetectorContext): ProposedIssue[];
}
