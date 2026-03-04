# Guardrails — Claude Code Instructions

## Project Overview

Media Executor Guardrails — a tool that takes media plans (Excel) + natural language guardrails, validates them, and creates campaigns in Meta Ads. Full TypeScript monorepo.

## Key Documents

- `shaping.md` — Requirements, shapes, affordances, architectural decisions
- `DEVELOPMENT_PROCESS.md` — **Read this before any task.** Defines agent roles, task handoff format, process pipeline, review checklist, and branch conventions
- `V0-plan.md` — Slice plan for V0 (Auth + Multi-tenancy)
- `V0.5-plan.md` — Slice plan for V0.5 (Meta Ad Account Connection)

## Development Process

**All agents must follow the process defined in `DEVELOPMENT_PROCESS.md`.** This includes:

- Agent roles: Orchestrator, Senior Engineer, Backend, Frontend, Tester, Reviewer
- Task handoff format (self-contained task descriptions with branch, instructions, context files, done-when criteria)
- Pipeline: Orchestrate → Implement (with self-check) → Test → PR → Review → Merge + Verify
- Branch naming: `{slice}/step-{N}-{short-description}` from latest `main`
- Review checklist: spec match, contract match, security, TypeScript strict, tests, no over-engineering

## Tech Stack

| Layer | Choice |
|-------|--------|
| Frontend | React + Vite |
| Backend | Hono (Node) |
| Auth | Neon Auth (Better Auth) |
| Database | Neon Postgres |
| ORM | Drizzle |
| Dev Tooling | Vite dev server (`:5173`), Hono dev server (`:3001`) |
| Tests | Vitest (unit/integration), Playwright (E2E) |
| Language | TypeScript end-to-end |

## Monorepo Structure

- `apps/web` — React frontend
- `apps/api` — Hono backend
- `packages/shared` — Shared types, contracts
- `packages/db` — Drizzle schema, migrations

## Rules

- Always self-check (`pnpm typecheck`, `pnpm lint`) before handing off to the next agent
- Frontend agent must invoke the `frontend-design-system` skill before building any UI
- Never commit secrets, tokens, or `.env` files
- Shared contracts in `packages/shared` are the source of truth for API shapes — both frontend and backend import from there
- One branch per step, one PR per step, small reviewable PRs
- Squash merge to main, verify main is green after every merge
