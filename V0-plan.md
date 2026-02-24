---
shaping: true
---

# V0 Slice Plan: Auth + Multi-tenancy

**Slice:** V0 — Auth + Multi-tenancy
**Parts:** A9
**Demo:** Super admin (seeded) logs in, invites a user (copies link), invited user accepts and logs in
**Stack:** React + Vite, Hono (Node), Neon Auth (Better Auth), Neon Postgres, Drizzle ORM, Portless — full TypeScript

---

## Steps

### Step 1: Project scaffold

Init monorepo structure:

```
guardrails/
├── apps/
│   ├── web/          — React + Vite
│   └── api/          — Hono on Node
├── packages/
│   ├── db/           — Drizzle schema, migrations, seed
│   └── shared/       — API contracts, shared types
├── package.json      — pnpm workspaces
└── tsconfig.base.json
```

- `apps/web`: React 19, Vite, React Router, TypeScript
- `apps/api`: Hono, @hono/node-server, better-auth, TypeScript
- `packages/db`: drizzle-orm, @neondatabase/serverless, drizzle-kit
- `packages/shared`: API contracts, shared types (imported by both apps)
- Shared tsconfig base with strict mode
- Portless for local dev:
  - `guardrails.localhost:1355` → Vite (web)
  - `api.guardrails.localhost:1355` → Hono (API)
  - No manual port management, stable URLs for CORS/cookies/OAuth redirects
- Vitest configured in both apps + packages
- Playwright configured in `apps/web`

**Done when:** `pnpm dev` starts both apps via Portless. `guardrails.localhost:1355` serves the Vite app, `api.guardrails.localhost:1355` serves the Hono API. `pnpm test` runs Vitest. `pnpm test:e2e` runs Playwright.

---

### Step 2: Database schema + migrations

Define Drizzle schema in `packages/db/schema.ts`:

**`public.companies`** (N2)

| Column | Type | Notes |
|--------|------|-------|
| id | uuid, PK | default gen_random_uuid() |
| name | text, NOT NULL | |
| created_at | timestamptz | default now() |

**`public.company_users`** (N3)

| Column | Type | Notes |
|--------|------|-------|
| id | uuid, PK | default gen_random_uuid() |
| user_id | text, nullable | FK → neon_auth.users.id. Null while status=invited |
| company_id | uuid, NOT NULL | FK → companies.id |
| email | text, NOT NULL | Captured at invite time |
| role | text, NOT NULL | 'super_admin' or 'executor' |
| status | text, NOT NULL | 'invited' or 'active' |
| invite_token | text, nullable | UUID token, set on invite, cleared on accept |
| created_at | timestamptz | default now() |

**RLS policies** (N4) — migration SQL:

- Enable RLS on `companies` and `company_users`
- Policy on both: `USING (company_id = current_setting('app.company_id')::uuid)`
- This relies on the API middleware setting `app.company_id` session variable per request

**Done when:** `pnpm db:migrate` creates tables + RLS policies. `pnpm db:studio` shows the schema.

---

### Step 3: Neon Auth + Better Auth setup

Configure Better Auth in `apps/api`:

- Install `better-auth` and configure with Neon Postgres connection
- Set up email/password auth provider
- Mount Better Auth handler at `/api/auth/*` (N5):
  ```typescript
  app.on(['POST', 'GET'], '/api/auth/**', (c) => auth.handler(c.req.raw))
  ```
- Better Auth manages `neon_auth` schema tables (users, sessions, accounts) (N1)
- Configure CORS for Vite dev server origin

**Done when:** `POST /api/auth/sign-up/email` creates a user, `POST /api/auth/sign-in/email` returns a session cookie.

---

### Step 4: Auth middleware (N9)

Create Hono middleware at `apps/api/middleware/auth.ts`:

1. Extract session cookie from request
2. Validate via Better Auth `auth.api.getSession()`
3. Look up `company_users` row by `user_id` to get `company_id` and `role`
4. Execute `SET LOCAL app.company_id = '<uuid>'` on the DB connection (for RLS)
5. Set context: `c.set('auth', { userId, companyId, role, email })`
6. Return 401 if no valid session or no company_users mapping

Create a `requireRole('super_admin')` middleware for admin-only routes.

**Done when:** Protected routes return 401 without session, 200 with valid session. `c.get('auth')` contains userId, companyId, role.

---

### Step 5: Seed script (N10)

Create `packages/db/seed.ts`:

1. Create a company (e.g., "Acme Corp") in `companies`
2. Create a Better Auth user via `auth.api.signUpEmail({ email, password })` — this writes to `neon_auth.users`
3. Create a `company_users` row linking user → company with role=`super_admin`, status=`active`

Run via `pnpm db:seed`. Reads email/password from env vars or CLI args.

**Done when:** After seeding, `POST /api/auth/sign-in/email` with seed credentials returns a valid session, and the middleware resolves company context.

---

### Step 6: API routes — Invite + Accept-Invite + List Users

**`POST /api/users/invite`** (N6)
- Middleware: auth + requireRole('super_admin')
- Body: `{ email, role }`
- Validate: role is 'super_admin' or 'executor', email not already in company_users for this company
- Create `company_users` row: company_id from auth context, status=`invited`, invite_token=`crypto.randomUUID()`, user_id=null
- Return: `{ inviteLink: "${FRONTEND_URL}/accept-invite?token=${invite_token}" }`

**`POST /api/auth/accept-invite`** (N7)
- Public route (no auth — user has no account yet)
- Body: `{ token, password }`
- Look up company_users by invite_token where status=`invited`
- 400 if not found or already used
- Create Better Auth user: `auth.api.signUpEmail({ email: companyUser.email, password })`
- Update company_users: `user_id` = new user id, `status` = `active`, `invite_token` = null
- Return: `{ success: true }`

**`GET /api/users`** (N8)
- Middleware: auth + requireRole('super_admin')
- Query `company_users` (RLS scopes to company automatically)
- Return: `{ users: [{ id, email, role, status, createdAt }] }`

**Done when:** Full invite flow works via curl/Postman:
1. Super admin signs in → gets session
2. POST /api/users/invite → gets invite link
3. POST /api/auth/accept-invite with token + password → creates account
4. New user signs in → gets session with correct company + role

---

### Step 7: Frontend — Auth client + routing shell

Set up the frontend foundation in `apps/web`:

- Install Better Auth client SDK (`@better-auth/react` or vanilla client)
- Configure auth client pointing at `/api/auth`
- Set up React Router with route structure:
  ```
  /login              → LoginPage
  /accept-invite      → AcceptInvitePage
  /dashboard          → Dashboard (protected)
  /users              → UserManagementPage (protected, super_admin only)
  ```
- Create `ProtectedRoute` wrapper: checks auth session, redirects to `/login` if unauthenticated
- Create `AdminRoute` wrapper: extends ProtectedRoute, redirects if role !== super_admin
- Create auth context/hook: `useAuth()` → returns `{ user, company, role, signOut, isLoading }`

**Done when:** Unauthenticated access to `/dashboard` redirects to `/login`. Auth state is available throughout the app via `useAuth()`.

---

### Step 8: Login page (U1–U3)

Page at `/login`:

- Email input (U1), password input (U2), Login button (U3)
- Calls Better Auth client `signIn.email({ email, password })`
- On success: redirect to `/dashboard`
- On error: show inline error (e.g., "Invalid email or password")
- If already authenticated: redirect to `/dashboard`

**Done when:** Super admin (from seed) can log in via the UI and reach the dashboard.

---

### Step 9: Dashboard + Nav layout (U4–U6, U15)

App shell layout with:

- **Nav sidebar** (all pages):
  - App name / logo area
  - "Dashboard" link
  - "User Management" link (U15) — only rendered if `role === 'super_admin'`
  - Logout button (U6) at bottom: calls `signOut()`, redirects to `/login`

- **Dashboard page** at `/dashboard`:
  - Company name display (U4) — from auth context
  - Role badge (U5) — "Super Admin" or "Executor"
  - Empty state placeholder for future slices (campaign list, etc.)

**Done when:** Logged-in user sees dashboard with company name, role badge. Super admin sees User Management in nav. Logout works.

---

### Step 10: User Management page + Invite flow (U7–U11.1)

Page at `/users` (super_admin only, wrapped in `AdminRoute`):

- **Users table** (U7): columns — Email, Role, Status. Fetches from `GET /api/users`
- **"Invite User" button** (U8): opens a modal or inline form
- **Invite form**:
  - Email input (U9)
  - Role selector (U10): dropdown with "Executor" (default) and "Super Admin"
  - "Create Invite" button (U11): calls `POST /api/users/invite`
  - On success: **Invitation link display** (U11.1) — shows the link in a read-only input with a "Copy" button. Link stays visible until the modal is dismissed
- Table refreshes after invite to show the new row (status: invited)

**Done when:** Super admin can view users, create an invite, and copy the invitation link.

---

### Step 11: Accept Invite page (U12–U14)

Page at `/accept-invite?token=xxx`:

- On mount: validate token is present in URL (show error if missing)
- New password input (U12)
- Confirm password input (U13)
- "Set Password" button (U14): calls `POST /api/auth/accept-invite` with `{ token, password }`
- Client-side validation: passwords match, minimum length
- On success: redirect to `/login` with a flash message ("Account created — please log in")
- On error: show inline error (e.g., "Invalid or expired invitation link")

**Done when:** Full end-to-end V0 demo works:
1. `pnpm db:seed` → creates company + super admin
2. Super admin logs in → sees Dashboard with company name + "Super Admin" badge
3. Navigates to User Management → sees themselves in the users list
4. Clicks "Invite User" → enters email + role → clicks "Create Invite"
5. Copies the invitation link
6. Opens link in new browser/incognito → sets password
7. Logs in as new user → sees Dashboard with correct role badge
8. If executor: does NOT see User Management in nav

---

## Out of Scope for V0

- Email delivery (invitation links shown on screen only)
- Password reset / forgot password flow
- Company creation UI (seed script only)
- Profile editing
- Any campaign, guardrail, or Meta functionality
