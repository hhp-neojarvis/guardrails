---
shaping: true
---

# Media Executor Guardrails — Shaping

## Source

> People generally are the people who execute social media plans by creating campaigns in different social media platforms. Currently there is an issue of lot of human error which leads to budget overspends, budget wastages, etc. The tool we are building helps us solve this. So the executor will start with the plan usually an excel sheet. and then there will be some guardrail instructions which will help us to create campaigns in different social media platforms according to the plans. These guardrails can be, for example, the brand for which we are creating the campaign operates only in India so ensure that all the geographies for all the campaigns are within India. Another one: ensure that maximum budget is set for all campaigns. The guardrails can be defined in natural language.
>
> Certain columns of the Excel sheet must be interpreted using some kind of LLM. For example, the location could be given as "Maharashtra (Amravati, Bhiwandi, Kolhapur, Malegaon)" which means select those specific cities in the state Maharashtra, India. For demographics: "18-24 M+F" means male and female between age 18 to 24.

---

## Problem

Media executors manually translate Excel-based media plans into campaigns in social media platforms. This manual process is error-prone — leading to budget overspends, budget wastage, wrong geography targeting, incorrect demographics, and other costly mistakes.

## Outcome

A tool that takes a media plan (Excel) + natural language guardrails, interprets the plan correctly, validates it, and creates campaigns in Meta Ads — catching errors before they reach the platform.

---

## Requirements (R)

| ID | Requirement | Status |
|----|-------------|--------|
| R0 | Reduce human error in campaign creation from media plans | Core goal |
| R1 | Accept media plan input as Excel sheets (fixed schema for MVP) | Must-have |
| R2 | Accept guardrails as natural language instructions at company level, reusable across campaigns | Must-have |
| R3 | Parse ambiguous Excel column values into structured campaign parameters (locations, demographics, buy types, assets, inventory) using LLM interpretation | Must-have |
| R4 | Validate campaign configurations against guardrails before execution | Must-have |
| R5 | Auto-create campaigns via Meta Ads API (as drafts, never auto-publish) | Must-have |
| R6 | Three-stage lifecycle: Preview (in-tool) → Draft (in Meta) → Published (explicit user action only) | Must-have |
| R7 | Two roles for MVP: super_admin (manages users, sets guardrails) and executor (executes plans). Both can do everything an executor does. | Must-have |
| R8 | Guardrail generation: users describe common mistakes → system generates guardrail rules → user edits/approves → rules persist at company level | Must-have |
| R9 | One campaign per unique Markets + Channel combination; rows within that group become line items (ad sets/ads) | Must-have |
| R10 | Guardrail violations are warnings with override — user can proceed but overrides are logged | Must-have |
| R11 | Super admin can create and manage user accounts within a company | Must-have |
| R12 | Users can log in and authenticate to the tool | Must-have |
| R13 | Users can connect specific Meta Ad Accounts via OAuth; tool uses these credentials to act on their behalf. User selects which ad account per execution | Must-have |
| R14 | Multi-tenant: each company is an isolated tenant. Users, guardrails, campaigns, audit logs all scoped to company | Must-have |

---

## Excel Schema (Fixed for MVP)

| Column | Definition | LLM Interpretation Needed? |
|--------|-----------|---------------------------|
| **Markets** | Geographic region or city cluster (e.g. "Maharashtra (Amravati, Bhiwandi, Kolhapur, Malegaon)") | Yes — parse into structured geo targets |
| **Channel** | Platform + campaign phase (e.g. "Meta - Pre-launch", "YouTube - During") | Yes — extract platform and phase |
| **WOA** | Weeks of Activity — number of weeks the line item runs | Minimal |
| **Targeting** | Demographic segment: age range + gender (e.g. "18-24 M+F") | Yes — parse into age range + gender |
| **Buy Type** | Purchase method: RNF (Reach & Frequency), Auction-TF, Fixed | Yes — map to Meta campaign objective/buying type |
| **Asset** | Creative format (e.g. "Image/Video", "6 sec Video") | Yes — map to Meta ad format |
| **Inventory** | Placement within channel (e.g. "Feeds", "Stories", "Reels") | Yes — map to Meta placement IDs |
| **Total Reach** | Estimated unique individuals reached | Minimal |
| **Avg Frequency** | Average times each user sees the ad | Minimal |
| **Budget** | Campaign or line-item budget | Minimal |
| **Start Date** | Campaign start date | Minimal |
| **End Date** | Campaign end date | Minimal |
| **Campaign Name** | Name for the campaign | Minimal |

### Campaign Grouping Rule

Rows sharing the same **Markets + Channel** = one campaign. Rows within that group become ad sets or ads within the campaign.

---

## Guardrail Examples

1. "Ensure all geographies for all campaigns are within India"
2. "Ensure maximum budget is set for all campaigns"
3. (User-generated from common mistakes prompt — e.g. "I often forget to set frequency caps" → system generates: "Ensure frequency cap is set for all ad sets")

---

## Shape A: LLM Pipeline with Deterministic Guardrails

| Part | Mechanism |
|------|-----------|
| **A1** | **Excel Parser** — reads fixed-schema Excel, groups rows by Markets+Channel into campaign objects with raw column values |
| **A2** | **LLM Interpreter + Meta Resolver** — LLM extracts intent from ambiguous columns (markets, targeting, buy type, asset, inventory), then resolves against Meta Marketing API to get real geo target IDs, placement IDs, etc. Two-step: interpret → resolve |
| **A3** | **Guardrail Generator** — LLM takes user's "common mistakes" natural language, generates structured rules (each rule = natural language description + structured check definition: field, operator, value/constraint). User reviews, edits, approves. Persisted at company level |
| **A4** | **Deterministic Guardrail Validator** — executes structured rules against campaign configs programmatically. No LLM at validation time. Produces pass/warn per rule per campaign with human-readable explanations |
| **A5** | **Preview UI** — displays campaigns grouped by Markets+Channel, shows ad sets within each, all targeting/budget/placement details, guardrail results (pass/warn). User can override warnings (logged) or go back to fix Excel |
| **A6** | **Meta Ads Draft Creator** — takes validated configs, creates campaigns + ad sets as PAUSED drafts via Meta Marketing API. Never publishes |
| **A7** | **Publisher** — separate action with separate confirmation. Publishes drafts on explicit user request only |
| **A8** | **Override Audit Log** — records every guardrail override: user, timestamp, guardrail rule, campaign, violation detail, user's reason for override |
| **A9** | **Auth + User Management** — multi-tenant: each company is a tenant with data isolation. Super admin creates company + invites users (email/password auth). Two roles: super_admin, executor. Users belong to exactly one company. Guardrails, campaigns, audit logs all scoped to company |
| **A10** | **Meta Ad Account Connection** — user connects a specific Meta Ad Account via OAuth. Tool stores access token per ad account, refreshes as needed. User can connect multiple ad accounts and select which to use per campaign execution. All Meta API calls scoped to the selected ad account |

### Architectural Decisions

- **A2: LLM interprets, Meta API resolves.** The LLM parses human shorthand into structured intent. A programmatic step then resolves that intent against Meta's actual targeting/placement APIs to get real IDs. This prevents hallucinated IDs.
- **A3→A4: Guardrails are dual-format.** Each guardrail has a natural language description (for display) AND a structured check definition (for deterministic execution). The LLM generates both during setup; validation is purely programmatic.
- **A6: Drafts are PAUSED, not just drafts.** Meta's API creates campaigns in PAUSED status. This means they exist in Ads Manager for review but won't spend any budget.

### Pipeline Flow

```
[Platform Setup — once per company]
    A9: Super admin creates company, invites users (email/password)
    A10: Users connect their Meta Ad Account(s) via OAuth

[Guardrail Setup — once per company, editable anytime]
    User describes common mistakes (natural language)
        → A3: LLM generates structured guardrail rules
        → User reviews/edits
        → Persisted at company level

[Campaign Execution — per plan]
    User selects which Meta Ad Account to use
    Excel upload
        → A1: Parse rows, group by Markets+Channel into campaigns
        → A2: LLM interprets ambiguous columns → Meta API resolves to real IDs
        → A4: Deterministic validation against company guardrails
        → A5: Preview in-tool (campaigns, ad sets, warnings, overrides)
        → User approves (or fixes Excel and re-runs)
        → A6: Create as PAUSED drafts in Meta (using selected ad account)
        → User reviews in Ads Manager
        → A7: Publish on explicit request
```

### Guardrail Rule Structure (A3 output)

```json
{
  "id": "gr-001",
  "description": "Ensure all geographies are within India",
  "check": {
    "scope": "campaign",
    "field": "geo_targets",
    "operator": "all_within",
    "value": { "country": "IN" }
  }
}
```

```json
{
  "id": "gr-002",
  "description": "Ensure maximum budget is set for all campaigns",
  "check": {
    "scope": "campaign",
    "field": "lifetime_budget",
    "operator": "is_set",
    "value": null
  }
}
```

### Open Decisions

- **A2 risk:** Geo/Markets interpretation is identified as highest-risk column for misinterpretation. Will need robust resolution against Meta's geo targeting search API. Spike candidate.
- **A3 operators:** Guardrail rule operators will emerge organically as real guardrail examples accumulate. No fixed operator set upfront.

---

## Fit Check: R × A

| Req | Requirement | Status | A |
|-----|-------------|--------|---|
| R0 | Reduce human error in campaign creation from media plans | Core goal | ✅ |
| R1 | Accept media plan input as Excel sheets (fixed schema for MVP) | Must-have | ✅ |
| R2 | Accept guardrails as natural language instructions at company level, reusable | Must-have | ✅ |
| R3 | Parse ambiguous Excel values into structured params using LLM interpretation | Must-have | ✅ |
| R4 | Validate campaign configurations against guardrails before execution | Must-have | ✅ |
| R5 | Auto-create campaigns via Meta Ads API (as drafts, never auto-publish) | Must-have | ✅ |
| R6 | Three-stage lifecycle: Preview → Draft → Published (explicit only) | Must-have | ✅ |
| R7 | Two roles: super_admin + executor. Both can execute plans | Must-have | ✅ |
| R8 | Guardrail generation from common mistakes → structured rules → edit → persist | Must-have | ✅ |
| R9 | One campaign per Markets+Channel; rows become line items | Must-have | ✅ |
| R10 | Guardrail violations are warnings with override, overrides logged | Must-have | ✅ |
| R11 | Super admin can create and manage user accounts within a company | Must-have | ✅ |
| R12 | Users can log in (email/password) | Must-have | ✅ |
| R13 | Users connect specific Meta Ad Accounts via OAuth; select per execution | Must-have | ✅ |
| R14 | Multi-tenant: each company is an isolated tenant | Must-have | ✅ |

---

## Slices

| Slice | Name | Parts | Demo |
|-------|------|-------|------|
| **V0** | **Auth + Multi-tenancy** | A9 | Super admin creates company, invites user, user logs in |
| **V0.5** | **Meta Ad Account Connection** | A10 | User connects Meta Ad Account via OAuth, sees it listed |
| **V1** | **Excel → Geo Resolution** | A1 + A2 (geo only) | Upload Excel, see campaigns with resolved geo targets |
| **V2** | **Full Interpretation** | A2 (all columns) | See fully structured campaign configs |
| **V3** | **Guardrail Setup** | A3 | Describe mistakes, see generated rules, edit, save |
| **V4** | **Validation + Preview** | A4 + A5 + A8 | Preview with pass/warn, override with logging |
| **V5** | **Draft Creation** | A6 | PAUSED campaigns appear in Meta Ads Manager |
| **V6** | **Publish** | A7 | Publish from tool, verify live in Meta |

### Slice Order Rationale

- **V0 first:** Everything depends on auth + tenancy
- **V0.5 next:** Meta connection needed for API resolution in V1+
- **V1 tackles highest risk:** Geo interpretation is hardest column
- **V2 completes interpretation** before adding validation
- **V3 independent:** Guardrail setup doesn't need full pipeline (could parallel with V1/V2)
- **V4 is the core value prop:** First time user sees guardrails catching errors
- **V5/V6 separated:** Draft creation is reversible, publishing is not

---
