---
shaping: true
---

# Development Process

## Core Principle: Fresh Context Per Task

Every agent starts each task in a **fresh context** — no memory from previous tasks. All context must come from:

1. **The task description** provided by the orchestrator
2. **The project documents** (shaping doc, slice plan, this process doc)
3. **The codebase** on the task branch

This means the orchestrator's task description must be self-contained and explicit about what to do and what to read.

## Agents

| Agent | Responsibility | Writes code? | Model |
|-------|---------------|:---:|-------|
| **Orchestrator** | Reads plan, creates branches, assigns tasks, sequences work, merges PRs, runs integration verification | No | Opus |
| **Senior Engineer** | API contracts, shared types, project scaffold, Drizzle schema, cross-cutting architecture | Yes | Opus |
| **Backend** | Implements API routes, middleware, auth config — builds against contracts | Yes | Sonnet |
| **Frontend** | Implements React components, routing, UI — builds against contracts. **Must use the `frontend-design-system` skill** before building any UI to get design tokens, layout rules, and accessibility checks | Yes | Sonnet |
| **Tester** | Writes + runs Vitest unit/integration tests and Playwright E2E tests | Yes | Sonnet |
| **Reviewer** | Reviews PR against checklist, approves or requests changes | No | Opus |

### Model Selection Rationale

- **Opus** for Orchestrator, Senior Engineer, and Reviewer — these roles require stronger judgment: sequencing decisions, architectural choices, and catching subtle issues during review.
- **Sonnet** for Backend, Frontend, and Tester — these roles implement against well-defined specs (task handoff format + contracts). Sonnet handles scoped implementation well and significantly reduces cost since these agents do the most token-heavy work.

## Task Handoff Format

When the orchestrator assigns a task to any agent, the task description must include:

```
## Task: [Step N — Short Description]

### Branch
v0/step-{N}-{short-description}

### What to do
[Specific instructions — what to build/test/review]

### Context files to read
- shaping.md — Section: [specific section, e.g., "Detail V0, affordances N5–N7"]
- V0-plan.md — Step N
- [any other relevant files in the codebase]

### Contracts / Types
- [path to relevant contract files, if they exist]

### Done when
[Specific acceptance criteria from the slice plan]
```

This format ensures each agent can pick up the task cold and know exactly what to do, what to read, and when they're done.

## Dev Environment

### Dev Servers

| App | URL |
|-----|-----|
| **Web (Vite)** | `http://localhost:5173` |
| **API (Hono)** | `http://localhost:3001` |

Dev start: `pnpm dev` runs both apps concurrently.

### Frontend Design System

The **Frontend agent must invoke the `frontend-design-system` skill** before building any UI component. This skill provides:
- Design tokens (colors, spacing, typography)
- Layout rules and grid system
- Motion/animation guidance
- Accessibility checks

This ensures consistent, production-grade UI across all steps and agents.

## Test Stack

| Layer | Tool | Scope |
|-------|------|-------|
| **Unit tests** | Vitest | Individual functions, utilities, hooks |
| **Integration tests** | Vitest | API endpoint tests (real DB), component tests with mocked API |
| **E2E tests** | Playwright | Full user flows through real browser (login, invite, accept) |

## Process Per Step

```
1. ORCHESTRATE
   ├── Read step from slice plan (e.g., V0.5-plan.md Step 4)
   ├── Check dependency graph — all blocking steps must be merged to main
   ├── Pull latest main
   ├── Create task branch from main (e.g., v0.5/step-4-meta-oauth-routes)
   ├── Determine step type (senior-eng / backend / frontend / mixed)
   ├── Write task description (using handoff format above)
   └── Assign to first agent in the pipeline

2. SENIOR ENGINEER (if step needs contracts, schema, or scaffold)
   ├── Read task description + referenced context files
   ├── Define API contracts + shared types in packages/shared
   ├── Write Drizzle schema + migrations if step involves new tables
   ├── Set up project scaffold / cross-cutting config if needed
   ├── Self-check: run `pnpm typecheck` and `pnpm lint` — fix any errors before proceeding
   ├── Commit to task branch
   └── Notify orchestrator → orchestrator writes next task description + assigns next agent

3. BACKEND IMPLEMENT
   ├── Read task description + referenced context files + contracts on branch
   ├── Implement against shaping doc affordances + step spec + contracts
   ├── Self-check: run `pnpm typecheck` and `pnpm lint` — fix any errors before proceeding
   ├── Commit to task branch
   └── Notify orchestrator

4. FRONTEND IMPLEMENT
   ├── Read task description + referenced context files + contracts on branch
   ├── Starts AFTER backend is done (sequential within mixed steps)
   ├── Invoke `frontend-design-system` skill before building any UI
   ├── Implement against same contracts + working API
   ├── Self-check: run `pnpm typecheck` and `pnpm lint` — fix any errors before proceeding
   ├── Commit to task branch
   └── Notify orchestrator

5. TEST
   ├── Read task description + referenced context files
   ├── Read the code changes on the branch (git diff main)
   ├── Write Vitest unit tests (functions, hooks, utilities)
   ├── Write Vitest integration tests (API endpoints, component tests)
   ├── Write Playwright E2E tests (user flows for this step)
   ├── Run all tests (`pnpm test` and `pnpm test:e2e`)
   ├── If failures:
   │     ├── Tester reports failures with details to orchestrator
   │     ├── Orchestrator writes fix task + assigns back to responsible agent (BE/FE)
   │     ├── Fixing agent commits fix on same branch
   │     └── Tester re-runs — loop until all green
   ├── Commit tests when all passing
   └── Notify orchestrator

6. CREATE PR
   ├── Orchestrator creates PR from task branch → main
   ├── PR title: "V0.5 Step N — Short Description"
   ├── PR body: summary of changes, link to plan step, test results
   └── Assign to Reviewer agent

7. REVIEW
   ├── Read task description + referenced context files
   ├── Read the full diff (git diff main)
   ├── Review against checklist (see below)
   ├── Approve → notify orchestrator
   └── Request changes:
         ├── Reviewer posts specific change requests on the PR
         ├── Orchestrator assigns fix task back to responsible agent
         ├── Agent fixes, commits, pushes to same branch
         ├── Tester re-verifies if changes are non-trivial
         └── Reviewer re-reviews — loop until approved

8. MERGE + VERIFY
   ├── Orchestrator merges PR to main (squash merge preferred for clean history)
   ├── Pull latest main
   ├── Run full test suite on main: `pnpm test` + `pnpm test:e2e`
   ├── If integration failures:
   │     ├── Create hotfix branch from main
   │     ├── Fix, test, PR, review (expedited — same process, tighter loop)
   │     └── Merge hotfix
   ├── Confirm main is green
   └── Pick next step (respecting dependency graph)
```

## Step Type Pipelines

### Scaffold / Schema Steps (e.g., Steps 1, 2)

```
ORCHESTRATE → SENIOR ENGINEER → TEST → REVIEW → MERGE
```

### Backend-Only Steps (e.g., Steps 3–5)

```
ORCHESTRATE → SENIOR ENGINEER (contract/schema if needed) → BACKEND → TEST → REVIEW → MERGE
```

### Frontend-Only Steps (e.g., Step 8)

```
ORCHESTRATE → FRONTEND → TEST → REVIEW → MERGE
```

### Mixed Steps (e.g., Steps 6+10, 7+9)

```
ORCHESTRATE
    → SENIOR ENGINEER (define contracts + schema)
    → BACKEND (implement API against contracts)
    → FRONTEND (implement UI against contracts, after backend done)
    → TEST
    → REVIEW
    → MERGE
```

## Branch Naming

```
{slice}/step-{N}-{short-description}

Examples:
  v0/step-1-scaffold
  v0/step-2-db-schema
  v0/step-6-invite-api
  v0.5/step-4-meta-oauth-routes
  v0.5/step-7-meta-accounts-ui
```

One branch per step. One PR per step. Small, reviewable PRs. Branch always created from latest `main`.

## Review Checklist

The reviewer checks every PR against:

- [ ] **Spec match** — Does the code implement the affordances described in the shaping doc?
- [ ] **Contract match** — Do API endpoints match the shared types/contract?
- [ ] **Security** — No auth bypass, no SQL injection, no secrets in code, inputs validated
- [ ] **TypeScript** — Strict mode, no `any` unless justified, proper error types
- [ ] **Tests present** — Vitest unit + integration tests cover the new code. Playwright E2E tests cover new user flows
- [ ] **Tests passing** — All tests green
- [ ] **No over-engineering** — No unnecessary abstractions, no features beyond the step scope
- [ ] **Conventions** — Follows project naming, file structure, patterns established in earlier steps

## API Contract Format

For steps with both frontend and backend, the senior engineer defines the contract before implementation begins. Contracts live in a shared package.

```typescript
// packages/shared/contracts/users.ts

export interface InviteUserRequest {
  email: string
  role: 'super_admin' | 'executor'
}

export interface InviteUserResponse {
  inviteLink: string
}

export interface AcceptInviteRequest {
  token: string
  password: string
}

export interface AcceptInviteResponse {
  success: boolean
}

export interface ListUsersResponse {
  users: {
    id: string
    email: string
    role: 'super_admin' | 'executor'
    status: 'invited' | 'active'
    createdAt: string
  }[]
}
```

Both backend and frontend import from this package. If the contract needs to change, it goes through the senior engineer and the same PR process.

## Error Handling Convention

APIs return consistent error shapes:

```typescript
// packages/shared/contracts/errors.ts

export interface ApiError {
  error: string    // machine-readable code (e.g., "INVALID_TOKEN")
  message: string  // human-readable message
}
```

## Step Dependencies (V0)

```
Step 1: Scaffold                    ← no dependency
Step 2: DB schema + migrations      ← Step 1
Step 3: Neon Auth setup             ← Step 1
Step 4: Auth middleware             ← Steps 2, 3
Step 5: Seed script                 ← Steps 3, 4
Step 6: Invite/Accept/List API      ← Steps 4, 5
Step 7: FE auth client + routing    ← Steps 1, 3
Step 8: Login page                  ← Step 7
Step 9: Dashboard + Nav             ← Steps 7, 8
Step 10: User Management + Invite   ← Steps 6, 9
Step 11: Accept Invite page         ← Steps 6, 9
```

## Parallelization Opportunities

Some steps within V0 are independent and can run in parallel:

| Parallel Group | Steps | Why |
|----------------|-------|-----|
| **Group A** | Steps 2 + 3 | DB schema and Auth setup are independent |
| **Group B** | Steps 10 + 11 | User Management page and Accept Invite page are independent UI work |

## Agent Assignment Per Step (V0)

| Step | Senior Engineer | Backend | Frontend | Tester | Reviewer |
|------|:-:|:-:|:-:|:-:|:-:|
| 1. Scaffold | ✅ | | | ✅ | ✅ |
| 2. DB schema + migrations | ✅ | | | ✅ | ✅ |
| 3. Neon Auth setup | | ✅ | | ✅ | ✅ |
| 4. Auth middleware | | ✅ | | ✅ | ✅ |
| 5. Seed script | | ✅ | | ✅ | ✅ |
| 6. Invite/Accept/List API | ✅ (contracts) | ✅ | | ✅ | ✅ |
| 7. FE auth client + routing | | | ✅ | ✅ | ✅ |
| 8. Login page | | | ✅ | ✅ | ✅ |
| 9. Dashboard + Nav | | | ✅ | ✅ | ✅ |
| 10. User Management + Invite | | | ✅ | ✅ | ✅ |
| 11. Accept Invite page | | | ✅ | ✅ | ✅ |
