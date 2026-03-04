// ─── Guardrail Operators & Fields ─────────────────────────────────────────────
export type GuardrailOperator =
  | "is_set" // value: null — field must be present
  | "not_empty" // value: null — field must be non-empty
  | "all_within" // value: object e.g. {"country":"IN"} — all items within boundary
  | "gte" // value: number — field >= value
  | "lte" // value: number — field <= value
  | "equals"; // value: string — field exactly equals value

export type GuardrailField =
  | "geo_targets"
  | "budget"
  | "buy_type"
  | "start_date"
  | "end_date"
  | "frequency_cap"
  | "targeting";

// ─── Check Definition ────────────────────────────────────────────────────────
export interface GuardrailCheck {
  scope: "campaign";
  field: GuardrailField;
  operator: GuardrailOperator;
  value: unknown;
}

// ─── Persisted Rule ──────────────────────────────────────────────────────────
export interface GuardrailRule {
  id: string;
  companyId: string;
  description: string;
  check?: GuardrailCheck; // optional — LLM-based validation uses only description
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── API Request/Response Types ──────────────────────────────────────────────
export interface CreateGuardrailRequest {
  description: string;
  check?: GuardrailCheck; // optional
}

export interface UpdateGuardrailRequest {
  description?: string;
  check?: GuardrailCheck;
  active?: boolean;
}

export interface ListGuardrailsResponse {
  guardrails: GuardrailRule[];
}

export interface GenerateGuardrailsRequest {
  prompt: string;
}

// ─── LLM-Generated Rule (before saving) ─────────────────────────────────────
export interface GeneratedRule {
  description: string;
  check?: GuardrailCheck; // optional — generator may still produce structured checks
}

// ─── Guardrail Validation Result (V4) ────────────────────────────────────────

export interface GuardrailViolation {
  ruleId: string;
  ruleDescription: string;
  field: string;     // LLM may return free-form field names
  expected: unknown;
  actual: unknown;
  message: string;
}

export interface CampaignGuardrailResult {
  campaignGroupId: string;
  campaignName: string;
  violations: GuardrailViolation[];
  status: 'pass' | 'fail';
}

export interface GuardrailValidationResult {
  totalRules: number;
  totalCampaigns: number;
  results: CampaignGuardrailResult[];
  hasViolations: boolean;
}

// ─── Override Types (V4) ─────────────────────────────────────────────────────

export interface OverrideRequest {
  campaignGroupId: string;
  ruleId: string;
  reason: string;
}

export interface OverrideRecord {
  id: string;
  uploadId: string;
  campaignGroupId: string;
  ruleId: string;
  ruleDescription: string;
  violationMessage: string;
  reason: string;
  overriddenByUserId: string;
  overriddenByEmail: string;
  createdAt: string;
}

// ─── SSE Events for Generation Stream ────────────────────────────────────────
export type GuardrailGenerationEventType =
  | "generating"
  | "rule"
  | "complete"
  | "error";

export interface GuardrailGenerationEvent {
  type: GuardrailGenerationEventType;
  message: string;
  data?: {
    rule?: GeneratedRule;
    rules?: GeneratedRule[];
    error?: string;
  };
}
