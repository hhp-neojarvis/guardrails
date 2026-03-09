// ─── Meta Campaign Snapshots ─────────────────────────────────────────────────

/** Point-in-time snapshot of a Meta ad creative */
export interface MetaAdSnapshot {
  metaAdId: string;
  name: string;
  status: string;
  creative?: {
    imageHash?: string;
    videoId?: string;
    objectStorySpec?: Record<string, unknown>;
  };
}

/** Point-in-time snapshot of a Meta ad set */
export interface MetaAdSetSnapshot {
  metaAdSetId: string;
  name: string;
  status: string;
  startTime: string;
  endTime: string;
  dailyBudget?: string;
  lifetimeBudget?: string;
  billingEvent: string;
  targeting: {
    geoLocations: {
      countries?: string[];
      regions?: Array<{ key: string; name: string }>;
      cities?: Array<{ key: string; name: string }>;
    };
    ageMin?: number;
    ageMax?: number;
    genders?: number[];
    publisherPlatforms?: string[];
    facebookPositions?: string[];
    instagramPositions?: string[];
  };
  frequencyControlSpecs?: Array<{
    event: string;
    intervalDays: number;
    maxFrequency: number;
  }>;
  ads: MetaAdSnapshot[];
}

/** Point-in-time snapshot of a Meta campaign hierarchy */
export interface MetaCampaignSnapshot {
  id: string;
  uploadId: string;
  metaCampaignId: string;
  name: string;
  status: "ACTIVE" | "PAUSED";
  objective: string;
  buyingType: string;
  adSets: MetaAdSetSnapshot[];
  fetchedAt: string;
}

// ─── Campaign Strategy ──────────────────────────────────────────────────────

/** How the user organized their Meta campaigns relative to the media plan */
export type CampaignStrategy = "one_per_line_item" | "one_campaign";

/** Request to set the strategy for an upload */
export interface SetStrategyRequest {
  strategy: CampaignStrategy;
}

// ─── Campaign Matching ──────────────────────────────────────────────────────

/** Signals that contributed to a match score */
export interface MatchSignals {
  nameScore: number;
  geoScore: number;
  dateScore: number;
}

/** A candidate match for an Excel campaign group */
export interface MatchCandidate {
  metaCampaignId: string;
  metaCampaignName: string;
  score: number;
  signals: MatchSignals;
}

/** Auto-suggested matches for one Excel campaign group */
export interface MatchSuggestion {
  campaignGroupId: string;
  campaignGroupName: string;
  candidates: MatchCandidate[];
}

/** A confirmed match between an Excel campaign group and a Meta campaign */
export interface CampaignMatch {
  id: string;
  uploadId: string;
  campaignGroupId: string;
  metaCampaignId: string;
  confidence: number;
  confirmedByUserId: string;
  confirmedAt: string;
}

/** A candidate match for a line item to an ad set (1:N strategy) */
export interface AdSetMatchCandidate {
  metaAdSetId: string;
  metaAdSetName: string;
  parentMetaCampaignId: string;
  score: number;
  signals: MatchSignals;
}

/** Auto-suggested matches for one line item within a campaign group (1:N strategy) */
export interface LineItemMatchSuggestion {
  lineItemIndex: number;
  lineItemName: string;
  candidates: AdSetMatchCandidate[];
}

/** Match suggestions for 1:N strategy: one campaign + per-line-item ad set matches */
export interface OneToManyMatchSuggestion {
  campaignGroupId: string;
  campaignGroupName: string;
  /** The single Meta campaign matched for this group */
  metaCampaignCandidates: MatchCandidate[];
  /** Per-line-item ad set match suggestions (populated after campaign is selected) */
  lineItemSuggestions: LineItemMatchSuggestion[];
}

/** Request to confirm matches */
export interface ConfirmMatchesRequest {
  matches: Array<{
    campaignGroupId: string;
    metaCampaignId: string;
    confidence: number;
    /** For 1:N strategy: line item → ad set mappings */
    lineItemMatches?: Array<{
      lineItemIndex: number;
      metaAdSetId: string;
    }>;
  }>;
}

// ─── Validation ─────────────────────────────────────────────────────────────

/** Per-field comparison result (plan vs. live) */
export interface FieldComparison {
  field: string;
  status: "pass" | "fail" | "warning" | "skipped";
  expected: string;
  actual: string;
  message: string;
}

/** Guardrail check result within a validation */
export interface GuardrailCheckResult {
  ruleId: string;
  ruleDescription: string;
  status: "pass" | "fail";
  message: string;
}

/** Validation result for a single line item vs ad set (1:N strategy) */
export interface LineItemValidationResult {
  lineItemIndex: number;
  lineItemName: string;
  metaAdSetId: string;
  metaAdSetName: string;
  fieldComparisons: FieldComparison[];
  overallStatus: "pass" | "fail" | "warning";
  failCount: number;
  warnCount: number;
}

/** Validation result for one matched campaign pair */
export interface CampaignValidationResult {
  campaignGroupId: string;
  campaignGroupName: string;
  metaCampaignId: string;
  metaCampaignName: string;
  matchConfidence: number;
  fieldComparisons: FieldComparison[];
  guardrailResults: GuardrailCheckResult[];
  overallStatus: "pass" | "fail" | "warning";
  failCount: number;
  warnCount: number;
  /** Per-line-item results when using 1:N strategy */
  lineItemResults?: LineItemValidationResult[];
}

/** Full validation report for an upload */
export interface ValidationReport {
  id: string;
  uploadId: string;
  strategy: CampaignStrategy;
  results: CampaignValidationResult[];
  unmatchedPlanCampaigns: Array<{ id: string; name: string }>;
  unmatchedMetaCampaigns: Array<{ id: string; name: string }>;
  totalPass: number;
  totalFail: number;
  totalWarning: number;
  createdAt: string;
}

// ─── Flags & Annotations ────────────────────────────────────────────────────

/** A flag raised on a specific validation issue */
export interface ValidationFlag {
  id: string;
  uploadId: string;
  campaignGroupId: string;
  metaCampaignId: string;
  field: string;
  severity: "critical" | "warning" | "info";
  note: string;
  flaggedByUserId: string;
  flaggedByEmail: string;
  flaggedAt: string;
  resolved: boolean;
  resolvedByUserId?: string;
  resolvedByEmail?: string;
  resolvedAt?: string;
  resolutionNote?: string;
}

export interface CreateFlagRequest {
  campaignGroupId: string;
  metaCampaignId: string;
  field: string;
  severity: "critical" | "warning" | "info";
  note: string;
}

export interface ResolveFlagRequest {
  resolutionNote?: string;
}

// ─── API Responses ──────────────────────────────────────────────────────────

export interface FetchCampaignsResponse {
  campaigns: MetaCampaignSnapshot[];
  count: number;
}

export interface MatchSuggestionsResponse {
  suggestions: MatchSuggestion[];
  /** Present when strategy is one_campaign */
  oneToManySuggestions?: OneToManyMatchSuggestion[];
}

export interface LineItemMatchSuggestionsResponse {
  lineItemSuggestions: LineItemMatchSuggestion[];
}

export interface ConfirmMatchesResponse {
  matches: CampaignMatch[];
}

export interface ListFlagsResponse {
  flags: ValidationFlag[];
}
