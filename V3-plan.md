# V3: Guardrail Setup

**Slice:** V3 — Guardrail Setup
**Parts:** A3
**Demo:** User describes common mistakes in natural language, LLM generates structured validation rules, user reviews/edits/approves, rules persist at company level
**Stack:** React + Vite, Hono (Node), Neon Postgres, Drizzle ORM, OpenAI API — full TypeScript

---

## Design Decisions

- **Creation UX:** LLM-only — user types natural language, LLM generates structured rules (no manual rule builder in V3)
- **Operators:** Minimal set of 6: `is_set`, `not_empty`, `all_within`, `gte`, `lte`, `equals`
- **Scope:** Campaign-level only (not line-item)
- **Fields:** Core fields only: `geo_targets`, `budget`, `buy_type`, `start_date`, `end_date`, `frequency_cap`, `targeting`
- **Streaming:** SSE stream from API for progressive UX, but LLM call itself is non-streaming (small JSON payload of 3-8 rules)

---

## Steps

### Step 1: Shared Types

**File: `packages/shared/src/contracts/guardrail.ts`** (NEW)

```typescript
// ─── Guardrail Operators & Fields ─────────────────────────────────────────────
export type GuardrailOperator =
  | "is_set"       // value: null — field must be present
  | "not_empty"    // value: null — field must be non-empty
  | "all_within"   // value: object e.g. {"country":"IN"} — all items within boundary
  | "gte"          // value: number — field >= value
  | "lte"          // value: number — field <= value
  | "equals";      // value: string — field exactly equals value

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
  check: GuardrailCheck;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── API Request/Response Types ──────────────────────────────────────────────
export interface CreateGuardrailRequest {
  description: string;
  check: GuardrailCheck;
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
  check: GuardrailCheck;
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
```

**File: `packages/shared/src/index.ts`** — add `export * from './contracts/guardrail';`

**Agent:** Senior Engineer
**Branch:** `v3/step-1-guardrail-contracts`
**Done when:** Types compile, are exported from `@guardrails/shared`, and can be imported in both `apps/api` and `apps/web`. `pnpm typecheck` passes.

---

### Step 2: Database Schema + Migration

**File: `packages/db/src/schema.ts`** — add `guardrails` table:

```typescript
import { boolean } from "drizzle-orm/pg-core"; // add to existing import

// ─── V3: Guardrails ──────────────────────────────────────────────────────────

export const guardrails = pgTable("guardrails", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id),
  description: text("description").notNull(),
  check: jsonb("check").notNull(),          // stores GuardrailCheck object
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});
```

**File: `packages/db/src/index.ts`** — add `guardrails` to the named exports from `"./schema.js"`.

**Migration:** Run `cd packages/db && pnpm db:generate` → produces `drizzle/0007_*.sql`.

**Agent:** Senior Engineer
**Branch:** `v3/step-2-guardrail-db-schema`
**Done when:** Migration creates the `guardrails` table. `guardrails` is importable from `@guardrails/db`. `pnpm typecheck` passes.

---

### Step 3: LLM Guardrail Generator Service

**File: `apps/api/src/services/guardrail-generator.ts`** (NEW)

Follow the `geo-interpreter.ts` pattern exactly:
- Lazy OpenAI singleton using `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` env vars
- System prompt instructs LLM to return `{"rules": [{description, check}]}` JSON
- Documents available fields, operators, and value shapes with examples
- Uses `response_format: { type: "json_object" }` and `temperature: 0`
- Validates each returned rule: correct field enum, operator enum, value shape
- Invalid rules filtered out (logged, not thrown)
- Exports: `generateGuardrailRules(prompt: string): Promise<GeneratedRule[]>`
- Exports: `_setOpenAIClient(client: OpenAI | null): void` for testing

**System prompt should include:**
- The 7 available fields with descriptions
- The 6 available operators with value type rules
- 2-3 example input/output pairs matching the shaping doc examples
- Instruction to generate 3-8 rules
- Instruction to return valid JSON: `{"rules": [...]}`

**File: `apps/api/src/services/guardrail-generator.test.ts`** (NEW)

Mock OpenAI client (using `_setOpenAIClient` pattern). Test cases:
- Valid LLM response → returns `GeneratedRule[]`
- Empty LLM response → throws
- Invalid JSON → throws
- Missing `rules` array → throws
- Malformed rules (wrong field, wrong operator) → filtered out, valid ones returned
- Rules with valid structure → all returned

**Agent:** Backend
**Branch:** `v3/step-3-guardrail-llm-service`
**Done when:** All unit tests pass. Service is importable. `pnpm typecheck` passes.

---

### Step 4: API Routes

**File: `apps/api/src/routes/guardrails.ts`** (NEW)

All routes use `authMiddleware`. All queries scoped to `auth.companyId`.

| Method | Path | Description |
|--------|------|-------------|
| `GET /` | List all guardrails for company | Returns `ListGuardrailsResponse` |
| `POST /` | Create a single guardrail rule | Body: `CreateGuardrailRequest`, returns 201 |
| `POST /batch` | Create multiple rules (post-approval) | Body: `{ rules: CreateGuardrailRequest[] }`, returns 201 |
| `PATCH /:id` | Update rule | Body: `UpdateGuardrailRequest` (partial), returns updated rule |
| `DELETE /:id` | Delete rule | Returns `{ success: true }` |
| `POST /generate` | SSE stream: LLM generates rules | Body: `GenerateGuardrailsRequest` |

**SSE `/generate` flow:**
1. Parse `{ prompt }` from body, validate non-empty
2. Return `streamSSE(c, async (stream) => { ... })`
3. Emit `{ type: "generating", message: "Analyzing your description..." }`
4. Call `generateGuardrailRules(prompt)`
5. For each rule: emit `{ type: "rule", message: rule.description, data: { rule } }`
6. Emit `{ type: "complete", message: "Generated N rules", data: { rules } }`
7. On error: emit `{ type: "error", message: "...", data: { error } }`

**File: `apps/api/src/app.ts`** — add:
```typescript
import { guardrailRoutes } from "./routes/guardrails.js";
app.route("/api/guardrails", guardrailRoutes);
```

**File: `apps/api/src/routes/guardrails.test.ts`** (NEW)

Mock DB and LLM service. Test cases:
- `GET /api/guardrails` — 401 without auth; returns empty array; returns rules after create
- `POST /api/guardrails` — creates rule (201); 400 for missing fields
- `POST /api/guardrails/batch` — creates multiple rules; 400 for empty array
- `PATCH /api/guardrails/:id` — updates description, check, active; 404 for wrong company
- `DELETE /api/guardrails/:id` — deletes rule; 404 for wrong company
- `POST /api/guardrails/generate` — SSE stream with generating/rule/complete events; 400 for empty prompt

**Agent:** Backend
**Branch:** `v3/step-4-guardrail-api-routes`
**Done when:** All tests pass. `pnpm typecheck` and `pnpm lint` pass.

---

### Step 5: Frontend — Guardrails Page

**File: `apps/web/src/pages/GuardrailsPage.tsx`** (NEW)

Three views managed by component state:

#### List View (default)
- Fetch `GET /api/guardrails` on mount (same `useEffect`/`useCallback` pattern as MetaAccountsPage)
- **Empty state:** Message + "Generate Guardrails" CTA button
- **Rule cards:** Each shows description, field/operator/value as badges, active toggle switch, delete button
- Active toggle: `PATCH /api/guardrails/:id` with `{ active: !current }`
- Delete: 2-click confirmation (same pattern as MetaAccountsPage disconnect)
- "Generate New Rules" button at top → switches to generate view

#### Generate View
- Textarea for natural language input
- Placeholder: "Describe common mistakes in your media campaigns..."
- Submit button → POST `/api/guardrails/generate` (SSE stream)
- SSE consumption: same `response.body.getReader()` + `TextDecoder` + line-by-line parsing from UploadPage
- Progressive display: rules appear one by one as `rule` events arrive
- On `complete` → auto-switch to review view
- Cancel button → back to list
- Error handling: display error message from `error` event

#### Review View
- Shows generated rules as editable cards
- Each card: editable description (text input), field/operator/value display (read-only for V3), remove button (X)
- "Save All" button → `POST /api/guardrails/batch` with remaining rules → refresh list → back to list view
- "Discard" button → back to generate view (with confirmation if rules exist)

**File: `apps/web/src/App.tsx`** — add route:
```tsx
import { GuardrailsPage } from "./pages/GuardrailsPage";

<Route path="/guardrails" element={
  <ProtectedRoute>
    <Layout>
      <GuardrailsPage />
    </Layout>
  </ProtectedRoute>
} />
```

**File: `apps/web/src/components/Layout.tsx`** — add "Guardrails" nav link in sidebar (visible to all roles, not just super_admin).

**Agent:** Frontend (must use `frontend-design-system` skill)
**Branch:** `v3/step-5-guardrail-frontend`
**Done when:** Page renders at `/guardrails`. Full flow works: empty state → generate → review → save → list. Toggle and delete work. Nav link visible. `pnpm typecheck` passes.

---

## Step Dependencies

```
Step 1: Shared contracts              ← V2 complete (main branch)
Step 2: DB schema + migration         ← Step 1
Step 3: LLM generator service         ← Step 1
Step 4: API routes                    ← Steps 2, 3
Step 5: Frontend page                 ← Steps 1, 4
```

### Parallelization Opportunities

| Parallel Group | Steps | Why |
|----------------|-------|-----|
| **Group A** | Steps 2 + 3 | DB schema and LLM service are independent (both only need Step 1) |
| **Group B** | Step 5 skeleton | Frontend page structure can start once Step 1 types exist |

---

## File Change List

| File | Action |
|------|--------|
| `packages/shared/src/contracts/guardrail.ts` | **NEW** — all shared types |
| `packages/shared/src/index.ts` | Edit — add export |
| `packages/db/src/schema.ts` | Edit — add `guardrails` table + `boolean` import |
| `packages/db/src/index.ts` | Edit — add `guardrails` export |
| `packages/db/drizzle/0007_*.sql` | **NEW** — auto-generated migration |
| `apps/api/src/services/guardrail-generator.ts` | **NEW** — LLM service |
| `apps/api/src/services/guardrail-generator.test.ts` | **NEW** — unit tests |
| `apps/api/src/routes/guardrails.ts` | **NEW** — CRUD + SSE routes |
| `apps/api/src/routes/guardrails.test.ts` | **NEW** — route tests |
| `apps/api/src/app.ts` | Edit — register guardrail routes |
| `apps/web/src/pages/GuardrailsPage.tsx` | **NEW** — full page |
| `apps/web/src/App.tsx` | Edit — add route |
| `apps/web/src/components/Layout.tsx` | Edit — add nav link |

---

## Verification

1. `pnpm vitest run apps/api/src/services/guardrail-generator.test.ts` — all tests pass
2. `pnpm vitest run apps/api/src/routes/guardrails.test.ts` — all tests pass
3. `pnpm typecheck` — no new errors
4. `cd packages/db && pnpm db:generate` — migration generated cleanly
5. Navigate to `/guardrails` → empty state shows
6. Type description, click Generate → SSE events stream in, rules appear progressively
7. Edit/remove rules in review → Save → rules persist in list
8. Toggle active/inactive → state updates
9. Delete with confirmation → rule removed

---

## Security Considerations

1. **Company scoping:** All guardrail queries filter by `companyId` from auth context — no cross-tenant access
2. **Auth required:** All endpoints behind `authMiddleware`
3. **Input validation:** Prompt length and rule structure validated before LLM call and DB insert
4. **No secrets in responses:** Only guardrail metadata returned, no internal IDs or system prompts exposed

## Out of Scope for V3

- Manual rule builder (field/operator/value dropdowns) — deferred, LLM-only for now
- Line-item-level rules — campaign scope only
- Guardrail validation execution (that's V4)
- Rule ordering/priority
- Rule versioning/history
- Import/export rules
