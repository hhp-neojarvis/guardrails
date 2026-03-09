---
shaping: true
---

# V7 Slice Plan: Fetch → Match → Validate

**Slice:** V7 — Fetch → Match → Validate
**Parts:** A10
**Demo:** User uploads a media plan, fetches live campaigns from Meta, matches them to the plan, validates plan vs. live fields + guardrails, and flags issues for review
**Stack:** React + Vite, Hono (Node), Neon Postgres, Drizzle ORM, Meta Marketing API (Graph API v21.0) — full TypeScript
**Context:** This slice replaces V5 (Draft Creation) and V6 (Publish). The app no longer creates campaigns in Meta. Instead, users create campaigns in Meta Ads Manager manually, and our tool fetches them, matches them to the Excel plan, and validates them.

---

## Steps

### Step 1: Shared types + API contracts *(ALREADY DONE)*

> **Branch `v7/step-1-shared-types` is merged.** All types below are already in the codebase at `packages/shared/src/contracts/validation.ts` and exported from `@guardrails/shared`.

New file `packages/shared/src/contracts/validation.ts`:

```typescript
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

/** Request to confirm matches */
export interface ConfirmMatchesRequest {
  matches: Array<{
    campaignGroupId: string;
    metaCampaignId: string;
    confidence: number;
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
}

/** Full validation report for an upload */
export interface ValidationReport {
  id: string;
  uploadId: string;
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
}

export interface ConfirmMatchesResponse {
  matches: CampaignMatch[];
}

export interface ListFlagsResponse {
  flags: ValidationFlag[];
}
```

Also updated `packages/shared/src/contracts/campaign.ts`: the `UploadPreviewResponse` now includes `"validating" | "validated"` in its status union.

All types exported from `packages/shared/src/index.ts`.

**Agent:** Senior Engineer
**Branch:** `v7/step-1-shared-types`
**Done when:** All types compile, are exported from `@guardrails/shared`, and can be imported in both `apps/api` and `apps/web`. `pnpm typecheck` passes.

---

### Step 2: Meta Campaign Fetcher service

Create `apps/api/src/services/meta-campaign-fetcher.ts`:

```typescript
/**
 * Fetches live campaigns from a Meta Ad Account using the Graph API
 * with field expansion to minimize HTTP calls.
 *
 * @param adAccountId - e.g. "act_123456789"
 * @param accessToken - decrypted long-lived access token
 * @returns Array of campaign snapshots with nested ad sets and ads
 */
export async function fetchMetaCampaigns(
  adAccountId: string,
  accessToken: string
): Promise<MetaCampaignSnapshot[]>
```

**Implementation:**

- Single Graph API call with nested field expansion:
  ```
  GET https://graph.facebook.com/v21.0/{adAccountId}/campaigns
    ?fields=id,name,status,objective,buying_type,
            adsets{id,name,status,start_time,end_time,daily_budget,lifetime_budget,
                   billing_event,targeting,frequency_control_specs,
                   ads{id,name,status,creative{image_hash,video_id,object_story_spec}}}
    &filtering=[{"field":"effective_status","operator":"IN","value":["ACTIVE","PAUSED"]}]
    &limit=100
    &access_token={accessToken}
  ```
- Handles cursor-based pagination: follow `paging.next` until exhausted
- Maps Meta's snake_case response to the `MetaCampaignSnapshot` camelCase contract
- Filters to only `ACTIVE` and `PAUSED` campaigns (via `effective_status` filter param)

**Error handling:**
- Token expired/revoked → throw typed `MetaAuthError`
- Rate limiting (HTTP 429) → throw typed `MetaRateLimitError` with retry hint
- Empty account → return `[]` (not an error)

**Agent:** Backend
**Branch:** `v7/step-2-meta-fetcher`
**Done when:** Unit tests pass with mocked Meta Graph API responses. Tests cover: single page of results, multi-page pagination, empty account, auth error handling, rate limit retry.

---

### Step 3: Database schema + migrations

Add new tables to `packages/db/src/schema.ts`:

**`public.meta_campaign_snapshots`**

| Column | Type | Notes |
|--------|------|-------|
| id | uuid, PK | default `gen_random_uuid()` |
| upload_id | uuid, NOT NULL | FK → uploads.id |
| company_id | uuid, NOT NULL | FK → companies.id — tenant scoping |
| meta_campaign_id | text, NOT NULL | Meta's campaign ID |
| data | jsonb, NOT NULL | Full `MetaCampaignSnapshot` JSON |
| fetched_at | timestamptz, NOT NULL | default `now()` |

**Unique constraint:** `(upload_id, meta_campaign_id)` — one snapshot per campaign per upload.

**`public.campaign_matches`**

| Column | Type | Notes |
|--------|------|-------|
| id | uuid, PK | default `gen_random_uuid()` |
| upload_id | uuid, NOT NULL | FK → uploads.id |
| campaign_group_id | uuid, NOT NULL | FK → campaign_groups.id |
| meta_campaign_id | text, NOT NULL | Meta's campaign ID |
| confidence | real, NOT NULL | Match confidence score (0–1) |
| confirmed_by_user_id | text, NOT NULL | User who confirmed the match |
| created_at | timestamptz, NOT NULL | default `now()` |

**Unique constraint:** `(upload_id, campaign_group_id)` — each plan campaign maps to at most one Meta campaign per upload.

**`public.validation_reports`**

| Column | Type | Notes |
|--------|------|-------|
| id | uuid, PK | default `gen_random_uuid()` |
| upload_id | uuid, NOT NULL, UNIQUE | FK → uploads.id — one report per upload |
| company_id | uuid, NOT NULL | FK → companies.id — tenant scoping |
| results | jsonb, NOT NULL | Full `ValidationReport` JSON |
| created_at | timestamptz, NOT NULL | default `now()` |

**`public.validation_flags`**

| Column | Type | Notes |
|--------|------|-------|
| id | uuid, PK | default `gen_random_uuid()` |
| upload_id | uuid, NOT NULL | FK → uploads.id |
| campaign_group_id | uuid, NOT NULL | Plan campaign group |
| meta_campaign_id | text, NOT NULL | Meta campaign ID |
| field | text, NOT NULL | Which field (e.g. `"budget"`, `"geo_targeting"`) |
| severity | text, NOT NULL | `"critical"`, `"warning"`, or `"info"` |
| note | text, NOT NULL | Free-text annotation |
| flagged_by_user_id | text, NOT NULL | User who flagged |
| flagged_by_email | text, NOT NULL | Email of user who flagged |
| flagged_at | timestamptz, NOT NULL | default `now()` |
| resolved | boolean, NOT NULL | default `false` |
| resolved_by_user_id | text, nullable | User who resolved |
| resolved_by_email | text, nullable | Email of resolver |
| resolved_at | timestamptz, nullable | When resolved |
| resolution_note | text, nullable | Optional resolution note |

Generate Drizzle migration via `pnpm db:generate`.

**Agent:** Senior Engineer
**Branch:** `v7/step-3-db-schema`
**Done when:** `pnpm db:migrate` creates all four tables. Tables visible in `pnpm db:studio`. All table exports available from `@guardrails/db`. `pnpm typecheck` passes.

---

### Step 4: Fetch + snapshot routes

Create or extend `apps/api/src/routes/validation.ts`:

**`POST /api/uploads/:id/fetch-campaigns`** (protected — requires `authMiddleware`)
- Validates upload belongs to user's company
- Retrieves the connected Meta Ad Account for the company (from `meta_ad_accounts`, decrypts access token)
- Calls `fetchMetaCampaigns(adAccountId, accessToken)` from Step 2
- Upserts each campaign into `meta_campaign_snapshots` (on conflict `(upload_id, meta_campaign_id)` → update `data` and `fetched_at`)
- Returns `FetchCampaignsResponse`: `{ campaigns: MetaCampaignSnapshot[], count: number }`

**`GET /api/uploads/:id/meta-campaigns`** (protected — requires `authMiddleware`)
- Returns cached snapshots from `meta_campaign_snapshots` for the given upload
- Scoped to `company_id` from auth context
- Returns `FetchCampaignsResponse`: `{ campaigns: MetaCampaignSnapshot[], count: number }`

**Error cases:**
- Upload not found → 404
- No Meta ad account connected → 400 with message
- Token expired → 401 with message directing user to reconnect
- Meta API error → 502 with parsed error

**Agent:** Backend
**Branch:** `v7/step-4-fetch-routes`
**Done when:** Both endpoints work with auth/tenant scoping. POST fetches from Meta and stores snapshots. GET returns stored snapshots. Integration tests cover: successful fetch, empty account, unauthorized upload access. `pnpm typecheck` and `pnpm lint` pass.

---

### Step 5: Campaign Matcher service

Create `apps/api/src/services/campaign-matcher.ts`:

```typescript
/**
 * Generates match suggestions between Excel campaign groups and fetched Meta campaigns.
 * Uses a weighted scoring algorithm based on name similarity, geo overlap, and date overlap.
 *
 * @returns One MatchSuggestion per campaign group, with candidates sorted by score descending
 */
export function generateMatchSuggestions(
  campaignGroups: CampaignGroup[],
  metaCampaigns: MetaCampaignSnapshot[]
): MatchSuggestion[]
```

**Scoring algorithm:**

For each `(planCampaign, metaCampaign)` pair, compute a weighted score:

```
totalScore = (nameScore × 0.40) + (geoScore × 0.35) + (dateScore × 0.25)
```

**1. nameScore — Token Jaccard similarity (weight: 0.40)**
```
tokens(s) = lowercase(s).split(/[\s\-_\/|]+/).filter(t => t.length > 1)
nameScore = |tokens(plan.name) ∩ tokens(meta.name)| / |tokens(plan.name) ∪ tokens(meta.name)|
```

**2. geoScore — Geo key Jaccard similarity (weight: 0.35)**
```
planGeoKeys  = normalize(plan.geos)          // e.g. ["US", "CA"]
metaGeoKeys  = extractGeoKeys(meta.adSets)   // union of all ad set geo_locations countries/regions/cities
geoScore     = |planGeoKeys ∩ metaGeoKeys| / |planGeoKeys ∪ metaGeoKeys|
```
If both geo sets are empty, `geoScore = 1.0`.

**3. dateScore — Date overlap ratio (weight: 0.25)**
```
planRange = [plan.startDate, plan.endDate]
metaRange = [earliest adSet startTime, latest adSet endTime]
overlapDays = max(0, min(planEnd, metaEnd) - max(planStart, metaStart))
unionDays   = max(planEnd, metaEnd) - min(planStart, metaStart)
dateScore   = overlapDays / unionDays
```
If either range is undefined, `dateScore = 0`.

**Thresholds:**
- `score >= 0.6` → auto-suggest as top candidate
- Only include candidates with `score >= 0.2` (avoid noise)
- Candidates sorted descending by score
- If no candidate meets threshold, `candidates` array is empty (user must manually select)

**Agent:** Backend
**Branch:** `v7/step-5-campaign-matcher`
**Done when:** Unit tests pass for: exact name match, partial name match, geo mismatch, date overlap/no overlap, empty inputs, tie-breaking, below-threshold exclusion. `pnpm typecheck` and `pnpm lint` pass.

---

### Step 6: Match routes

Add to `apps/api/src/routes/validation.ts`:

**`GET /api/uploads/:id/match-suggestions`** (protected)
- Loads campaign groups for the upload + cached `meta_campaign_snapshots`
- Calls `generateMatchSuggestions(groups, snapshots)` from Step 5
- Returns `MatchSuggestionsResponse`: `{ suggestions: MatchSuggestion[] }`

**`POST /api/uploads/:id/matches`** (protected)
- Body: `ConfirmMatchesRequest`
- Validates all campaign group IDs belong to this upload
- Validates all Meta campaign IDs exist in snapshots for this upload
- Inserts rows into `campaign_matches` with `confirmed_by_user_id` from auth context
- On conflict `(upload_id, campaign_group_id)` → updates `meta_campaign_id`, `confidence`, `confirmed_by_user_id`
- Returns `ConfirmMatchesResponse`: `{ matches: CampaignMatch[] }`

**`GET /api/uploads/:id/matches`** (protected)
- Returns all confirmed matches from `campaign_matches` for the upload
- Returns `ConfirmMatchesResponse`: `{ matches: CampaignMatch[] }`

**Agent:** Backend
**Branch:** `v7/step-6-match-routes`
**Done when:** Full match flow works end-to-end: fetch suggestions → user confirms → matches stored → matches retrievable. Integration tests cover: suggestion generation, confirm flow, update existing match, company scoping. `pnpm typecheck` and `pnpm lint` pass.

---

### Step 7: Plan vs. Live Validator service

Create `apps/api/src/services/plan-vs-live-validator.ts`:

```typescript
/**
 * Compares a matched plan campaign group against its live Meta campaign.
 * Checks 9 fields and runs guardrail validators against the live data.
 */
export function validateCampaign(
  planCampaign: CampaignGroup,
  metaCampaign: MetaCampaignSnapshot,
  matchConfidence: number
): CampaignValidationResult
```

**Field comparisons (9 fields):**

| # | Field | Plan Source | Meta Source | Comparison Logic |
|---|-------|------------|-------------|------------------|
| 1 | `budget` | `plan.budget` | sum of `adSets[].dailyBudget` or `lifetimeBudget` | Pass if within **5% tolerance**: `\|plan - actual\| / plan <= 0.05` |
| 2 | `start_date` | `plan.startDate` | earliest `adSets[].startTime` | Exact date match (ignoring time component) |
| 3 | `end_date` | `plan.endDate` | latest `adSets[].endTime` | Exact date match (ignoring time component) |
| 4 | `geo_targeting` | `plan.geos[]` | union of `adSets[].targeting.geoLocations` | **Set comparison:** pass if `planGeos ⊆ metaGeos` (all planned geos present) |
| 5 | `age_range` | `plan.ageMin`, `plan.ageMax` | `adSets[].targeting.ageMin`, `ageMax` | Pass if all ad sets cover at least the planned range |
| 6 | `genders` | `plan.genders` | `adSets[].targeting.genders` | Pass if sets match (Meta: `[0]` = all, `[1]` = male, `[2]` = female) |
| 7 | `frequency_cap` | `plan.frequencyCap` | `adSets[].frequencyControlSpecs` | Pass if `maxFrequency` and `intervalDays` match plan |
| 8 | `placements` | `plan.placements` | `adSets[].targeting.publisherPlatforms` + positions | Pass if all planned platforms are present |
| 9 | `objective` | `plan.objective` | `meta.objective` | Case-insensitive exact match |

Each comparison produces a `FieldComparison` with `status`, `expected`, `actual`, and a human-readable `message`.

If a plan field is not defined, the comparison returns `status: "skipped"`.

**Guardrail checks:**
- Runs existing deterministic guardrail validators against the live campaign data
- Runs LLM-based guardrail validators (from the upload's configured guardrails) against the live data
- Each produces a `GuardrailCheckResult`

**Overall status:**
- `"fail"` if any `FieldComparison` or `GuardrailCheckResult` has `status === "fail"`
- `"warning"` if any has `status === "warning"` but none failed
- `"pass"` otherwise

**Agent:** Backend
**Branch:** `v7/step-7-plan-vs-live-validator`
**Done when:** Unit tests pass for all 9 comparison fields: exact match, tolerance edge cases (budget at 4.9% vs 5.1%), subset geos, missing fields (skipped status), objective mismatch. `pnpm typecheck` and `pnpm lint` pass.

---

### Step 8: Validate route

Add to `apps/api/src/routes/validation.ts`:

**`POST /api/uploads/:id/validate`** (protected)
- Loads confirmed `campaign_matches` for the upload
- For each match: loads plan campaign group + meta snapshot, calls `validateCampaign()` from Step 7
- Identifies unmatched plan campaigns (campaign groups with no match in `campaign_matches`)
- Identifies unmatched Meta campaigns (snapshots not referenced by any match)
- Assembles full `ValidationReport` with aggregate counts
- Upserts into `validation_reports` (on conflict `upload_id` → replaces `results` and `created_at`)
- Updates upload status to `"validated"`
- Returns `ValidationReport`

**`GET /api/uploads/:id/validation-report`** (protected)
- Returns stored `ValidationReport` from `validation_reports`
- 404 if no report exists yet
- Returns `ValidationReport`

**Agent:** Backend
**Branch:** `v7/step-8-validate-route`
**Done when:** Validation produces complete report with field comparisons + guardrail results, stored in DB. Re-validation overwrites previous report. GET returns 404 when no report exists. Integration tests cover the full flow. `pnpm typecheck` and `pnpm lint` pass.

---

### Step 9: Flag routes

Add to `apps/api/src/routes/validation.ts`:

**`POST /api/uploads/:id/flags`** (protected)
- Body: `CreateFlagRequest`
- Inserts into `validation_flags` with `flagged_by_user_id` and `flagged_by_email` from auth context
- Returns the created `ValidationFlag`

**`GET /api/uploads/:id/flags`** (protected)
- Returns all flags for the upload, ordered by `flagged_at` descending
- Returns `ListFlagsResponse`: `{ flags: ValidationFlag[] }`

**`PATCH /api/uploads/:id/flags/:flagId`** (protected)
- Body: `ResolveFlagRequest`
- Validates flag belongs to this upload
- Sets `resolved = true`, `resolved_by_user_id`, `resolved_by_email` from auth context, `resolved_at = now()`, and optional `resolution_note`
- Returns the updated `ValidationFlag`

**`DELETE /api/uploads/:id/flags/:flagId`** (protected)
- Only the user who created the flag can delete it (`flagged_by_user_id` must match auth user)
- Deletes the row
- Returns `{ success: true }`

**Agent:** Backend
**Branch:** `v7/step-9-flag-routes`
**Done when:** Full CRUD lifecycle works: create flag, list flags, resolve flag, delete own flag. Integration tests cover: auth scoping, delete-own-only enforcement, resolve sets correct fields, company scoping. `pnpm typecheck` and `pnpm lint` pass.

---

### Step 10: Remove wizard (cleanup)

Delete all V5/V6 wizard code:

**Backend deletions:**
- `apps/api/src/services/meta-predictions.ts`
- `apps/api/src/services/meta-creative.ts`
- `apps/api/src/services/meta-ad.ts`
- `apps/api/src/services/meta-draft-creator.ts`
- `apps/api/src/routes/wizard.ts` (or wizard-related route files)
- Any wizard-related test files for the above services
- Remove wizard route registration from the Hono app entry point

**Frontend deletions:**
- `apps/web/src/pages/CampaignWizardPage.tsx`
- `apps/web/src/components/wizard/` (entire directory — PageSelectionStep, AdSetStep, ReachBudgetPanel, CreativeUploadStep, ReviewStep, ConfirmStep, SummaryStep, etc.)
- Wizard route definitions in `App.tsx`
- Wizard-related hooks or utilities

**Frontend updates:**
- Job detail page: replace "Launch Wizard" button/link with "Validate Campaigns" pointing to `/jobs/:id/validate`
- Remove any wizard-related status checks (e.g. `"drafts_created"` status handling)

**Agent:** Full-stack (Senior Engineer)
**Branch:** `v7/step-10-remove-wizard`
**Done when:** All wizard code removed. `pnpm typecheck` passes with zero errors. `pnpm lint` passes. No dead imports referencing deleted files. "Validate Campaigns" button appears on job detail page.

---

### Step 11: Fetch + Match UI

New page: `apps/web/src/pages/ValidationPage.tsx` at route `/jobs/:id/validate`.

**Three phases rendered as a stepped flow:**

**Phase 1 — Fetch:**
- "Fetch Live Campaigns" button calling `POST /api/uploads/:id/fetch-campaigns`
- Loading spinner with message during fetch
- On success: shows count badge of fetched campaigns, transitions to Phase 2
- If campaigns already fetched (cached): shows list with "Re-fetch" option

**Phase 2 — Match:**
- For each plan campaign group, shows a match suggestion card:
  - Plan campaign name + key details (dates, geos, budget)
  - Suggested Meta campaign(s) with confidence score badge (green >= 0.7, yellow >= 0.4, red < 0.4)
  - Three actions per suggestion: **Accept** (confirm top match), **Change** (dropdown to pick different Meta campaign), **Skip** (no match)
- Unmatched Meta campaigns listed in a separate section
- "Confirm Matches" button calls `POST /api/uploads/:id/matches`

**Phase 3 — Confirm:**
- Summary of confirmed matches (plan name ↔ Meta name, confidence)
- "Run Validation" button calls `POST /api/uploads/:id/validate`
- On success: navigates to `/jobs/:id/report`

Must invoke `frontend-design-system` skill before building.

**Agent:** Frontend
**Branch:** `v7/step-11-fetch-match-ui`
**Done when:** Full fetch + match flow works in browser: fetch campaigns → see suggestions → accept/change/skip → confirm → run validation → navigate to report. Loading, error, and empty states handled. `pnpm typecheck` and `pnpm lint` pass.

---

### Step 12: Validation Report UI

New page: `apps/web/src/pages/ValidationReportPage.tsx` at route `/jobs/:id/report`.

**Layer 1 — Summary table:**
- Rows: matched campaign pairs
- Columns: Campaign Name, Budget, Dates, Geo, Age, Gender, Frequency, Placements, Objective, Guardrails
- Cells: color-coded pass (green check) / fail (red X) / warning (yellow triangle) / skipped (gray dash) icons
- Click any row to expand to Layer 2
- Header stats: total pass / fail / warning counts

**Layer 2 — Detail cards (expandable per campaign):**
- Campaign header: plan name ↔ Meta name, match confidence badge
- Per-field comparison card:
  - Field name, expected value, actual value, status badge, human-readable message
  - Diff highlighting: mismatched values in red, matching in green
- Guardrail results section:
  - Rule description, status, message
- Overall status banner (pass / fail / warning)

**Unmatched sections:**
- "Not Found in Meta" — plan campaigns with no Meta match (warning cards with campaign name)
- "Not in Plan" — Meta campaigns not matched to any plan campaign (info cards with name + ID)

**Actions:**
- "Re-validate" button to re-run `POST /api/uploads/:id/validate`
- On mount: calls `GET /api/uploads/:id/validation-report` (or triggers validation if none exists)

Must invoke `frontend-design-system` skill before building.

**Agent:** Frontend
**Branch:** `v7/step-12-validation-report-ui`
**Done when:** Full report renders correctly with summary table, expandable detail cards, unmatched sections, and header stats. Works with real API data. `pnpm typecheck` and `pnpm lint` pass.

---

### Step 13: Flag + Annotation UI

Add flag functionality to the Validation Report page:

**Flag creation:**
- On each field comparison row, a "Flag" icon button
- Clicking opens an inline form:
  - **Severity** dropdown: Critical / Warning / Info
  - **Note** textarea (required)
  - "Submit Flag" button calls `POST /api/uploads/:id/flags`
- Flag appears immediately inline with the field

**"Flagged for Review" panel:**
- Collapsible panel at the top of the report page when flags exist
- Shows count: "X items flagged for review"
- Lists all open (unresolved) flags grouped by campaign
- Each flag shows: field, severity badge, note, flagged by (email), flagged at (relative time)

**Resolution flow:**
- "Resolve" button on each flag in the panel
- Opens inline form with optional resolution note textarea
- Calls `PATCH /api/uploads/:id/flags/:flagId`
- Resolved flags move to a collapsible "Resolved" section with strikethrough styling

**Delete:**
- "Delete" button shown only on flags created by the current user
- Confirmation dialog before calling `DELETE /api/uploads/:id/flags/:flagId`

Must invoke `frontend-design-system` skill before building.

**Agent:** Frontend
**Branch:** `v7/step-13-flag-annotation-ui`
**Done when:** Full flag lifecycle works in browser: create flag on a field → see it in "Flagged for Review" panel → resolve with note → see in resolved section → delete own flag. `pnpm typecheck` and `pnpm lint` pass.

---

## Step Dependencies (V7)

```
Step 1: Shared contracts (DONE)       ← V6 complete (main branch)
Step 2: Meta Campaign Fetcher         ← Step 1
Step 3: DB schema + migrations        ← Step 1
Step 5: Campaign Matcher              ← Step 1
Step 7: Plan vs. Live Validator       ← Step 1
Step 4: Fetch + snapshot routes       ← Steps 2, 3
Step 6: Match routes                  ← Steps 3, 5
Step 8: Validate route                ← Steps 3, 7
Step 9: Flag routes                   ← Step 3
Step 10: Remove wizard (cleanup)      ← Step 3
Step 11: Fetch + Match UI             ← Steps 4, 6
Step 12: Validation Report UI         ← Step 8
Step 13: Flag + Annotation UI         ← Steps 9, 12
```

## Parallelization Opportunities

| Parallel Group | Steps | Why |
|----------------|-------|-----|
| **Group A** | Steps 2 + 3 + 5 + 7 | All depend only on Step 1 (done). Fetcher service, DB schema, matcher service, and validator service are fully independent. |
| **Group B** | Steps 4 + 6 + 8 + 9 + 10 | Once Group A is done, all route layers and cleanup can proceed in parallel (each depends on Step 3 + its respective service). |
| **Group C** | Steps 11 + 12 | Frontend pages can start in parallel once their backend dependencies are ready. |
| **Group D** | Step 13 | Depends on Steps 9 and 12; must wait for both. |

## Agent Assignment Per Step (V7)

| Step | Senior Engineer | Backend | Frontend | Full-stack | Reviewer |
|------|:-:|:-:|:-:|:-:|:-:|
| 1. Shared contracts (DONE) | done | | | | done |
| 2. Meta Campaign Fetcher | | ✅ | | | ✅ |
| 3. DB schema + migrations | ✅ | | | | ✅ |
| 4. Fetch + snapshot routes | | ✅ | | | ✅ |
| 5. Campaign Matcher | | ✅ | | | ✅ |
| 6. Match routes | | ✅ | | | ✅ |
| 7. Plan vs. Live Validator | | ✅ | | | ✅ |
| 8. Validate route | | ✅ | | | ✅ |
| 9. Flag routes | | ✅ | | | ✅ |
| 10. Remove wizard | | | | ✅ | ✅ |
| 11. Fetch + Match UI | | | ✅ | | ✅ |
| 12. Validation Report UI | | | ✅ | | ✅ |
| 13. Flag + Annotation UI | | | ✅ | | ✅ |

## Security Considerations

1. **Tenant scoping:** All queries filter by `company_id` from the authenticated user's context. A user in Company A cannot fetch, match, validate, or flag Company B's data.
2. **Token decryption only at call time:** Meta access tokens are decrypted only when making API calls in the fetcher service, never stored in plaintext in memory longer than the request lifecycle.
3. **Flag ownership enforcement:** Only the user who created a flag can delete it. Resolution is open to any authenticated user in the company.
4. **No Meta write operations:** This slice is read-only against Meta — it only fetches campaign data. No campaigns are created, modified, or deleted in Meta.
5. **JSONB validation:** The `data` column in `meta_campaign_snapshots` and `results` column in `validation_reports` store typed JSON. Application-level validation ensures the shape matches the TypeScript contracts before storage.

## Out of Scope for V7

- Automatic re-validation on a schedule (webhook or cron)
- Diff view between successive validation reports
- CSV/PDF export of validation reports
- Notification system for flag events (email, Slack)
- Bulk flag operations (resolve all, etc.)
- Historical trend tracking of validation pass/fail rates
- Custom field comparison thresholds (e.g. user-configurable budget tolerance)
- Multi-ad-account support per upload (currently assumes one ad account per company)
