// ─── Excel Row ────────────────────────────────────────────────────────────────
/** Raw row parsed from Excel media plan (fixed schema) */
export interface ExcelRow {
  markets: string;
  channel: string;
  woa: string;
  targeting: string;
  buyType: string;
  asset: string;
  inventory: string;
  totalReach: string;
  avgFrequency: string;
  budget: string;
  startDate: string;
  endDate: string;
  campaignName: string;
}

// ─── Geo Types ────────────────────────────────────────────────────────────────
/** LLM-extracted geo intent from Markets column */
export interface GeoIntent {
  name: string;
  type: 'city' | 'region' | 'country';
  parentRegion?: string;
  countryCode: string;
}

/** Resolved Meta geo target from geo search API */
export interface ResolvedGeoTarget {
  key: string;
  name: string;
  type: string;
  countryCode: string;
  countryName?: string;
  region: string;
  regionId: number;
  supportsRegion: boolean;
  supportsCity: boolean;
}

/** Result of resolving geo intents */
export interface GeoResolutionResult {
  resolved: ResolvedGeoTarget[];
  unresolved: Array<{
    intent: GeoIntent;
    reason: string;
  }>;
}

// ─── Campaign Group ──────────────────────────────────────────────────────────
/** A campaign group = rows sharing the same Markets + Channel */
export interface CampaignGroup {
  id?: string;
  markets: string;
  channel: string;
  campaignName: string;
  lineItems: ExcelRow[];
  geoIntents: GeoIntent[];
  resolvedGeoTargets: ResolvedGeoTarget[];
  unresolvedIntents: Array<{ intent: GeoIntent; reason: string }>;
  status: 'pending' | 'processing' | 'resolved' | 'error';
}

// ─── Pipeline Stages & Thinking ──────────────────────────────────────────────
export type PipelineStage = 'parsing' | 'validating' | 'interpreting' | 'resolving';

export interface ThinkingEntry {
  stage: PipelineStage;
  subject?: string;
  message: string;
  status: 'info' | 'pass' | 'fail' | 'warn';
}

export interface ValidationIssue {
  row?: number;
  field?: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  totalRows: number;
}

// ─── Pipeline SSE Events ─────────────────────────────────────────────────────
export type PipelineEventType =
  | 'parsing'
  | 'parsed'
  | 'validating'
  | 'validated'
  | 'thinking'
  | 'interpreting'
  | 'interpreted'
  | 'resolving'
  | 'resolved'
  | 'complete'
  | 'error';

export interface PipelineEvent {
  type: PipelineEventType;
  message: string;
  data?: {
    totalRows?: number;
    totalGroups?: number;
    groups?: CampaignGroup[];
    currentGroup?: string;
    progress?: number;
    error?: string;
    thinking?: ThinkingEntry;
    validation?: ValidationResult;
  };
}

// ─── Upload Response ─────────────────────────────────────────────────────────
export interface UploadPreviewResponse {
  id: string;
  fileName: string;
  status: 'processing' | 'completed' | 'error';
  totalRows: number;
  groups: CampaignGroup[];
  errorMessage?: string;
  createdAt: string;
}
