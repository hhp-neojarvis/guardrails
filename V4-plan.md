# V4: Validation + Preview + Override

**Slice:** V4 — Validation + Preview + Override
**Parts:** A4 + A5 + A8
**Demo:** Upload media plan, pipeline processes in background, guardrail violations pause the job, user reviews on job detail page, overrides per-rule per-campaign with audit logging
**Stack:** React + Vite, Hono (Node), Neon Postgres, Drizzle ORM — full TypeScript

---

## Design Decisions

- **Job-based execution model:** Upload triggers pipeline that persists state to DB at each stage. SSE streams real-time progress, but user can navigate away and return to a jobs page to check status.
- **Stream with escape:** Keep current SSE streaming UX but persist all state to DB. User can watch live OR leave and come back.
- **Pause on violations:** After guardrail validation, if any violations exist, upload enters `awaiting_review` status. Pipeline does NOT proceed to Meta draft creation until user reviews and overrides/acknowledges all violations.
- **Override granularity:** Per-rule per-campaign. User acknowledges each violation individually.
- **Actions on job page:** Override guardrail warnings or re-upload a corrected file. No inline editing of campaign data.
- **Guardrail validator is deterministic:** No LLM at validation time. Structured rules executed programmatically against campaign configs.
- **New pipeline stage:** `guardrail_check` runs AFTER `configuring`, BEFORE `complete`. If violations found → status becomes `awaiting_review`.

---

## Upload Status Flow

```
processing → completed        (no violations)
processing → awaiting_review  (violations found, needs user action)
processing → error            (pipeline failure)
awaiting_review → completed   (all violations overridden)
```

---

## Steps

### Step 1: Shared Types — Validation & Override Contracts

**File: `packages/shared/src/contracts/guardrail.ts`** — ADD to existing file:

```typescript
// ─── Guardrail Validation Result (V4) ────────────────────────────────────────

export interface GuardrailViolation {
  ruleId: string;
  ruleDescription: string;
  field: GuardrailField;
  operator: GuardrailOperator;
  expected: unknown;       // the rule's value
  actual: unknown;         // the campaign's actual value
  message: string;         // human-readable explanation
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
```

**File: `packages/shared/src/contracts/campaign.ts`** — ADD new pipeline events:

```typescript
// Add to PipelineEventType union:
  | 'guardrail_checking'
  | 'guardrail_checked'
  | 'awaiting_review'

// Add to PipelineEvent.data:
  guardrailResults?: GuardrailValidationResult;
```

**Agent:** Senior Engineer
**Branch:** `v4/step-1-validation-contracts`
**Done when:** Types compile, exported from `@guardrails/shared`. `pnpm typecheck` passes.

---

### Step 2: Database Schema — Override Audit Log + Upload Status Updates

**File: `packages/db/src/schema.ts`** — ADD:

```typescript
// ─── V4: Guardrail Overrides (Audit Log) ────────────────────────────────────

export const guardrailOverrides = pgTable("guardrail_overrides", {
  id: uuid("id").primaryKey().defaultRandom(),
  uploadId: uuid("upload_id")
    .notNull()
    .references(() => excelUploads.id),
  campaignGroupId: uuid("campaign_group_id")
    .notNull()
    .references(() => campaignGroups.id),
  ruleId: uuid("rule_id")
    .notNull()
    .references(() => guardrails.id),
  ruleDescription: text("rule_description").notNull(),
  violationMessage: text("violation_message").notNull(),
  reason: text("reason").notNull(),
  overriddenByUserId: text("overridden_by_user_id").notNull(),
  overriddenByEmail: text("overridden_by_email").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
```

**File: `packages/db/src/schema.ts`** — ADD to `excelUploads` table:

```typescript
  guardrailResults: jsonb("guardrail_results"),  // stores GuardrailValidationResult
```

Note: The existing `status` column already supports text values. We'll use the new `awaiting_review` status value.

**File: `packages/db/src/index.ts`** — ADD `guardrailOverrides` to named exports.

**Migration:** Run `cd packages/db && pnpm db:generate` → produces migration SQL.

**Agent:** Senior Engineer
**Branch:** `v4/step-2-override-db-schema`
**Done when:** Migration creates `guardrail_overrides` table and adds `guardrail_results` column to `excel_uploads`. `pnpm typecheck` passes.

---

### Step 3: Guardrail Validator Service

**File: `apps/api/src/services/guardrail-validator.ts`** (NEW)

Deterministic validator that executes guardrail rules against campaign group configs.

```typescript
import type {
  GuardrailRule,
  CampaignGroup,
  GuardrailViolation,
  CampaignGuardrailResult,
  GuardrailValidationResult,
  GuardrailCheck,
} from "@guardrails/shared";

/**
 * Validate campaign groups against active guardrail rules.
 * Pure deterministic logic — no LLM.
 */
export function validateGuardrails(
  groups: CampaignGroup[],
  rules: GuardrailRule[],
): GuardrailValidationResult;
```

**Field mapping** (GuardrailField → CampaignGroup property):

| GuardrailField | Source | How to extract |
|----------------|--------|----------------|
| `geo_targets` | `group.resolvedGeoTargets` | Array of resolved geo targets with `countryCode` |
| `budget` | `group.lineItems[].budget` | Parse as number from each line item |
| `buy_type` | `group.campaignBuyType?.buyingType` | String value |
| `start_date` | `group.lineItems[].startDate` | Date string from line items |
| `end_date` | `group.lineItems[].endDate` | Date string from line items |
| `frequency_cap` | `group.frequencyCap` | Number or undefined |
| `targeting` | `group.lineItemConfigs[].targeting` | TargetingConfig objects |

**Operator logic:**

| Operator | Logic |
|----------|-------|
| `is_set` | Field exists and is not null/undefined |
| `not_empty` | Field exists and has length > 0 (arrays) or is truthy |
| `all_within` | For geo_targets: all resolved targets have `countryCode` matching `value.country` |
| `gte` | Numeric field >= value |
| `lte` | Numeric field <= value |
| `equals` | Field exactly equals value (string comparison) |

**Violation message format:** Human-readable, e.g.:
- "Geo target 'Mumbai' has country code 'IN' but rule requires 'US'"
- "Budget is not set for this campaign"
- "Frequency cap is not set"

**File: `apps/api/src/services/guardrail-validator.test.ts`** (NEW)

Test cases per operator:
- `is_set` on `budget` — pass when set, fail when missing
- `not_empty` on `geo_targets` — pass when resolved targets exist, fail when empty
- `all_within` on `geo_targets` with `{"country":"IN"}` — pass when all IN, fail when mixed
- `gte` on `budget` — pass when budget >= value, fail when below
- `lte` on `budget` — pass when budget <= value, fail when above
- `equals` on `buy_type` — pass when matches, fail when different
- Multiple rules against one campaign — returns all violations
- Multiple campaigns — validates each independently
- Inactive rules skipped (filtered before calling validator)
- Unsupported campaign groups skipped

**Agent:** Backend
**Branch:** `v4/step-3-guardrail-validator`
**Done when:** All unit tests pass. `pnpm typecheck` passes.

---

### Step 4: Upload Pipeline — Add Guardrail Validation Stage

**File: `apps/api/src/routes/uploads.ts`** — MODIFY existing upload pipeline

Add guardrail validation stage AFTER `configured` and BEFORE saving to DB:

```
Existing: parse → validate → group → interpret → resolve → configure → save → complete
New:      parse → validate → group → interpret → resolve → configure → GUARDRAIL CHECK → save → complete/awaiting_review
```

Changes:
1. After `configured` stage, fetch active guardrails for the company: `SELECT * FROM guardrails WHERE company_id = ? AND active = true`
2. If no active guardrails, skip validation stage, proceed to save + complete
3. If active guardrails exist:
   a. Emit `guardrail_checking` SSE event
   b. Call `validateGuardrails(supportedGroups, activeRules)`
   c. Emit `guardrail_checked` SSE event with results
   d. Save guardrail results to `excel_uploads.guardrail_results`
   e. If violations found: set upload status to `awaiting_review`, emit `awaiting_review` event, stop pipeline
   f. If no violations: proceed to save + complete as before

4. Save campaign groups to DB (moved after guardrail check, so groups get IDs before validation results reference them)

**File: `apps/api/src/routes/uploads.ts`** — ADD new endpoints:

| Method | Path | Description |
|--------|------|-------------|
| `GET /uploads` | List all uploads for company | Returns list with status, fileName, createdAt, totalRows, guardrail summary |
| `POST /uploads/:id/override` | Override a specific violation | Body: `OverrideRequest`, creates audit log entry |
| `POST /uploads/:id/approve` | Approve upload after all violations handled | Transitions `awaiting_review` → `completed` |

**Override flow:**
1. Validate upload belongs to company, status is `awaiting_review`
2. Validate campaignGroupId and ruleId reference real violations in guardrailResults
3. Create `guardrail_overrides` record with user info, reason, violation details
4. Return updated override count

**Approve flow:**
1. Validate all violations have corresponding overrides
2. Transition upload status to `completed`
3. Return success

**File: `apps/api/src/routes/uploads.test.ts`** — ADD tests for new endpoints and modified pipeline

Test cases:
- Pipeline with no active guardrails → completes normally
- Pipeline with guardrails, no violations → completes normally
- Pipeline with guardrails, violations found → status `awaiting_review`
- `GET /uploads` — returns list scoped to company
- `POST /uploads/:id/override` — creates override record, 400 for invalid rule/campaign
- `POST /uploads/:id/approve` — transitions status, 400 if violations not all overridden
- `POST /uploads/:id/approve` — 404 for wrong company

**Agent:** Backend
**Branch:** `v4/step-4-upload-guardrail-pipeline`
**Done when:** All tests pass. Pipeline correctly pauses on violations. Override and approve endpoints work. `pnpm typecheck` and `pnpm lint` pass.

---

### Step 5: Frontend — Jobs List Page

**File: `apps/web/src/pages/JobsPage.tsx`** (NEW)

Lists all uploads/jobs for the company.

| Column | Source |
|--------|--------|
| File Name | `upload.fileName` |
| Status | `upload.status` — badge with color (processing=blue, awaiting_review=amber, completed=green, error=red) |
| Rows | `upload.totalRows` |
| Violations | Count from guardrailResults (if any) |
| Created | `upload.createdAt` — relative time |
| Action | "View" link → navigates to `/jobs/:id` |

- Fetch `GET /api/uploads` on mount
- Poll every 10 seconds for status updates (for `processing` jobs)
- Empty state: "No uploads yet" + link to upload page
- Click row → navigate to `/jobs/:id`

**File: `apps/web/src/App.tsx`** — ADD route: `/jobs` → `<JobsPage />`

**File: `apps/web/src/components/Layout.tsx`** — ADD "Jobs" nav link in sidebar (visible to all roles)

**Agent:** Frontend (must use `frontend-design-system` skill)
**Branch:** `v4/step-5-jobs-list-page`
**Done when:** Page renders at `/jobs`. Shows uploads list with correct statuses. Nav link visible. `pnpm typecheck` passes.

---

### Step 6: Frontend — Job Detail Page with Guardrail Results & Override

**File: `apps/web/src/pages/JobDetailPage.tsx`** (NEW)

Displays a single upload/job with full campaign preview and guardrail results.

**Sections:**

1. **Header:** File name, status badge, created date, "Back to Jobs" link

2. **Summary bar** (same as current UploadPage complete state): Rows, Campaigns, Geo Targets, Violations count

3. **Guardrail Results** (only shown when guardrailResults exist):
   - Per-campaign accordion/card:
     - Campaign name + status (pass/fail badge)
     - If fail: list of violations with rule description, field, expected vs actual, human-readable message
     - Each violation has an "Override" button → opens reason input → submits `POST /api/uploads/:id/override`
     - Already-overridden violations show with "Overridden" badge + reason

4. **Campaign Preview Cards** (existing design from UploadPage `complete` state — reuse/refactor into shared component):
   - Campaign groups with geo targets, line items table, configs

5. **Actions bar:**
   - If `awaiting_review` with unresolved violations: "Override" buttons per violation
   - If `awaiting_review` with all overridden: "Approve & Complete" button → `POST /api/uploads/:id/approve`
   - If `completed`: "Upload Another" link
   - "Re-upload" link → navigates to upload page

**File: `apps/web/src/App.tsx`** — ADD route: `/jobs/:id` → `<JobDetailPage />`

**Polling:** If status is `processing`, poll `GET /api/uploads/:id` every 3 seconds until status changes.

**Agent:** Frontend (must use `frontend-design-system` skill)
**Branch:** `v4/step-6-job-detail-page`
**Done when:** Page renders at `/jobs/:id`. Shows campaign preview with guardrail results. Override flow works: enter reason → submit → violation marked as overridden. Approve button transitions to completed. `pnpm typecheck` passes.

---

### Step 7: Frontend — Update Upload Page Flow

**File: `apps/web/src/pages/UploadPage.tsx`** — MODIFY

Changes to support job-based model:
1. After upload SSE stream completes (or enters `awaiting_review`), show a link/button: "View Job Details" → navigates to `/jobs/:uploadId`
2. Keep real-time SSE streaming during upload (user can watch progress)
3. Remove the inline campaign preview from UploadPage complete state (it's now on JobDetailPage)
4. On complete/awaiting_review: show status message + "View Job" CTA + "Upload Another" button

**Agent:** Frontend
**Branch:** `v4/step-7-update-upload-page`
**Done when:** Upload page streams progress, then redirects to job detail. No more inline campaign preview on upload page. `pnpm typecheck` passes.

---

## Step Dependencies

```
Step 1: Shared contracts              ← V3 complete (main branch)
Step 2: DB schema + migration         ← Step 1
Step 3: Guardrail validator service   ← Step 1
Step 4: Upload pipeline changes       ← Steps 2, 3
Step 5: Jobs list page                ← Step 4 (needs GET /uploads endpoint)
Step 6: Job detail + override UI      ← Steps 4, 5
Step 7: Update upload page            ← Step 6
```

### Parallelization Opportunities

| Parallel Group | Steps | Why |
|----------------|-------|-----|
| **Group A** | Steps 2 + 3 | DB schema and validator service are independent (both only need Step 1 types) |
| **Group B** | Steps 5 skeleton + 6 skeleton | Page structures can start once Step 4 API is defined |

---

## File Change List

| File | Action |
|------|--------|
| `packages/shared/src/contracts/guardrail.ts` | Edit — add validation & override types |
| `packages/shared/src/contracts/campaign.ts` | Edit — add new pipeline event types |
| `packages/db/src/schema.ts` | Edit — add `guardrailOverrides` table + `guardrailResults` column on `excelUploads` |
| `packages/db/src/index.ts` | Edit — add `guardrailOverrides` export |
| `packages/db/drizzle/0008_*.sql` | **NEW** — auto-generated migration |
| `apps/api/src/services/guardrail-validator.ts` | **NEW** — deterministic validator |
| `apps/api/src/services/guardrail-validator.test.ts` | **NEW** — unit tests |
| `apps/api/src/routes/uploads.ts` | Edit — add guardrail stage to pipeline + new endpoints |
| `apps/api/src/routes/uploads.test.ts` | Edit — add tests for new behavior |
| `apps/web/src/pages/JobsPage.tsx` | **NEW** — jobs list page |
| `apps/web/src/pages/JobDetailPage.tsx` | **NEW** — job detail with guardrail results + override |
| `apps/web/src/pages/UploadPage.tsx` | Edit — redirect to job detail on complete |
| `apps/web/src/App.tsx` | Edit — add routes for `/jobs` and `/jobs/:id` |
| `apps/web/src/components/Layout.tsx` | Edit — add "Jobs" nav link |

---

## Verification

1. `pnpm vitest run apps/api/src/services/guardrail-validator.test.ts` — all tests pass
2. `pnpm vitest run apps/api/src/routes/uploads.test.ts` — all tests pass
3. `pnpm typecheck` — no new errors
4. Upload with no active guardrails → completes normally, visible on jobs page
5. Upload with active guardrails, all pass → completes normally
6. Upload with violations → status `awaiting_review`, visible on jobs page with amber badge
7. Navigate to job detail → see violations listed with override buttons
8. Override a violation (enter reason) → violation shows as overridden
9. Override all violations → "Approve" button appears → click → status becomes `completed`
10. Upload page → SSE streams progress → on complete shows "View Job" link
11. Navigate away during upload → come back to jobs page → see job status

---

## Security Considerations

1. **Company scoping:** All upload/override queries filter by `companyId` — no cross-tenant access
2. **Auth required:** All endpoints behind `authMiddleware`
3. **Override audit trail:** Every override records userId, email, reason, timestamp — non-deletable
4. **Status transitions validated:** Only `awaiting_review` → `completed` via approve. No skipping.
5. **Violation verification:** Override endpoint validates the violation actually exists in guardrailResults

## Out of Scope for V4

- Inline editing of campaign fields (budget, targeting, etc.)
- Re-running validation without re-uploading
- Email/Slack notifications when job completes
- Guardrail rule priority/ordering
- Batch override (override all violations at once)
- Meta draft creation (that's V5)
