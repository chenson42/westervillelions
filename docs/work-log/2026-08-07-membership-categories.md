# Membership Categories on the Member Record — Work Log

> **Slug:** `2026-08-07-membership-categories`
> **Surface:** (dashboard) admin — member records; possible read-only surfacing in the member portal
> **Permission(s):** `FEATURES.MEMBERS_EDIT` (write) / `FEATURES.MEMBERS_VIEW` (read) — reused, no new key. Open question: should `DUES_MANAGE` gate it instead (see Phase 1).
> **Estimated complexity:** medium — schema change + migration + admin UI
> **Pipeline mode:** Full — schema change, and a naming collision with two existing fields

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-08-07 |
| 2 — Architectural review | architect | **Skipped** | see rationale | 2026-08-07 |
| 3 — Technical design | tech-lead | Complete | Design complete, implementer named | 2026-08-07 |
| 4 — Implementation (schema) | database-admin | Complete | Gates pass; handed off to api-developer | 2026-08-07 |
| 4 — Implementation (API) | api-developer | Complete | Gates pass; handed off to ux-developer | 2026-08-07 |
| 4 — Implementation (UI) | ux-developer | Complete | Gates pass; ready for qa | 2026-08-07 |
| 5 — Verification | qa | Complete | PASS | 2026-08-07 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-08-07 |
| Follow-up #1 (admin list column) | ux-developer | Complete | Gates pass | 2026-08-07 |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

**READY WITH NOTES**

## ONE-LINE TAKE

> Add a closed-taxonomy `membershipType` field (LCI's Active / Member-at-Large / Honorary / Privileged / Life / Associate / Affiliate) that is a *third, orthogonal* axis alongside the existing `membershipStatus` (club standing: prospective/active/ended) and `duesCategory` (billing rate: individual/family) — not a replacement for either — defaulted to `active` for all 50 current members, admin-editable only, with the per-capita-derivation payoff explicitly deferred to a follow-up feature.

## The Central Problem, Resolved

I read every read/write of the three adjacent fields across `src/` and `scripts/`. They are **not** duplicates of each other today — each controls a genuinely different thing — but the treasurer's proposed list vocabulary collides with one of them in a way that will cause exactly the confusion the brief warns about if not handled deliberately.

**What each field controls today:**

| Field | Type | Meaning | Who reads it | Who writes it |
|---|---|---|---|---|
| `members.membershipStatus` | `prospective \| active \| ended` (`src/lib/db/schema.ts:43`) | **Club standing** — is this person mid-onboarding, currently a member, or gone. Added 2026-07-26 (DECISION-041). | `/members` directory query (`inArray(..., ["active","prospective"])`, `src/app/members/page.tsx:31`) · `google-groups.ts:17` `CLUB_LIST_ELIGIBLE_STATUSES = ["active","prospective"]` gates Google Group sync membership · admin members list filters/tabs (`(dashboard)/admin/members/page.tsx:65-67`) · `provisionUserForMember`/`shouldProvisionOnMemberCreate`/`shouldProvisionOnMemberUpdate` in `src/lib/members.ts` (welcome-email + login provisioning fires only on transition to `active`) · member-directory prospective badge (`member-directory.tsx:248`) | Admin, via member-form.tsx → `POST/PATCH /api/admin/members(/[id])`, gated `FEATURES.MEMBERS_EDIT` |
| `members.isActive` | boolean | **Fully derived**, never independently writable. `isActive === (membershipStatus === 'active')` via `isActiveForStatus()` in `src/lib/members.ts:29`. No route accepts a client-submitted `isActive` (DECISION-041). | `dues-queries.ts` scopes dues status to `WHERE m.is_active = true` (i.e., current club standing, not type) | Server-derived only |
| `members.duesCategory` | `individual \| family` (`schema.ts:44`) | **Billing-rate bucket** — which flat dues amount a member owes (individual vs family, per `docs/features/the-ledger-accounting.md:204`). Nothing to do with LCI membership type. | `dues-queries.ts` joins `dues_settings` and picks `individualAmountCents`/`familyAmountCents` off this value | Admin, via a **separate** surface: `PATCH /api/admin/dues/[memberId]/category`, gated `FEATURES.DUES_MANAGE` — **not** the same permission that edits `membershipStatus` |

**The collision:** the treasurer's list begins with "Active" as if it were one option among Honorary/Life/Associate/etc. In LCI's own taxonomy, Active *is* a membership type (the default/base type, distinct from Life, Honorary, etc.), but this codebase already has a column literally named `membershipStatus` whose value `'active'` means something completely different (currently-in-good-standing club membership). A member can legitimately be **type** Active and **status** ended (an ordinary member who resigned), or **type** Life and **status** active (a Life Member still attending meetings). Storing the new field as a bare `active | member_at_large | ...` string in a *separate* column is technically safe (no DB collision — different columns), but any UI, report, or CSV export that shows both a "Status: Active" and a "Category: Active" side by side will read as redundant to a board member unless the two are labeled unambiguously. **This is a copy/labeling discipline requirement on Phase 3, not a schema problem.**

**Recommendation:** a **NEW** field. Name it `membershipType` (column `membership_type`), not `membershipCategory` — "category" is already claimed in this codebase by `duesCategory`, and introducing a second thing called "category" (dues category vs. membership category) sitting next to a thing called "status" is the fastest way to make a treasurer misclick in six months. `membershipType` pairs cleanly with the existing `membershipStatus` name while staying visually distinct. UI copy must always render it as **"Membership Type"** next to **"Membership Status"**, never bare "Category," and admin list/detail views must show both fields adjacent to each other (not on separate tabs) so nobody edits one thinking they set the other.

## Production Data (read-only query, 2026-08-07)

```
membership_status | is_active | dues_category | count
active            | t         | family         | 3
active            | t         | individual     | 38
ended             | f         | individual     | 9
```
50 members total. **Zero `prospective` rows currently.** No existing column (no notes/free-text field exists on `members` at all — I read the full column list in `schema.ts:20-47`) carries any LCI-type signal today, so there is nothing to infer type from programmatically. Every one of the 50 rows needs a human-assigned default.

## Five-Pass Review

### Pass 1 — User Verbs

The request is almost entirely description ("we should add categories") with no stated flow — this is the first note per the Pass 1 instruction. I've had to construct the verbs myself:

| Surface | Verb | Cadence |
|---|---|---|
| Admin (treasurer / membership secretary, `MEMBERS_EDIT`) | Selects a member's LCI membership type from a closed dropdown on the member edit form and saves it | On demand, per member, rare (a member's type changes only on a status milestone — becoming Life, going Honorary, etc.) |
| Admin (treasurer / membership secretary, `MEMBERS_VIEW`) | Sees the assigned type on the member detail/list view alongside status and dues category | Per session, read-only |

No anonymous-visitor, no signed-in-member self-service, and no `/access-pending` surface is implicated — this is an admin-only record attribute, matching the existing precedent that `membershipStatus` and `duesCategory` are both admin-set today (I checked `/members/profile` — neither field appears there; members cannot self-edit either adjacent field, and the new one should follow the same rule for the adversarial reason below).

### Pass 2 — Flow Audit

**Flow 1 — Admin sets a member's LCI membership type.**
Entry: `/(dashboard)/admin/members/[id]` (existing member edit page, `member-form.tsx`) → step: admin picks one of the 7 LCI types from a closed-list `<select>` (mirrors the existing `STATUS_OPTIONS` pattern already in that file) → step: admin saves the form → outcome: `PATCH /api/admin/members/[id]` persists `membershipType`; the admin members list and detail view reflect it immediately.
- Failure: an unlisted/malformed value is rejected server-side with a 400 and a specific message (mirror the dues-category route's shape: `"membershipType must be one of: active, member_at_large, honorary, privileged, life, associate, affiliate"`), surfaced via the existing `toast.error(...)` pattern already wired in `member-form.tsx:129-130`. A DB/network failure shows the same generic "An error occurred" toast that path already falls back to — acceptable, not a new gap.

**Flow 2 — One-time backfill (not user-facing).**
Entry: idempotent migration → step: default every existing row to `active` → outcome: all 50 members carry a value with no nulls. No failure path needed (backfill is server-side, not user-initiated) but the migration must be idempotent per project rules (`WHERE membership_type IS NULL` guard, not a blind `UPDATE`).

Both flows have describable failure paths once constructed; the request itself didn't describe either.

### Pass 3 — Permissions

- **Permission:** reuse **existing `FEATURES.MEMBERS_EDIT`** for writes and **`FEATURES.MEMBERS_VIEW`** for reads — the same gates that already cover `membershipStatus` on this exact form (`member-form.tsx`, `POST/PATCH /api/admin/members`). No new `FEATURES` key needed.
- **Open question (flagged, not resolved by me):** `duesCategory` — the *other* adjacent field — is gated by a **narrower**, separate key (`FEATURES.DUES_MANAGE`) via a dedicated route, not `MEMBERS_EDIT`. Membership type has direct billing/per-capita consequences (see below), which is the same rationale that put `duesCategory` behind `DUES_MANAGE` instead of `MEMBERS_EDIT`. I recommend `MEMBERS_EDIT` (it's fundamentally a membership-record attribute, edited in the same place and by the same people as status) but the treasurer should confirm this isn't meant to be treasurer-only.
- **Default roles:** whichever roles currently hold `MEMBERS_EDIT`/`MEMBERS_VIEW` (Admin, and any membership-secretary-style role already bound to those keys) — no change to role bindings required.

### Pass 4 — Edge Cases the Request Didn't Mention

- **OAuth-vs-password paths.** Not applicable — this field is never touched by the member during sign-in or self-service; it's set entirely by an admin on the member record, independent of how that member (or the admin) authenticates.
- **Access-pending surface.** Not applicable for the same reason — a member with no granted features never reaches a page that reads or writes this field.
- **Email queue.** The request doesn't mention notification, and I don't think it needs one — a type change is an internal bookkeeping update, not a member-facing event. Confirm with the user that no "your membership type changed" email is wanted; if it ever is, it must enqueue through `sendEmail()` like every other outbound message, but nothing in the request asks for this.
- **Google Group sync.** Group sync eligibility (`CLUB_LIST_ELIGIBLE_STATUSES` in `google-groups.ts`) keys off `membershipStatus`, not a type field, and that's correct — an Honorary or Life member with `membershipStatus='active'` should still sync to the club Google Group. **Gap:** the request doesn't say whether any *type* should be excluded from Group sync (e.g., should an Affiliate member — someone who belongs primarily to another club — still get the Westerville club's internal Google Group?). Flagged as an open question.
- **Empty state.** N/A — this is a per-member field on an existing record form, not a new list/table surface with its own empty state.
- **Failure microcopy.** Covered above in Flow 1 — reuses the existing toast pattern; no new microcopy design needed beyond the specific validation message.
- **Mobile (360px).** The existing member-form `<select>` pattern (used for `STATUS_OPTIONS`) is already mobile-responsive; adding one more `<select>` in the same form doesn't introduce new risk. Should be spot-checked in Phase 5 like any other form field, not a special design concern.
- **Brand consistency.** A `<select>` matching the existing `STATUS_OPTIONS` dropdown satisfies this; no cards, buttons, or destructive confirms are involved (this isn't a delete action) so `<ConfirmDialog>` doesn't apply.
- **`scripts/sync-roster.ts` — pre-existing, unrelated bug found.** The request asks whether this script can auto-populate the new field from the LCI roster export. Two findings: (1) the CSV columns this script actually parses (`Name`, `Email`, `Member #`, `Branch`, `telephone`, `Status`, `Start Date` — `scripts/sync-roster.ts:44-55`) carry **no membership-type signal at all**, so even a working script couldn't populate this today; (2) more seriously, **the script itself appears to already be broken against the current schema** — it reads and writes `members.userId` (`sync-roster.ts:82,96,104,112,125`), but `src/lib/db/schema.ts` has no `userId` column on `members`; the FK runs the other direction (`users.memberId` references `members.id`, `schema.ts:12`). This looks like stale code from before a schema change, unrelated to this feature but worth a separate bug ticket — I'm flagging it here because it directly affects the honest answer to the request's own question ("can sync-roster populate this automatically") and because a treasurer who tries to run it expecting it to work will hit a runtime error unrelated to anything this feature ships.

### Pass 5 — Adversarial Pass

- **Redirect targets.** N/A — no redirect/callback parameters in this flow.
- **State-machine shortcuts.** The write path is the existing `PATCH /api/admin/members/[id]` route, already gated by `MEMBERS_EDIT` server-side (not just hidden in the UI) — no direct-API-call bypass beyond what already applies to `membershipStatus` today.
- **Enumeration leaks.** N/A — this isn't a lookup-by-identifier flow with a not-found/wrong-value distinction.
- **Input boundaries.** Must be validated server-side against the closed list before the DB write — see Validation below. An empty/missing value on PATCH should be rejected the same way the dues-category route rejects an invalid `duesCategory` (400, not a silent default).
- **Self-targeting.** This is the one adversarial finding that matters here: **members must not be able to set their own membership type.** A member self-declaring "Honorary" or "Life" would attempt to dodge dues billing and (per LCI norms) voting eligibility. I confirmed `/members/profile` (self-service) exposes neither `membershipStatus` nor `duesCategory` today — this field must follow the same admin-only precedent, and the API route must independently re-check `MEMBERS_EDIT` server-side (not rely on the field being merely absent from the self-service form), exactly as the existing route already does for `membershipStatus`.

## Permissions

- **Permission(s):** Existing `FEATURES.MEMBERS_EDIT` (write) and `FEATURES.MEMBERS_VIEW` (read) — no new key. Flagged open question above re: whether `DUES_MANAGE` should gate it instead, given the `duesCategory` precedent.
- **Default roles:** Unchanged — whatever already holds `MEMBERS_EDIT`/`MEMBERS_VIEW`.

## Dues and Per-Capita Consequences (concrete answer to the treasurer's question)

Per-capita tax today is **one manual annual ledger line** ("Per-capita tax," merging LCI dues + District dues + new-member entrance fees — `docs/work-log/2026-08-05-fy2026-budget-committee-review.md:62`), entered from the LCI invoice, not derived from the roster anywhere in code. I found no per-capita computation logic in `src/lib/ledger.ts` or elsewhere — the discounts LCI actually applies by type (Life exempt; Family half-after-first; Student/Leo half-or-none) are **documented as intent** in the original feature spec (`docs/features/the-ledger-accounting.md:198`) but were **never implemented**. This is exactly why the FY2026 budget committee had to ask what that per-capita line actually comprised — nobody can currently decompose it by member.

**Yes, this field is the prerequisite that makes that number derivable** — count members by `membershipType`, apply the known per-type discount rules, multiply by the published LCI/District per-member rate — but **building that derivation is a separate, follow-up Ledger feature**, not part of this one. Shipping `membershipType` alone doesn't compute anything; it just makes the input data exist. I recommend this Phase 1 scope stop at the field itself and its backfill, with the per-capita worksheet named explicitly as the payoff and filed as a follow-up (see Out of Scope).

Separately: `duesCategory` (individual/family) is the club's own **local** dues rate and is orthogonal to LCI per-capita by type — a Life Member (type) could still be `duesCategory='individual'` for local club-dues purposes if the club charges Life Members local dues (LCI exemption is for the *international* per-capita tax, not necessarily local dues — this is a club-bylaws question, not something I can resolve from code). Flagged as an open question below.

## Validation

Closed taxonomy, app-layer enforcement only — following the `BUDGET_CAUSES`/`isValidBudgetCause()` precedent in `src/lib/ledger.ts:569-602` and DECISION-041's explicit precedent against DB `CHECK` constraints on status-like text columns. Recommend a parallel `MEMBERSHIP_TYPES` const array + `isValidMembershipType()` helper, values: `active | member_at_large | honorary | privileged | life | associate | affiliate` (snake_case tokens; the treasurer's misspelling "priviledged" corrected to LCI's actual "Privileged" in both the UI label and the stored value).

## Migration / Backfill

Default **`active`** for all 50 existing rows (not null — a closed-taxonomy text column with app-layer-only enforcement should never carry a null the way `BUDGET_CAUSES` values never do; a wrong-but-plausible default is safer than a null every downstream read has to guard against). `active` is the correct default per LCI's own semantics (it's the base/default type absent any other designation), and matches the fact that nothing in the current data lets us infer who's actually Life/Honorary/Associate/Affiliate/Privileged/Member-at-Large. **This default is very likely wrong for at least a few of the 50** — long-tenured members are commonly moved to Life status, and any past District officers could be Honorary. The treasurer must review the list post-backfill and hand-correct individual records; I cannot infer this from data that doesn't exist anywhere in this system.

## Gaps the Request Didn't Address

- **Directory / roster visibility.** The request doesn't say whether members (or the public) should ever see this field. I recommend admin-only — not shown on the interactive `/members` directory (`member-directory.tsx`) or the printed roster (`member-directory-print.tsx`, shipped v1.57.0, which currently renders name/position/email/phone/address only) — matching that `duesCategory` and the fine-grained parts of `membershipStatus` are already admin-only today. **Needs explicit confirmation** — it's plausible the treasurer wants "Life Member" to appear as a badge of honor in the printed roster, which would be a real (if small) UI addition, not a rubber stamp.
- **Exclusion from directory/roster/dues/voting.** The request explicitly asks this. I found no quorum/voting feature anywhere in the codebase (`grep -ri quorum` returns nothing), so voting exclusion is moot today. Directory/roster today gate on `membershipStatus` (active/prospective), not type — I recommend **no** type-based exclusion from the directory (an Honorary or Life member is still a club member) unless the treasurer says otherwise. Dues-run exclusion is a live, unresolved question: `dues-queries.ts` currently scopes expected-dues calculations to `is_active = true` (club standing only) — should a `membershipType='life'` or `'honorary'` member with `membershipStatus='active'` be excluded from the club's own local dues run? This is a bylaws question I can't answer from code.
- **Whether the field should feed per-capita billing.** Addressed above — yes as a future payoff, no as part of this feature's scope.

## Out of Scope (confirm with user)

- A per-capita derivation worksheet/report that multiplies membership-type counts by LCI/District rates and reconciles against the manual "Per-capita tax" ledger line. This is the natural next Ledger increment this field enables, but it's a distinct feature (new UI, rate-table data entry, discount-rule logic) and shouldn't be bundled into shipping the field itself.
- Any change to `scripts/sync-roster.ts` — it needs its own bug-fix pass (the `userId`/`memberId` mismatch found above) independent of this feature, and even fixed, the current LCI CSV export format this club uses carries no type column to sync from.
- Any member-facing display of the field (directory badge, printed-roster tag) beyond admin — pending the open question above.
- Bulk CSV import/export of membership type (the request only asks to add the field to the member record, not a bulk tool).

## Open Questions

1. Should `membershipType` be gated by `MEMBERS_EDIT` (broader — same people who edit status) or `DUES_MANAGE` (narrower — treasurer only), given its billing/per-capita implications and the precedent that `duesCategory` already uses the narrower gate?
2. Should any membership types be excluded from the internal Google Group sync (e.g., Affiliate members who belong primarily to another club)?
3. Should any membership types be excluded from the club's own local dues run (separate from LCI per-capita, which is a club-bylaws question, not a code question)?
4. Should the type ever be visible to members (directory) or only in admin — and specifically, should it appear on the printed roster as a badge (e.g., "Life Member")?
5. Of the 41 current `active`-status / 9 `ended`-status members, does the treasurer already know of specific individuals who are Life, Honorary, Associate, Affiliate, Privileged, or Member-at-Large, to hand-correct immediately after the `active`-default backfill runs, rather than leaving it to a slow drift of individual edits?
6. Does the club's local dues line ever differ from LCI per-capita eligibility for Life/Honorary members — i.e., are Life Members still billed the club's own individual/family dues rate today, and should that continue?

---

# Phase 2 — Architectural Review (architect)

## Verdict

[Approved | Approved with suggestions | Needs revision]

## Placement

- Directory placement: [src/...]
- Server vs Client split: [where 'use client' is needed and why]
- Dependencies: [new dep needed (yes/no), evaluation against criteria]

## Invariants Touched

- [Invariant, how this change respects it (or how it changes it — requires CLAUDE.md update)]

## Notes

[Anything Phase 3 must honor.]

---

# Phase 3 — Technical Design (tech-lead)

## Summary

We're adding one new admin-only, closed-taxonomy text column — `membershipType` — to the `members`
table, recording each member's Lions International membership type (Active, Member at Large, Honorary,
Privileged, Life Member, Associate Member, Affiliate Member) as a third axis alongside the existing
`membershipStatus` (club standing) and `duesCategory` (billing rate). It backfills every one of the 50
current members to `active` once, idempotently, without ever overwriting a treasurer's later correction.
It is edited on the existing member edit form (`member-form.tsx`) next to Membership Status, gated by the
same `FEATURES.MEMBERS_EDIT` permission that already governs that form, and is deliberately not wired into
dues, billing, Google Group sync, or any other logic — per Treasurer Decision 1, this increment ships the
field and its backfill only. See DECISION-064 for the four implementation calls this design makes (token
format, const location, permission gate, UI surface) and their rationale.

## Permissions

- Permission key: **`members.edit`** (`FEATURES.MEMBERS_EDIT`) for writes — reused, no new key. Reads are
  gated by the surrounding page's existing `FEATURES.MEMBERS_EDIT` check (the admin members list at
  `src/app/(dashboard)/admin/members/page.tsx:28` already requires `MEMBERS_EDIT` to view the list at all,
  and the `[id]` edit page has no separate view-only mode — so there is no `MEMBERS_VIEW`-only reader of
  this field to reason about in this increment).
- Default role bindings: unchanged. Whatever roles already hold `MEMBERS_EDIT` (Admin, and any
  membership-secretary-style role bound to it) get write access automatically. No role-binding migration
  needed — see DECISION-064 item 3 for why this reuses `MEMBERS_EDIT` rather than the narrower
  `DUES_MANAGE` that gates `duesCategory`.
- Server-side re-check is mandatory on the write path exactly like `membershipStatus` today (Phase 1 Pass
  5 adversarial finding: members must never be able to set their own type) — enforced by `PATCH
  /api/admin/members/[id]` calling `hasFeature(session.user.id, FEATURES.MEMBERS_EDIT)` before touching
  the DB, same as it does today at `src/app/api/admin/members/[id]/route.ts:34`.

## API Contract

No new routes. Extends the two existing member-record endpoints, both already gated by `MEMBERS_EDIT`:

- **`POST /api/admin/members`** (`src/app/api/admin/members/route.ts`) — request body gains an optional
  `membershipType` field. If omitted or invalid, defaults to `"active"` (matching the schema column
  default and the "every member effectively has a type" invariant — no null path on create). If present
  and off-taxonomy, the request fails with `400 { error: "membershipType must be one of: active,
  member_at_large, honorary, privileged, life_member, associate_member, affiliate_member" }` — same shape
  and wording style as the existing `duesCategory` route's rejection message
  (`src/app/api/admin/dues/[memberId]/category/route.ts:52`).
- **`PATCH /api/admin/members/[id]`** (`src/app/api/admin/members/[id]/route.ts`) — request body gains an
  optional `membershipType`. Same validation: invalid/off-taxonomy value → `400` with the message above.
  Unlike `membershipStatus` on this same route (which silently falls back to the existing value on an
  invalid submission, `route.ts:78-82`, because it's client-submitted alongside a server-derived
  `isActive` that must stay in sync), `membershipType` has no derived sibling value to protect — so an
  invalid submission is a hard `400`, not a silent fallback. This also matches the `duesCategory` route's
  behavior (hard rejection, not fallback) more closely than the `membershipStatus` field on this same route
  does, since both `duesCategory` and `membershipType` are simple standalone enums with no invariant to
  preserve on bad input.
- No `GET` changes — `GET /api/admin/members` already `select()`s all columns
  (`src/app/api/admin/members/route.ts:38`), so `membershipType` is included automatically once it exists
  in `schema.ts`.

## Data Model

New column on `members` (`src/lib/db/schema.ts`, in the existing `members` table definition, immediately
after `duesCategory` at line 44):

```typescript
duesCategory: text("dues_category").notNull().default("individual"), // 'individual' | 'family'
// LCI membership TYPE (Active, Member at Large, Honorary, Privileged, Life Member, Associate
// Member, Affiliate Member) — see MEMBERSHIP_TYPES in src/lib/members.ts. This is NOT club
// standing (that's membershipStatus, above) and NOT a billing rate (that's duesCategory, above).
// A member can be type 'life_member' with status 'active', or type 'active' with status 'ended'
// (an ordinary member who resigned) — the two fields vary independently. No DB CHECK constraint —
// app-layer enforcement only via isValidMembershipType(), consistent with membershipStatus and
// duesCategory on this same table (DECISION-041).
membershipType: text("membership_type").notNull().default("active"),
```

- **Nullability:** `NOT NULL` with a `DEFAULT 'active'` — matching `membershipStatus`/`duesCategory`'s own
  shape on this table, not a nullable column. A closed-taxonomy field with app-layer-only validation should
  never carry a null every downstream reader has to guard against (Phase 1's own recommendation).
- **No index.** Nothing filters or joins on this column yet (no dues/billing/sync consumer exists by
  design). If the future per-capita derivation feature needs to `GROUP BY membership_type`, that's a
  sequential scan over ~50-a-few-hundred rows — add an index then if it's ever warranted, not speculatively
  now.
- **No new tables, no FK.** Phase 2 explicitly pre-empted any pressure to model this as its own
  reference table with a foreign key — stop and escalate to Phase 2 if Phase 4 finds a reason to reconsider
  that (see the Phase 2 skip rationale at the bottom of this work-log). A flat text column is the right
  shape here for the same reason it's right for `membershipStatus` and `duesCategory`: seven fixed values,
  no per-value metadata beyond a display label, no need for referential integrity.

### Taxonomy constant — `src/lib/members.ts`

Placed next to the existing `MembershipStatus` type and its pure helpers (`isActiveForStatus()`,
`shouldProvisionOnMemberCreate()`), not in `src/lib/ledger.ts` next to `BUDGET_CAUSES` — see DECISION-064
item 2 for why. Stored values are lowercase `snake_case` tokens, not the literal display label — see
DECISION-064 item 1 for why this diverges from the `BUDGET_CAUSES` precedent (which stores literal
display strings) and instead follows a `{ value, label }` shape mirroring `member-form.tsx`'s own
`STATUS_OPTIONS` pattern:

```typescript
export type MembershipType =
  | "active"
  | "member_at_large"
  | "honorary"
  | "privileged"
  | "life_member"
  | "associate_member"
  | "affiliate_member";

export const MEMBERSHIP_TYPES: { value: MembershipType; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "member_at_large", label: "Member at Large" },
  { value: "honorary", label: "Honorary" },
  { value: "privileged", label: "Privileged" },
  { value: "life_member", label: "Life Member" },
  { value: "associate_member", label: "Associate Member" },
  { value: "affiliate_member", label: "Affiliate Member" },
];

/** Server-side gate for any membershipType value written to members.membership_type. */
export function isValidMembershipType(value: string): value is MembershipType {
  return (MEMBERSHIP_TYPES as { value: string }[]).some((t) => t.value === value);
}
```

Note the deliberate naming distance from `membershipStatus`'s value `'active'`: the type token `'active'`
and the status token `'active'` are the same string by coincidence of LCI vocabulary, but they live in
different columns and are never compared to each other in code — the collision risk Phase 1 flagged is a
*UI-copy* risk ("Status: Active" next to "Type: Active" reading as redundant), not a data risk, and is
handled by the field labels below, not by picking a different token.

### Migration — `drizzle/migrations/0073_members_membership_type.sql`

Next number after `0072_ledger_txn_budget_line.sql` (the most recent file in `drizzle/migrations/`).
Two statements, both idempotent on every re-run:

```sql
-- Membership Type (docs/work-log/2026-08-07-membership-categories.md)
-- Adds membership_type: the LCI membership TYPE (Active, Member at Large, Honorary, Privileged,
-- Life Member, Associate Member, Affiliate Member) — orthogonal to membership_status (club
-- standing) and dues_category (billing rate). See src/lib/members.ts MEMBERSHIP_TYPES for the
-- closed taxonomy. No DB CHECK constraint — app-layer enforcement only (DECISION-041 precedent).

ALTER TABLE members ADD COLUMN IF NOT EXISTS membership_type text NOT NULL DEFAULT 'active';

-- One-time backfill: every existing row that has never been touched by this migration gets
-- 'active'. The guard is NOT "membership_type IS NULL" (the column is NOT NULL with a DEFAULT, so
-- ADD COLUMN already back-fills every existing row to 'active' in the same statement above — there
-- is never a null to find). Instead this UPDATE is a documented no-op after its first successful
-- run: on a fresh column, every row is already 'active' (from the column default), so
-- "WHERE membership_type <> 'active'" matches zero rows; a re-run after a treasurer has since
-- hand-corrected some rows to 'life_member'/'honorary'/etc. also matches zero of THOSE rows,
-- because the condition only ever matched rows equal to 'active' in the first place. This mirrors
-- 0061_members_membership_status.sql's own backfill shape (an UPDATE guarded by an inequality, run
-- unconditionally on every deploy, safe because it can only ever act on rows it would set to the
-- same value they already hold post-ADD-COLUMN).
UPDATE members SET membership_type = 'active' WHERE membership_type IS NULL;
```

**Why this is safe against overwriting a hand correction, spelled out:** `ADD COLUMN ... NOT NULL DEFAULT
'active'` only ever runs its backfill semantics once — the *first* time the column doesn't yet exist. On
every subsequent deploy, `ADD COLUMN IF NOT EXISTS` is a no-op (the column is already there, already
populated, already possibly hand-corrected by the treasurer), so nothing in this migration file touches
existing rows again. The trailing `UPDATE ... WHERE membership_type IS NULL` is a belt-and-suspenders
guard for the theoretical case of a column added out-of-band without the default somehow applying (it
can't happen through this migration, but costs nothing to guard) — it can never match a hand-corrected row
because a hand-corrected row is by definition not null. **The column is never nullable and the `UPDATE`
predicate can never match a treasurer's correction — the only two states a row can be in after the
column exists are "still the default `active`" or "some other explicit value someone wrote," and this
migration never touches the second state.**

## Component / Page Plan

- Pages to create: none.
- Components to create: none — extends existing components.
- Files to modify:
  - `src/lib/db/schema.ts` — add the `membershipType` column (database-admin).
  - `drizzle/migrations/0073_members_membership_type.sql` — new file (database-admin).
  - `src/lib/members.ts` — add `MembershipType`, `MEMBERSHIP_TYPES`, `isValidMembershipType()`
    (database-admin, since it lands in the same commit as the schema/migration and has no DB call —
    or api-developer if handed off separately; see Implementation Order).
  - `src/app/api/admin/members/route.ts` (POST) — accept, validate, default `membershipType`
    (api-developer).
  - `src/app/api/admin/members/[id]/route.ts` (PATCH) — accept, validate, persist `membershipType`
    (api-developer).
  - `src/components/admin/member-form.tsx` — add `membershipType: MembershipType` to
    `MemberFormData`, add `TYPE_OPTIONS` (mirroring `STATUS_OPTIONS`), add a `<select>` in the "Club
    Information" section immediately after the existing Membership Status `<select>` (`member-form.tsx:449-475`),
    labelled **"Membership Type"** (never bare "Category" or "Type" alone — Phase 1's explicit
    labeling-discipline requirement) with a one-line helper caption distinguishing it from Status, e.g.
    *"LCI membership type (Life, Honorary, etc.) — separate from Membership Status above."*
    (ux-developer).
  - `src/app/(dashboard)/admin/members/[id]/page.tsx` — pass `member.membershipType` into the
    `MemberFormData` object built at line 30-45, alongside the existing `membershipStatus` line
    (ux-developer).
  - `src/app/(dashboard)/admin/members/new/page.tsx` — no change needed; `MemberForm`'s own
    `useState` default (`membershipType: "active"`) already covers the create path.

No change to `src/app/(dashboard)/admin/members/page.tsx` (the list table) in this increment — see
DECISION-064 item 4 for the tradeoff. No change to `src/lib/ledger.ts`, `src/lib/dues-queries.ts`,
`src/lib/google-groups.ts`, `member-directory.tsx`, `member-directory-print.tsx`, or `/members/profile` —
all explicitly out of scope per Treasurer Decisions 1–2.

## Implementation Order

1. **Schema + migration** — `src/lib/db/schema.ts` (add `membershipType` column) and
   `drizzle/migrations/0073_members_membership_type.sql` (idempotent `ADD COLUMN` + belt-and-suspenders
   backfill guard, as specified above). **database-admin.**
2. **Taxonomy constant** — `MembershipType`, `MEMBERSHIP_TYPES`, `isValidMembershipType()` in
   `src/lib/members.ts`. No DB call, pure and unit-testable like its `MembershipStatus` neighbors —
   database-admin can add this in the same pass as the schema change since it's the type the schema
   comment references, or hand it to api-developer as the first item of Phase 4b if the split is cleaner
   that way. **Handoff point: database-admin → api-developer once schema.ts + migration + taxonomy
   constant are committed and `pnpm db:migrate` has been run locally.**
3. **API validation** — extend `POST /api/admin/members` and `PATCH /api/admin/members/[id]` to accept,
   validate against `isValidMembershipType()`, and persist `membershipType`, per the API Contract above.
   **api-developer.**
4. **UI** — `member-form.tsx` (`TYPE_OPTIONS` + `<select>` + `MemberFormData` type), `[id]/page.tsx`
   (thread `membershipType` into the server-fetched `formData`). **Handoff point: api-developer →
   ux-developer once both routes accept and validate `membershipType`, so the UI never has to guess at
   the wire contract.** **ux-developer.**
5. **No email notification** — Phase 1 confirmed this is an internal bookkeeping change, not a
   member-facing event; no `sendEmail()` call anywhere in this feature.
6. **Release notes entry** — written via `/release-notes` when this merges to main, per standard process.
   Framed as an admin/treasurer-facing capability ("Membership Type tracking"), not implementation detail.

No permissions-migration step (step 2 in the generic template) — this reuses `FEATURES.MEMBERS_EDIT`
verbatim, no new `FEATURES` key, no role-binding migration.

## Edge Cases & Risks

- **Null post-backfill.** Shouldn't exist — the column is `NOT NULL DEFAULT 'active'`, so every row,
  including any row inserted between the schema change and the migration's completion, gets a value with
  no application code involved. If a future direct-SQL script somehow inserts a row bypassing the default
  (unlikely — Postgres always applies `NOT NULL`/`DEFAULT` on `INSERT` unless the column is explicitly
  set to an out-of-taxonomy string), the UI's `TYPE_OPTIONS.find()` would fail to resolve a label; treat
  that as equivalent to the next bullet.
- **Off-taxonomy legacy value.** Can only arise from a direct DB write that bypasses both the API's
  `isValidMembershipType()` gate and the column default (e.g., a manual `UPDATE ... SET membership_type =
  'foo'` run outside this app). The API route always rejects it on the next `PATCH` attempt (`400`), but a
  read path (the `<select>` in `member-form.tsx`) would render with no matching `<option>` selected —
  same graceful-degradation behavior the existing `STATUS_OPTIONS` `<select>` already has for an
  unrecognized `membershipStatus`, so no new handling is required beyond what the pattern already
  provides. Not expected to occur through any code path this feature ships.
- **Status changes to `ended`.** Per Treasurer Decision 1 and Phase 1's Gap analysis, `membershipType` is
  explicitly untouched by any `membershipStatus` transition — an ended member keeps whatever type they
  last had (e.g., a Life Member who passes away or resigns stays recorded as `life_member` with
  `membershipStatus: 'ended'`, which is correct for historical/LCI-reporting purposes and matches how
  `duesCategory` also survives a status change unmodified today, `route.ts:92-113`). No code change
  needed to preserve this — simply don't add any coupling between the two fields' write paths.
  **Explicit non-goal, called out so Phase 4 doesn't "helpfully" add a reset-to-active-on-ended rule.**
- **The 41 backfilled `active` rows are a known-wrong placeholder for some subset of members**
  (long-tenured members are commonly Life Members; past District officers may be Honorary) — this is
  intentional per Treasurer Decision 3, not a bug to fix in this feature. Phase 6 should confirm the
  treasurer has a path to review and hand-correct post-ship, not that the backfill was "accurate."
- **Concurrent edit race on the migration's `UPDATE`.** Because the guard is an inequality against the
  literal default value (not a boolean "already ran" flag), there's no window where a treasurer's
  in-flight `PATCH` could race the migration's `UPDATE` into a wrong state — the migration only ever
  writes `'active'` to rows that are already `'active'`, so even a same-millisecond race resolves to the
  same value either order.

## Unit Tests (Phase 4 — implementer delivers these, not qa)

All in `src/lib/members.test.ts`, alongside the existing `describe("isActiveForStatus", ...)` blocks:

1. **`isValidMembershipType` — accepts every taxonomy value.** Asserts each of the 7
   `MEMBERSHIP_TYPES` values (`active`, `member_at_large`, `honorary`, `privileged`, `life_member`,
   `associate_member`, `affiliate_member`) returns `true`.
2. **`isValidMembershipType` — rejects off-taxonomy values.** Asserts `false` for an empty string,
   `"life"` (the un-suffixed near-miss), `"Life Member"` (the display label instead of the token),
   `undefined`/non-string input coerced to string, and an arbitrary garbage string.
3. **`isValidMembershipType` — does not accept `membershipStatus`'s `'active'` as a type-confusion
   trick.** Explicitly documents that `'active'` IS valid for `isValidMembershipType` (it's genuinely in
   the type taxonomy too) — this test exists to make the intentional overlap visible in the test file
   itself, not to reject it, so a future reader doesn't "fix" it as a bug.
4. **Migration backfill idempotency (integration-style, run against a test/scratch DB or as a
   database-admin script check, not a pure Vitest unit test).** Assert: (a) running
   `0073_members_membership_type.sql` twice in a row on a fresh table leaves all rows `'active'`; (b)
   hand-setting one row to `'life_member'` and then re-running the migration file leaves that row
   `'life_member'`, not reverted to `'active'`. This is the concrete regression guard for the "never
   stomps a treasurer correction" claim above — database-admin should add it as part of Phase 4 schema
   work (likely as a documented manual verification step or a script under `scripts/`, since this
   project's Vitest suite doesn't appear to run migrations against a live DB elsewhere — confirm the
   existing pattern, if any, before inventing a new one).
5. **Permission gate on the write path (route-level, api-developer's Phase 4 test).** Asserts
   `PATCH /api/admin/members/[id]` with a valid `membershipType` in the body returns `403` for a session
   lacking `MEMBERS_EDIT`, mirroring however the existing `membershipStatus` write-path permission check
   is (or isn't yet) covered by a route-level test today — if no such test exists yet for
   `membershipStatus`, add this as the first one and note the gap rather than skipping it silently.
6. **API validation rejection shape.** Asserts `PATCH /api/admin/members/[id]` with
   `membershipType: "not_a_real_type"` returns `400` with the exact error string specified in the API
   Contract section above (`"membershipType must be one of: active, member_at_large, honorary,
   privileged, life_member, associate_member, affiliate_member"`), and that the member row is left
   unchanged.

## Implementer

**Specialist split**, not full-stack-developer — this touches schema, a migration, two API routes, and a
client form across 6 files with a natural three-way seam (schema/migration → API validation → UI), the
same shape every prior Ledger increment used. Estimated total diff is small, but the seams are clean and
each phase's test obligations differ (a migration-idempotency check vs. a route `400`/`403` test vs. a
form field), so a handoff loses less than it would on a genuinely tangled ~50-line change.

1. **database-admin** — schema column, migration file, and the `src/lib/members.ts` taxonomy constant
   (steps 1–2 above).
2. **api-developer** — `POST`/`PATCH /api/admin/members(/[id])` validation and persistence, plus the
   route-level permission/validation unit tests (steps 3, test items 5–6).
3. **ux-developer** — `member-form.tsx` field, `MemberFormData` type, `[id]/page.tsx` wiring, plus the
   pure `isValidMembershipType()` unit tests if not already delivered by database-admin/api-developer
   (steps 4, test items 1–3).

---

# Phase 4 — Implementation (schema) — 2026-08-07

**Owner:** database-admin
**Status:** complete

### Summary

Added the `membership_type` column to `members` (`NOT NULL DEFAULT 'active'`) with an inline schema
comment distinguishing it from `membershipStatus`, wrote the idempotent migration
`0073_members_membership_type.sql`, added the `MembershipType`/`MEMBERSHIP_TYPES`/
`isValidMembershipType()` taxonomy to `src/lib/members.ts` next to `MembershipStatus`, and wrote the
Phase 3-named unit tests plus the migration re-run verification against the dev DB. Built exactly to
the Phase 3 spec and DECISION-064 — no divergence.

### What I did

- Confirmed `0073` is genuinely the next free migration number (`ls drizzle/migrations/*.sql | sort
  | tail` showed `0072_ledger_txn_budget_line.sql` as the latest).
- Added `membershipType: text("membership_type").notNull().default("active")` to `members` in
  `src/lib/db/schema.ts`, positioned immediately after `duesCategory`, with the exact distinguishing
  comment block specified in the design doc (calls out it is neither `membershipStatus` nor
  `duesCategory`, gives the life_member/active-status-ended example, notes no DB CHECK constraint
  per DECISION-041).
- Wrote `drizzle/migrations/0073_members_membership_type.sql`: `ALTER TABLE members ADD COLUMN IF
  NOT EXISTS membership_type text NOT NULL DEFAULT 'active';` followed by the belt-and-suspenders
  `UPDATE members SET membership_type = 'active' WHERE membership_type IS NULL;` guard. Both
  statements are idempotent independently and in combination.
- Added `MembershipType`, `MEMBERSHIP_TYPES` (`{ value, label }[]`, 7 entries, LCI's "Privileged"
  spelling), and `isValidMembershipType()` to `src/lib/members.ts`, immediately before the
  `resolveJoinDate` block, following the same pure/DB-call-free shape as the neighboring
  `MembershipStatus` helpers.
- Wrote all Phase-3-named unit tests in `src/lib/members.test.ts` (`describe("isValidMembershipType",
  ...)`, 9 `it` blocks): accepts every taxonomy value, every value has a non-empty label with no
  duplicates, rejects empty string, rejects `"life"` (un-suffixed near-miss), rejects `"Life
  Member"` (display-label form), rejects `"priviledged"` (the misspelling), rejects
  `String(undefined)`/`String(null)`, rejects an arbitrary garbage string, and an explicit test
  documenting that `'active'` IS valid (the intentional status/type token overlap), so a future
  reader doesn't "fix" it as a bug.
- Verified re-run safety against the **dev** DB (`DATABASE_URL` in `.env.local`, not
  `PROD_DATABASE_URL` — never touched production):
  1. Confirmed `membership_type` did not yet exist on the dev `members` table (`\d members`).
  2. Ran `pnpm db:migrate` (full replay of all migrations, matching the real deploy pipeline) — column
     appeared, all 48 dev rows defaulted to `active`.
  3. Hand-corrected one row to `life_member` directly in SQL (simulating a treasurer edit).
  4. Re-ran `pnpm db:migrate` a second time — the hand-corrected row was still `life_member`; all
     other rows still `active` (47 `active` / 1 `life_member`).
  5. Ran `pnpm db:migrate` a third time as an extra check — same result, unchanged.
  This directly confirms the critical property named in the task: **a re-run never overwrites a
  value the treasurer has hand-corrected.** The reasoning holds because `ADD COLUMN IF NOT EXISTS`
  is a no-op after the first run (the column already exists, already populated), and the trailing
  `UPDATE ... WHERE membership_type IS NULL` can never match a hand-corrected row because the
  column is `NOT NULL` — a hand-corrected row is by definition non-null, so the predicate never
  touches it.
- Did not touch `scripts/` (hard constraint honored) and did not wire `membershipType` into any dues
  logic (hard constraint honored — no changes outside `schema.ts`, the migration, `members.ts`, and
  `members.test.ts`).

### Gates

- `pnpm exec tsc --noEmit`: **PASS**, clean, no errors.
- `pnpm test`: **PASS**, 967 passed (40 test files) — baseline was 958, +9 new tests
  (`isValidMembershipType` suite), zero regressions.
- `pnpm build:only`: **PASS**, production build completed with no errors; all routes listed
  including `/api/admin/members` and `/api/admin/members/[id]`.

### Outputs

- `src/lib/db/schema.ts` — `membershipType` column added to `members`, after `duesCategory`.
- `drizzle/migrations/0073_members_membership_type.sql` — new file, two idempotent statements
  (`ADD COLUMN IF NOT EXISTS` + `WHERE membership_type IS NULL` backfill guard), verified safe to
  re-run any number of times without disturbing hand-corrected rows (see verification above).
- `src/lib/members.ts` — new exports: `MembershipType` (type), `MEMBERSHIP_TYPES` (7-entry
  `{ value, label }[]`), `isValidMembershipType()` (type-guard validator).
- `src/lib/members.test.ts` — new `describe("isValidMembershipType", ...)` block, 9 tests, all
  passing.
- No role-binding or seed-row changes — reuses existing `FEATURES.MEMBERS_EDIT`, no new `FEATURES`
  key per DECISION-064 item 3.
- Local apply command used: `export $(grep -E "^DATABASE_URL=" .env.local | xargs) && pnpm
  db:migrate` (run three times against dev for verification, per above). `pnpm build:only` also run
  clean (does not touch the DB per its definition in `CLAUDE.md`).

### Open questions / handoff notes

- **Next agent: api-developer.** Extend `POST /api/admin/members`
  (`src/app/api/admin/members/route.ts`) and `PATCH /api/admin/members/[id]`
  (`src/app/api/admin/members/[id]/route.ts`) to accept, validate via `isValidMembershipType()`, and
  persist `membershipType`, per the API Contract in the Phase 3 design above. `POST` defaults to
  `"active"` on omit/invalid; `PATCH` hard-rejects an invalid value with `400` (no silent fallback,
  unlike `membershipStatus` on the same route) using the exact message: `"membershipType must be one
  of: active, member_at_large, honorary, privileged, life_member, associate_member,
  affiliate_member"`.
- Route-level tests (Phase 3 unit test items 5–6: `403` on missing `MEMBERS_EDIT`, `400` + exact
  message + unchanged row on invalid value) are api-developer's to write, not mine — flagged in the
  design doc as api-developer's Phase 4 deliverable.
- `membershipType` is available in `schema.ts` now; `GET /api/admin/members` will include it
  automatically once the schema push happens (no route change needed there).
- New column: `members.membership_type` (`text`, `NOT NULL`, default `'active'`). No FK, no index
  (per design — nothing filters/joins on it yet). No CHECK constraint (app-layer only,
  `isValidMembershipType()`).
- Taxonomy for api-developer/ux-developer to import: `import { MEMBERSHIP_TYPES,
  isValidMembershipType, type MembershipType } from "@/lib/members";`.
- Dev DB now has one row hand-set to `life_member` (from my re-run verification) — this is
  expected/inert test data, not a real treasurer correction; flagging so nobody mistakes it for
  seeded intent. Production is untouched (never pointed at `PROD_DATABASE_URL`).

---

# Phase 4 — Implementation (API) — 2026-08-07

**Owner:** api-developer
**Status:** complete

### Summary

Extended `POST /api/admin/members` and `PATCH /api/admin/members/[id]` to accept, validate, and
persist `membershipType`, exactly per the Phase 3 API Contract and DECISION-064. `POST` defaults an
omitted or off-taxonomy value to `"active"`; `PATCH` hard-rejects an invalid or omitted value with a
`400` and no fallback (unlike `membershipStatus` on the same route). Both routes remain gated by
`FEATURES.MEMBERS_EDIT` only — `membershipType` was never wired into `DUES_MANAGE`, any dues run,
dues-eligibility query, billing surface, or member-count logic. Wrote all route-level tests named for
this phase plus two extra regression/positive cases. No divergence from the design doc.

### What I did

- Read the full Phase 3 design doc (API Contract, Data Model, Unit Tests sections), DECISION-064, and
  the Phase 4 (schema) handoff notes before touching any route.
- Confirmed `src/lib/members.ts` already exports `MembershipType`, `MEMBERSHIP_TYPES`,
  `isValidMembershipType()` from database-admin's Phase 4 work — imported these directly, added no
  duplicate taxonomy.
- `src/app/api/admin/members/route.ts` (`POST`): added `isValidMembershipType`/`MembershipType` to the
  existing `@/lib/members` import; added a `membershipType` derivation mirroring the existing
  `membershipStatus` default-on-omit pattern (`isValidMembershipType(data.membershipType) ?
  data.membershipType : "active"`); included `membershipType` in the `db.insert(members).values({...})`
  call.
- `src/app/api/admin/members/[id]/route.ts` (`PATCH`): added the same imports plus `MEMBERSHIP_TYPES`
  (to build the rejection message from the taxonomy array itself, so the error string can never drift
  from the actual list of valid values); added a `MEMBERSHIP_TYPE_ERROR` constant built via
  `` `membershipType must be one of: ${MEMBERSHIP_TYPES.map(t => t.value).join(", ")}` `` — this
  produces the exact string the design doc specifies, in the same order `MEMBERSHIP_TYPES` is defined;
  inserted a hard-`400` validation block *before* any `db.update` call (right after the email-conflict
  check, before the `membershipStatus`/`isActive` derivation), so an invalid submission can never mutate
  the row even indirectly; added `membershipType` to the `db.update(members).set({...})` call.
- Interpreted "optional... hard 400, not silent fallback" from the design doc as: `isValidMembershipType()`
  gates the value unconditionally on `PATCH` — an **omitted** `membershipType` is treated the same as an
  off-taxonomy one (both fail the type guard and 400) rather than falling back to the existing DB value.
  This reads the design's explicit contrast with `membershipStatus`'s fallback behavior literally ("no
  derived sibling to protect... hard 400, not a silent fallback") and is the only interpretation that
  can't silently drop a treasurer's intended value. Flagging this as an explicit interpretation call
  since the design doc's wording ("optional") could be read two ways — see Open questions below.
- Verified `membershipType` is genuinely absent from every dues/billing/eligibility/Google-Group-sync
  code path (`dues-queries.ts`, `google-groups.ts`, `ledger.ts`) — did not touch any of them, confirming
  the hard constraint rather than assuming it.
- Wrote route-level tests in two new files:
  - `src/app/api/admin/members/[id]/route.test.ts` — 5 tests: 403 on missing `MEMBERS_EDIT`; 400 with
    the exact design-specified message + zero DB writes on an off-taxonomy value; 400 (no fallback) when
    `membershipType` is omitted entirely; successful `PATCH` persisting a valid value
    (`membershipType: "life_member"`), asserted via the mocked `db.update(members).set(...)` payload and
    the response body; a positive test confirming `"active"` is accepted (the intentional status/type
    token overlap, mirroring the existing pure-function test's same point at the route level).
  - `src/app/api/admin/members/route.test.ts` — 4 tests: 403 on missing `MEMBERS_EDIT`; defaults to
    `"active"` when `membershipType` is omitted; defaults to `"active"` on an off-taxonomy submitted
    value (create still succeeds, `201`, rather than rejecting); persists a valid explicitly-submitted
    value (`"honorary"`).
  - Both files mock `@/lib/auth`, `@/lib/permissions-server`, `@/lib/google-groups`, and `@/lib/db`
    (hermetic — importing the real `@/lib/db` throws without `DATABASE_URL`, matching the existing
    ledger route-test convention). `@/lib/members` is imported with `importOriginal()` so the real, pure
    `isValidMembershipType`/`MEMBERSHIP_TYPES`/`isActiveForStatus`/`shouldProvisionOnMemberCreate`/
    `shouldProvisionOnMemberUpdate`/`resolveJoinDate` all run for real; only `provisionUserForMember`
    (DB + email side effects unrelated to this field) is mocked out.
- Did not touch `scripts/`, did not touch the three files flagged as having unrelated uncommitted UI
  changes (`src/app/members/page.tsx`, `src/components/members/member-directory.tsx`,
  `src/components/members/print-directory-button.tsx`), did not commit or push, did not run anything
  against `PROD_DATABASE_URL`.

### Gates

- `pnpm exec tsc --noEmit`: **PASS**, clean, no errors.
- `pnpm test`: **PASS**, 976 passed (42 test files) — baseline was 967, +9 new tests (5 in
  `[id]/route.test.ts`, 4 in `route.test.ts`), zero regressions.
- `pnpm build:only`: **PASS**, production build completed with no errors; `/api/admin/members` and
  `/api/admin/members/[id]` both listed as dynamic routes.

### Outputs

- **`POST /api/admin/members`** — gate: `FEATURES.MEMBERS_EDIT` (unchanged). Request body gains
  optional `membershipType: string`. Behavior: `isValidMembershipType(data.membershipType) ?
  data.membershipType : "active"` — omitted or off-taxonomy values silently default to `"active"`; the
  create never fails on this field. Persisted on the new row; included in the `201` response body.
- **`PATCH /api/admin/members/[id]`** — gate: `FEATURES.MEMBERS_EDIT` (unchanged). Request body gains
  `membershipType: string`, validated unconditionally via `isValidMembershipType()` — an omitted value is
  treated the same as an invalid one (see interpretation note above). On failure: `400 { error:
  "membershipType must be one of: active, member_at_large, honorary, privileged, life_member,
  associate_member, affiliate_member" }`, row left completely unchanged (validation runs before any
  `db.update`). On success: persisted alongside the other fields, `200` with the updated row (including
  `membershipType`) in the response body.
- No `GET` changes — `GET /api/admin/members` already `select()`s all columns, so `membershipType` is
  included automatically.
- Files touched: `src/app/api/admin/members/route.ts`, `src/app/api/admin/members/[id]/route.ts`, new
  `src/app/api/admin/members/route.test.ts`, new `src/app/api/admin/members/[id]/route.test.ts`. No
  schema/migration changes (database-admin's Phase 4 already shipped those). No `FEATURES` /
  role-binding changes (reuses `MEMBERS_EDIT` verbatim per DECISION-064 item 3 — no new permission
  migration needed).
- Confirmed hard constraint honored: `membershipType` does not appear in `dues-queries.ts`,
  `google-groups.ts`, `ledger.ts`, or any member-count/eligibility query — grep-verified, not just
  asserted.

### Open questions / handoff notes

- **Next agent: ux-developer.** Add the `<select>` to `src/components/admin/member-form.tsx` per the
  Phase 3 Component/Page Plan: `TYPE_OPTIONS` mirroring `MEMBERSHIP_TYPES` (import `MEMBERSHIP_TYPES`,
  `type MembershipType` from `@/lib/members` directly rather than re-deriving), placed immediately after
  the existing Membership Status `<select>` in the "Club Information" section, labelled **"Membership
  Type"** with the one-line helper caption distinguishing it from Status. Also wire
  `member.membershipType` into the `MemberFormData` object built in
  `src/app/(dashboard)/admin/members/[id]/page.tsx` (the create page needs no change — `MemberForm`'s own
  `useState` default should be `membershipType: "active"`).
- **Wire-contract note for the UI:** the `PATCH` route now hard-rejects (`400`) if `membershipType` is
  missing from the request body at all — the form must always include the field on submit (matching how
  it already always submits `membershipStatus`, `firstName`, etc., since this route treats the body as a
  full-record replace, not a partial patch). If the UI ever adds a code path that PATCHes without
  loading the existing member into form state first, that path will now 400 on this field specifically.
- **Interpretation flag for review:** I read the design doc's "optional... hard 400, not silent
  fallback" as meaning an omission is *itself* rejected on `PATCH` (not defaulted, not passed through) —
  the alternative reading (fall back to the existing DB value on omission, but 400 only on an explicit
  invalid value) was available from the doc's literal "if present and off-taxonomy" wording. I chose the
  stricter reading because it can never silently drop a treasurer's value and it's what test item 6 (400
  + unchanged row) most directly supports, but flagging this explicitly in case qa or the next design
  pass disagrees.
- No `FEATURES` migration needed — reuses `MEMBERS_EDIT` verbatim, confirmed via DECISION-064 item 3.

---

# Phase 4 — Implementation (UI) — 2026-08-07

**Owner:** ux-developer
**Status:** complete

### Summary

Added the `membershipType` `<select>` to `member-form.tsx` immediately after Membership Status, wired
`member.membershipType` into the edit page's `MemberFormData`, and defaulted the create-form's local
state to `"active"`. One design deviation from the Phase 3 plan, discovered by the production build, not
assumed: `member-form.tsx` cannot import `MEMBERSHIP_TYPES`/`MembershipType` from `@/lib/members` the way
the design doc and api-developer's handoff note both specified, because `src/lib/members.ts` imports
`@/lib/db` at module scope (for `provisionUserForMember`), and `member-form.tsx` is a `"use client"`
component — that import would drag the Postgres client (`postgres` package, which needs Node's `tls`
module) into the browser bundle. `pnpm build:only` failed on exactly this (`Module not found: Can't
resolve 'tls'`) the first time I wired it per the doc's literal instruction. Fixed by hand-duplicating the
taxonomy as a local, exported `TYPE_OPTIONS` const in `member-form.tsx` — which is exactly the pattern
already used one field up: `MembershipStatus`/`STATUS_OPTIONS` are also a local duplicate in this same
file, not an import from `@/lib/members`, for what I now believe is the same reason. Added a drift-guard
unit test asserting the two lists stay byte-identical.

### What I did

- Read the full work-log (Phase 1 through both prior Phase 4 sections) and DECISION-064 before touching
  any file.
- `src/components/admin/member-form.tsx`:
  - Added a local `MembershipType` type and exported `TYPE_OPTIONS: { value, label }[]` (7 entries),
    hand-copied from `MEMBERSHIP_TYPES` in `src/lib/members.ts`, with an inline comment explaining why
    it isn't imported (see Summary) and pointing at the drift-guard test.
  - Added `membershipType: MembershipType` to the `MemberFormData` interface.
  - Defaulted `membershipType: "active"` in the create-path `useState` initializer (mirrors
    `membershipStatus: "active"` already there).
  - Added a `<select id="membershipType" name="membershipType" required>` in the "Club Information"
    section, immediately after the existing Membership Status `<select>`. Uses the existing
    `handleChange` wiring (name-keyed, same as every other field) so the PATCH body always includes
    `membershipType` — required per api-developer's handoff note that the route hard-`400`s on an
    omitted value.
  - Labelled it **"Lions International Membership Type *"** — not bare "Type" or "Category" and never
    "Active" as a heading — with a helper caption: *"The member's LCI membership category (e.g. Life,
    Honorary, Associate) — separate from Membership Status above, which tracks whether they're currently
    in good standing with the club."* Satisfies Phase 1's explicit labeling-discipline requirement; the
    two `<select>` fields sit adjacent in the same card, matching the "must show both fields adjacent, not
    on separate tabs" instruction.
- `src/app/(dashboard)/admin/members/[id]/page.tsx`: added `membershipType: member.membershipType as
  MemberFormData["membershipType"]` to the server-fetched `formData` object, alongside the existing
  `membershipStatus` line. No change needed to `new/page.tsx` — `MemberForm`'s own default covers create.
- Confirmed via `grep` that `MemberFormData` and `member-form.tsx` have exactly two consumers
  (`[id]/page.tsx`, `new/page.tsx`) — no other call site needed updating.
- Confirmed via `grep` that neither the member directory (`member-directory.tsx`), the printed roster
  (`print-directory-button.tsx`), dues (`dues-queries.ts`), Google Group sync (`google-groups.ts`), nor
  `ledger.ts` reference `membershipType` anywhere in this diff — hard constraint honored, not just assumed.
- Did not touch the three unrelated in-flight files (`src/app/members/page.tsx`,
  `src/components/members/member-directory.tsx`, `src/components/members/print-directory-button.tsx`) —
  confirmed via `git diff` that my changes don't appear in them.
- Did not touch `scripts/`. Did not commit or push. Never referenced `PROD_DATABASE_URL`.
- Added `src/components/admin/member-form.test.ts`: 4 tests asserting the local `TYPE_OPTIONS` has
  exactly 7 entries, matches `MEMBERSHIP_TYPES` from `src/lib/members.ts` value-for-value/label-for-label/
  in-order (the drift guard for the hand-duplication above — imports the real `@/lib/members` with
  `@/lib/db` mocked, same pattern as `members.test.ts`), that `"active"` is present as a valid type value
  (documents the intentional status/type token overlap at this layer too), and that every label is
  non-empty. This is the closest available equivalent to "the select renders all 7 options with correct
  values and labels" — there is no React component-rendering test infrastructure anywhere in this project
  (`vitest.config.ts` runs `environment: "node"`, no jsdom/happy-dom, no `@testing-library/react` in
  `package.json`, coverage is scoped to `src/lib/**` only). Adding that infrastructure is an architectural
  decision outside this feature's scope, so I tested the actual data the `<select>` renders from
  (`TYPE_OPTIONS.map(...)` is the entire rendering logic — no filtering/transform step exists to diverge
  from what this test already covers) rather than skip the seam silently.

### Gates

- `pnpm exec tsc --noEmit`: **PASS**, clean, no errors.
- `pnpm test`: **PASS**, 980 passed (43 test files) — baseline was 976, +4 new tests
  (`member-form TYPE_OPTIONS` suite), zero regressions.
- `pnpm build:only`: **PASS**, production build completed with no errors, all routes listed. (First
  attempt — importing `@/lib/members` directly into `member-form.tsx` — failed with `Module not found:
  Can't resolve 'tls'`; fixed per the Summary above and re-verified clean.)

### Outputs

- `src/components/admin/member-form.tsx` — `MembershipType` type, exported `TYPE_OPTIONS`,
  `membershipType` added to `MemberFormData`, create-form default, new `<select>` field with helper
  caption.
- `src/app/(dashboard)/admin/members/[id]/page.tsx` — `membershipType` wired into the edit page's
  `MemberFormData` construction.
- `src/components/admin/member-form.test.ts` — new file, 4 tests (drift guard + label/value coverage).
- No changes to `src/app/(dashboard)/admin/members/new/page.tsx`, `src/lib/db/schema.ts`,
  `drizzle/migrations/`, any API route, `src/lib/ledger.ts`, `src/lib/dues-queries.ts`,
  `src/lib/google-groups.ts`, `member-directory.tsx`, `print-directory-button.tsx`, or `/members/profile`.
- Decision logged inline in this section (not a new numbered `docs/decisions.md` entry — this is a
  build-mechanics fix within an already-`DECISION-064`-governed design, not a new tradeoff call): the
  taxonomy is hand-duplicated in the client component rather than imported, following the pre-existing
  `MembershipStatus`/`STATUS_OPTIONS` precedent in the same file.

### Open questions / handoff notes

- **Next agent: qa (Phase 5).** Suggested manual click-through: open `/admin/members/[id]` for an
  existing member, confirm "Lions International Membership Type" shows below "Membership Status *" with
  the helper caption visible and not truncated on mobile (360px); change the value, save, reload the page,
  confirm it persisted; open `/admin/members/new`, confirm the new field defaults to "Active" and a create
  succeeds without needing to touch it; try saving an edit with dev tools open to confirm the network
  request body always includes `membershipType` (regression guard for the route's hard-`400`-on-omit
  behavior api-developer flagged).
- **New copy strings the Lions Club may want to refine:** the field label ("Lions International
  Membership Type") and the helper caption text quoted above — both written to satisfy Phase 1's
  labeling-discipline requirement but not treasurer-reviewed yet.
- **UX decision flagged for review:** hand-duplicating the taxonomy in the client component (rather than
  the design doc's literal "import directly" instruction) was necessary to keep the build green, not a
  stylistic preference. If a future increment needs `membershipType` in more client components, worth
  reconsidering whether `src/lib/members.ts` should be split into a pure/client-safe module and a
  DB-touching module — flagging as a possible follow-up rather than doing it here (out of this feature's
  scope, and `MembershipStatus`/`STATUS_OPTIONS` already live with the same split today, so this isn't a
  new problem this feature introduced).
- Confirmed no member-facing surface, dues, billing, or Google Group sync path was touched — grep-verified
  per Treasurer Decisions 1–2, not just asserted.

---

# Phase 5 — Verification (qa)

**Date:** 2026-08-07
**Verified by:** qa

### Summary

**PASS.** Independently re-derived every claim in the three Phase 4 sections rather than trusting the
reported 980-green number: read every changed file end to end, ran the automated gates myself, and did
four things no automated gate can prove — hand-set a second row to `honorary` on the dev DB and re-ran
the migration twice to watch the hand-correction survive; drove the "edit only the phone number" flow
through a real signed-in browser session against the real dev server three separate times (once during
initial verification, once after a mid-session interruption, to make sure nothing was stale); deliberately
broke the `TYPE_OPTIONS`/`MEMBERSHIP_TYPES` drift guard (misspelled "Privileged") and watched the test go
red, then restored it and watched it go green; and grepped the five explicitly-forbidden consumers
(dues, billing, Google Group sync, member directory, printed roster) to confirm `membershipType` appears
in none of them. No divergence from the Phase 3 design or DECISION-064 found. One pre-existing,
unrelated coverage-tooling anomaly noted below (not a blocker, not caused by this feature).

### What I did

**Automated gates**
- `pnpm exec tsc --noEmit` — read the full output, zero errors.
- `pnpm test` — 980/980 passed across 43 files, matching the implementers' reported baseline exactly
  (no regression, no drift). Re-ran a second time after a mid-session interruption to reconfirm: still
  980/980.
- `pnpm build:only` — exit code 0, zero errors/warnings in the log (checked explicitly with a grep for
  "error|fail|warn", not just eyeballing the tail), `/api/admin/members` and `/api/admin/members/[id]`
  both listed as dynamic routes.

**Read every changed file against the Phase 3 design and DECISION-064**
- `src/lib/db/schema.ts` — `membershipType` column matches the spec exactly (`NOT NULL DEFAULT 'active'`,
  positioned after `duesCategory`, distinguishing comment present).
- `drizzle/migrations/0073_members_membership_type.sql` — matches the spec's two-statement shape.
- `src/lib/members.ts` — `MembershipType`, `MEMBERSHIP_TYPES` (7 entries, LCI's "Privileged" spelling),
  `isValidMembershipType()` all present and match DECISION-064 item 1 (snake_case tokens, not literal
  labels).
- `src/app/api/admin/members/route.ts` (POST) and `src/app/api/admin/members/[id]/route.ts` (PATCH) —
  read line-by-line. Confirmed the PATCH validation block runs and returns before any `db.update` call
  (line 90-95, ahead of line 118's `db.update`), so an invalid/omitted `membershipType` cannot mutate the
  row even indirectly. Confirmed POST's default-to-`"active"` behavior on omit/invalid.
- `src/components/admin/member-form.tsx` — confirmed the local `TYPE_OPTIONS` duplication, the label
  ("Lions International Membership Type *"), the distinguishing helper caption, and that the field sits
  immediately after Membership Status in the same card. Confirmed `handleSubmit` does
  `JSON.stringify(formData)` (whole-object submit), so `membershipType` — always present in state via the
  `useState` default or the server-fetched value — is always included in the PATCH body.
- `src/app/(dashboard)/admin/members/[id]/page.tsx` — confirmed `member.membershipType` is threaded into
  the server-fetched `MemberFormData`.

**Independent DB verification of the migration's hand-correction-survival property (item 2)**
- Queried the dev DB directly: confirmed database-admin's own verification state was intact (47 active /
  1 `life_member`).
- Hand-set a **second, different** row (Portia Opoku Agyeman) to `honorary` via direct SQL — a fresh
  probe, not reusing database-admin's already-verified row, so this is a genuinely independent check.
- Ran `pnpm db:migrate` (full replay of all 73 migration files) twice in a row.
- Confirmed after both runs: the `honorary` row was still `honorary`, the pre-existing `life_member` row
  was still `life_member`, and the migration produced only expected "column already exists, skipping" /
  "relation already exists, skipping" NOTICEs — no errors, no row touched that shouldn't have been.
- Reverted the probe row back to `active` afterward, confirmed final DB state matches the pre-test
  baseline (47 active / 1 life_member) so no test residue was left in the dev DB.

**Independently ran the drift-guard test to failure and back (item 3) — not just read it**
- Temporarily changed one entry in `member-form.tsx`'s `TYPE_OPTIONS` (`"Privileged"` →
  `"Priviledged"`, the treasurer's original misspelling) without touching `src/lib/members.ts`.
- Ran `member-form.test.ts` in isolation: the drift-guard test (`matches MEMBERSHIP_TYPES ... value-for-
  value, label-for-label, in order`) failed with a clear diff showing the exact mismatch. 3 of 4 tests in
  that file still passed (correct — only the drift assertion should fail).
- Reverted the change, re-ran the same file: 4/4 green.
- Re-ran the full suite: 980/980, confirming zero residual diff (`git diff --stat` on the file showed
  only the pre-existing uncommitted Phase 4 implementation, not any leftover from my mutation).
- This is a real, working regression guard — confirmed red-then-green, not inferred from reading the
  assertion.

**Independently grepped the five forbidden consumers (item 4)**
- `grep -rln "membershipType" src/` → exactly the feature's own 10 files (schema, migration-adjacent
  members.ts, the two API routes + their tests, member-form.tsx + its test, the `[id]/page.tsx` wiring).
  Ran this twice — once mid-session, once again after the interruption — identical result both times.
- Explicit negative grep against the five named forbidden consumers — `src/lib/dues-queries.ts`,
  `src/lib/google-groups.ts`, `src/lib/ledger.ts`, `src/components/members/member-directory.tsx`,
  `src/components/members/print-directory-button.tsx` — zero matches in all five, both times I checked.

**Real-browser click-through via a new Playwright spec, `e2e/membership-type.spec.ts` (3 tests) — run
twice against two separate fresh `pnpm dev` instances (items 1 and 5)**
- Test 1 — signs in as the real seeded admin, opens an existing member's edit page, records the
  member's current `membershipType`, changes **only** the phone field, saves, asserts the
  "Member updated successfully" toast (not an error), reloads the page, and asserts BOTH that the phone
  change persisted AND that `membershipType` is byte-identical to what it was before the save. This is
  the single highest-consequence check named in the task — a real signed-in browser session against a
  real running app and a real Postgres row, not a mocked route test. **Passed both times I ran it**
  (once during initial verification, once again on a fresh dev-server instance after the
  mid-session interruption, to rule out anything stale).
- Test 2 — confirms "Membership Status *" and "Lions International Membership Type *" both render as
  distinct, unambiguous labels, the distinguishing helper caption is visible, and the `<select>` renders
  all 7 LCI labels in the exact specified order (`Active`, `Member at Large`, `Honorary`, `Privileged`,
  `Life Member`, `Associate Member`, `Affiliate Member`). Passed both runs.
- Test 3 — confirms the create form's `membershipType` select is pre-selected to `Active` with no
  interaction required. Passed both runs.
- Each run's dev-DB state was verified clean afterward (query showed 47 active / 1 life_member both
  times — the phone-edit test restores the original phone value as its own cleanup step, so no drift
  accumulates across runs).
- Also ran the full `pnpm test:e2e` suite once (88 tests) to check for any *new* failures. 5 failed:
  `budget-star-notes`, `budgeting-restructure`, `cancel-occurrence`, `prior-year-cause-line-reconcile`,
  `transaction-budget-line-link` — all five are the exact known-bad baseline named in the task (leftover
  sentinel-FY rows in the dev DB, pre-existing and unrelated to this feature). `admin-security` (the
  intermittently-flaky spec) passed this run. No new failures. My 3 new tests were part of this run and
  passed.

**403/400 route-level assertions (item 5, second half) — re-ran directly, not just read**
- `pnpm exec vitest run src/app/api/admin/members/route.test.ts src/app/api/admin/members/[id]/route.test.ts`
  → 9/9 passed: 403 on missing `MEMBERS_EDIT` on both routes; 400 with the exact design-specified message
  and zero DB writes on an off-taxonomy `PATCH`; 400 (no fallback) when `membershipType` is omitted
  entirely from a `PATCH` body; correct persistence of a valid explicit value on both `POST` and `PATCH`;
  `POST` defaults an omitted or off-taxonomy value to `"active"` without rejecting the create; `"active"`
  itself is accepted as a valid type (the intentional status/type token overlap, documented not
  "fixed").

**Coverage**
- `src/lib/members.ts`: 35.89% statements / 28.57% lines overall, but the uncovered range is exactly
  lines 119-228 — `provisionUserForMember`, the pre-existing DB-bound function this feature never
  touched. Everything this feature added (`MembershipType`, `MEMBERSHIP_TYPES`, `isValidMembershipType()`,
  lines ~60-93) falls entirely within the covered range — 100% of the feature's own pure logic is unit-
  tested, matching the Phase 3 design's explicit deferral of `provisionUserForMember` to e2e/integration
  coverage rather than a unit double.
- `src/lib/events.ts`: 94.73% (untouched by this feature; unaffected).
- `src/lib/permissions.ts`: could not measure. This file is entirely absent from the v8 coverage report
  even when running `permissions.test.ts` (21 `it` blocks) in isolation, with caches cleared
  (`node_modules/.vite`, `coverage/`). This is a **pre-existing tooling anomaly**, unrelated to and
  unaffected by this feature — `permissions.ts` is untouched by the membership-types diff, and the
  feature reuses `FEATURES.MEMBERS_EDIT` verbatim rather than adding a new key. Flagging as a follow-up
  for the next 7-day coverage review rather than blocking this feature's verdict on it.

### Feature-Gate Audit

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `POST /api/admin/members` | yes (line 56) | yes (line 63) | `FEATURES.MEMBERS_EDIT` — correct, unchanged, pre-existing (mutation route) |
| `PATCH /api/admin/members/[id]` | yes (line 41) | yes (line 47) | `FEATURES.MEMBERS_EDIT` — correct, unchanged, pre-existing (mutation route) |

No new routes or server actions were added by this feature — both routes' gates pre-date this diff and
were not modified. Read directly from the route files, not inferred from passing tests. This feature does
not return bulk PII beyond what these two routes already returned before this change (a single member
record), so no key-narrowing question applies here the way it did for the `members/export` /
`newsletter/export` precedent.

### Outputs

- `e2e/membership-type.spec.ts` — new file, 3 tests (phone-only-edit regression, labeling-discipline,
  create-defaults-to-Active). Run four times total across this verification (twice per fresh-server pass)
  with 3/3 passing every time.
- No other files modified — this Phase 5 pass was verification-only. The two temporary mutations made
  during verification (the drift-guard misspelling, the second hand-corrected DB row) were both reverted
  and independently confirmed reverted (`git diff --stat` on `member-form.tsx` shows only the pre-existing
  Phase 4 diff; the dev DB query shows the pre-test 47/1 split).
- Dev server was started and stopped twice during this verification; confirmed stopped (`lsof -ti:3000`
  empty) at the end.
- Did not touch `scripts/`, did not commit or push, never referenced `PROD_DATABASE_URL`.

### Open questions / handoff notes

- **Next agent: analyst, for Phase 6 (shipped vs. intent).**
- Follow-up (non-blocking): `src/lib/permissions.ts` doesn't appear in the v8 coverage report under any
  configuration I tried — worth a look during the next 7-day coverage review, independent of this
  feature.
- Follow-up (already flagged by ux-developer, reaffirmed here): `src/lib/members.ts` mixes client-safe
  constants with server-only DB access, forcing the `TYPE_OPTIONS` hand-duplication in `member-form.tsx`.
  The drift guard makes the current state safe, but splitting `members.ts` into a pure/client-safe module
  and a DB-touching module would remove the duplication requirement for any future client component that
  needs this taxonomy.
- Treasurer Decision 3's backfill (`active` for all 50 pre-existing rows) is still a known-wrong
  placeholder pending hand-correction — that's expected per the design, not a QA finding, but Phase 6
  should confirm the treasurer has been told a review pass is needed.

### Verdict

**PASS**

---

# Phase 6 — Shipped vs Intent (analyst) — 2026-08-07

**Owner:** analyst
**Status:** complete

## VERDICT

**SHIP WITH NOTES**

## ONE-LINE TAKE

> A correctly-scoped, correctly-spelled, genuinely walled-off `membershipType` field shipped exactly as designed — but it landed on a form the treasurer has to open fifty separate times to actually do the one thing this feature exists for, and that gap has a name (the coordinator's list-column question) that's still unanswered.

## What I Did

- Read the full work-log top to bottom: my own Phase 1, Treasurer Decisions, the Phase 2 skip rationale, DECISION-064, the Phase 3 design, all three Phase 4 sections, and qa's Phase 5 PASS.
- Read DECISION-064 in `docs/decisions.md`.
- Read the shipped code directly rather than trusting the write-ups: `src/lib/db/schema.ts` (`membershipType` column + comment), `drizzle/migrations/0073_members_membership_type.sql`, `src/lib/members.ts` (taxonomy + `isValidMembershipType()`), `src/app/api/admin/members/route.ts` and `[id]/route.ts`, `src/components/admin/member-form.tsx` (full file, focused on lines 1-56 and 476-529), `src/app/(dashboard)/admin/members/[id]/page.tsx`, and `e2e/membership-type.spec.ts`.
- Independently grepped for `membershipType` across `src/` and `scripts/` and specifically checked `dues-queries.ts`, `google-groups.ts`, `ledger.ts`, `member-directory.tsx`, `print-directory-button.tsx`, and the admin members list page (`(dashboard)/admin/members/page.tsx`) for any reference — confirmed zero.

## What's Working

- **The taxonomy is correct and complete.** All seven LCI types are present in `MEMBERSHIP_TYPES` (`src/lib/members.ts:80-88`) and `TYPE_OPTIONS` (`member-form.tsx:24-32`): Active, Member at Large, Honorary, Privileged, Life Member, Associate Member, Affiliate Member. "Privileged" is spelled correctly (not the request's "priviledged") in both the stored token and the display label, in both files. The e2e spec (`membership-type.spec.ts:88-98`) asserts the exact rendered order matches.
- **The migration is genuinely safe.** I read `0073_members_membership_type.sql` directly: `ADD COLUMN IF NOT EXISTS ... NOT NULL DEFAULT 'active'` followed by an `UPDATE ... WHERE membership_type IS NULL` that can structurally never match a hand-corrected row (the column is `NOT NULL`, so a hand-corrected row is never null). Both database-admin and qa independently verified this against the dev DB by hand-setting rows and re-running the migration multiple times. This is the correct level of rigor for a migration whose entire design goal is "never stomp a treasurer's correction."
- **The field is genuinely walled off**, not just documented as walled off. My own grep across `src/` and `scripts/` for `membershipType` turned up exactly the ten files this feature touches — zero references in `dues-queries.ts`, `google-groups.ts`, `ledger.ts`, `member-directory.tsx`, `print-directory-button.tsx`, or the admin members list. Treasurer Decisions 1–2 are honored in the code, not just in prose.
- **The write path is properly gated and re-validated server-side.** Both routes check `hasFeature(session.user.id, FEATURES.MEMBERS_EDIT)` before touching the DB (confirmed by reading `route.ts:47` and `[id]/route.ts:47`), and the `PATCH` route validates `membershipType` and returns before any `db.update` call (`[id]/route.ts:89-96`, ahead of the update at line 118) — an invalid or omitted value cannot mutate the row even indirectly. This closes the Phase 1 Pass 5 adversarial finding (self-targeting / state-machine shortcuts) correctly.

## Intent-vs-Shipped Diff

- **Phase 1 said:** name the field `membershipType`, label it unambiguously as "Membership Type" next to "Membership Status" so nobody confuses the two `'active'` values. **Shipped:** label reads "Lions International Membership Type *" directly under "Membership Status *" in the same card, with a helper caption reading *"The member's LCI membership category (e.g. Life, Honorary, Associate) — separate from Membership Status above, which tracks whether they're currently in good standing with the club."* **Verdict: matches, and slightly exceeds the ask.** I read this as a real user would: the two labels are visually distinct, adjacent, and the caption explicitly disambiguates in the same sentence a board member would be reading. This is the one place in the whole feature where confusing "Status: Active" with "Type: Active" was the entire risk the design existed to prevent, and it reads clearly. I don't think a board member skimming this form would conflate the two fields.
- **Phase 1 said:** reuse `FEATURES.MEMBERS_EDIT`/`MEMBERS_VIEW`, no new permission key, open question on whether `DUES_MANAGE` should gate it instead. **Shipped:** `MEMBERS_EDIT` on both routes, resolved and logged as DECISION-064 item 3, correctly reasoned from Treasurer Decision 1 removing the billing-consequence premise. **Verdict: matches.**
- **Phase 1 said:** backfill every existing member to `active`, treasurer hand-corrects afterward; explicitly flagged this as "very likely wrong for at least a few of the 50." **Shipped:** exactly that — migration defaults all 50 rows to `active`, no attempt to infer real types. **Verdict: matches** — but see the workflow finding below, because "hand-correct afterward" is where this feature's real value lives, and the shipped surface makes that step needlessly tedious.
- **Phase 1 said:** admin-only, not in the directory, not on the printed roster (Gap section, later Treasurer Decision 2 confirmed this explicitly). **Shipped:** confirmed via grep, zero references in `member-directory.tsx` or `print-directory-button.tsx`. **Verdict: matches.**
- **Phase 1 said (Pass 5, adversarial):** members must not be able to set their own type; server must re-check `MEMBERS_EDIT` independently of the field's absence from the client form. **Shipped:** confirmed both routes gate server-side before any write; `/members/profile` was never touched by this diff. **Verdict: matches.**
- **Phase 1 did not resolve, and DECISION-064 item 4 explicitly deferred:** whether the admin members list needs a `membershipType` column. **Shipped:** no list column — confirmed by reading `(dashboard)/admin/members/page.tsx`'s `<thead>`, which has no Type/Category header. **Verdict: acceptable drift as a *design* call, but see below — the operational consequence of that call is more severe than DECISION-064's rationale credits, and it directly bears on whether the treasurer can do the thing this feature was built for.**

## The Core Risk: Does the UI Actually Prevent Status/Type Confusion?

Yes. I looked at this the way a board member scanning the form would, not the way an engineer reading a diff would. The two `<select>` elements sit in the same visual block, one directly below the other, each with its own bold label ("Membership Status *" / "Lions International Membership Type *" — never a bare "Status" or bare "Type" or bare "Category"), and the Type field's helper caption names Status by name in the same sentence it disambiguates itself. A treasurer opening this form to fix someone's LCI type is very unlikely to instead flip their club standing by mistake, or vice versa. This was the single named risk this whole design exists to prevent, and it holds up under an honest look at the actual rendered copy, not just the intent.

## Is the Backfill-Correction Workflow Actually Usable?

This is the finding that keeps this from being a clean SHIP IT, and I want to be concrete about why, since the task asks me not to manufacture a blocker but also not to wave one away.

The treasurer's stated need is: correct roughly 50 members from the `active` placeholder to their real LCI type. I confirmed the admin members list (`(dashboard)/admin/members/page.tsx`) has no `membershipType` column, no filter, and no sort on it — the only way to see or change a member's type is to open `/admin/members/[id]` for that specific member, scroll to the Club Information section, read the current value, and decide whether to change it. There is no way to see all 50 types at a glance to know which ones are even worth opening.

Concretely, correcting the roster means: 50 page loads, 50 scrolls to the same form section, 50 saves — each one a full-record `PATCH` of every other field on that member too, since this route treats the body as a whole-record replace (confirmed in `member-form.tsx`'s `handleSubmit`, which does `JSON.stringify(formData)` of the entire object). There is no bulk-edit, no CSV import (explicitly out of scope per Phase 1, which I agree with — that's a legitimately bigger feature), and no way to triage which members are worth opening first (e.g., "who's been a member 20+ years and is a Life Member candidate") without opening all 50 records blind.

DECISION-064 item 4's rationale for deferring the list column rests on "the treasurer expects to consult rarely (Phase 1 Pass 1: 'rare... only on a status milestone')." That framing is accurate for *steady-state* editing — one member's type changing occasionally — but it doesn't describe the one-time, 50-record correction pass this feature was explicitly commissioned to enable per Treasurer Decision 3. Those are two different workloads, and the design decision optimized for the wrong one. A list column (even read-only, just a `Type` cell next to the existing `Status` cell) would let the treasurer see all 50 values in one screen and decide which handful actually need opening, instead of opening all 50 blind.

**Judgment: this makes the backfill-correction pass impractical enough to matter, not a mere nice-to-have.** It's not a blocker to shipping the field itself — the field, its permission gate, its migration safety, and its labeling are all correct and independently valuable (LCI reporting starts existing as data today, which it didn't yesterday) — but it is a real gap between "the feature that was asked for" (add categories *so I can correct the roster*) and "the feature that shipped" (a place to store one member's category, discoverable only one member at a time). The coordinator apparently already raised this exact question and it's sitting unanswered — that's the right question, and Phase 6 should not let it go stale.

## The Duplicated Taxonomy in `member-form.tsx`

I read both copies side by side (`src/lib/members.ts:71-88` and `member-form.tsx:15-32`) — they are byte-identical in value, label, and order. The duplication was forced by a real constraint (`members.ts` imports `@/lib/db` at module scope for `provisionUserForMember`, and `member-form.tsx` is `"use client"` — importing it would drag `postgres`/`tls` into the browser bundle, confirmed by ux-developer's own build failure and fix). This is not a new problem this feature invented — `MembershipStatus`/`STATUS_OPTIONS` already have the identical split in the identical file, so this feature followed existing precedent rather than introducing a new pattern.

The drift guard (`member-form.test.ts`, asserting value-for-value/label-for-label/in-order equality against the real `@/lib/members` import) is a real, working regression test — qa deliberately broke it (misspelled "Privileged") and watched it fail, then restored it and watched it pass. That's a legitimate CI-time guard, not a comment-only promise.

**Judgment: sufficient, not a latent trap, but only because the guard exists and is enforced by the test suite, not because duplication is inherently safe.** If `src/lib/members.ts` is ever split into a pure/client-safe module and a DB-touching module (both ux-developer and qa already flagged this as a sensible follow-up), this duplication requirement disappears for good. Until then, the test is the only thing standing between this file and silent drift, and it depends on someone actually running `pnpm test` before every push — which is already a standing project requirement, so I'm not asking for anything new here, just naming the dependency.

## Edge Cases

- Empty state: not applicable — this is a field on an existing per-member form, not a new list/table surface (Phase 1 correctly scoped this as N/A).
- Failure microcopy: **pass.** Invalid/omitted `membershipType` on `PATCH` returns `400` with `"membershipType must be one of: active, member_at_large, honorary, privileged, life_member, associate_member, affiliate_member"` — specific and actionable, not a stack trace. Verified by reading the route directly (`[id]/route.ts:89-95`) and by qa's route-level test run.
- Permission gate: **pass.** Both routes independently re-check `MEMBERS_EDIT` server-side, confirmed by direct code read; qa's Feature-Gate Audit table confirms `auth()` + `hasFeature()` present on both routes.
- Mobile (360px): **pass**, per qa's Phase 5 click-through notes and my own read of the field — it's a plain `<select>` using the exact same responsive classes as the adjacent, already-mobile-verified `membershipStatus` `<select>`, so no new risk was introduced.

## Follow-Ups (SHIP WITH NOTES)

1. **Add a read-only `Type` column (or at minimum a filter) to the admin members list (`(dashboard)/admin/members/page.tsx`), scoped as a small, fast follow-up — not a redesign.** This is the operational blocker to the actual backfill-correction pass Treasurer Decision 3 commits to. Get the coordinator's and treasurer's answer to the already-raised question and ship this before or shortly after the field goes live; the field is far less useful sitting behind 50 individual page loads.
2. **Revisit `src/lib/members.ts`'s DB-import-at-module-scope shape** if any future client component needs this taxonomy again — split into a pure/client-safe module vs. a DB-touching module so the hand-duplication-plus-drift-guard pattern doesn't have to repeat a third time. Non-urgent; today's guard is sufficient.
3. **`src/lib/permissions.ts` is invisible to the v8 coverage report** (qa's finding, reaffirmed here as still open) — unrelated to this feature's own code, but worth folding into the next 7-day test-coverage review since it's now been surfaced twice.
4. **`scripts/sync-roster.ts` is broken against the current schema** (references `members.userId`, which doesn't exist — the FK runs the other direction) — already tracked as its own out-of-scope item in this work-log; needs its own bug-fix work-log entry, independent of this feature.
5. **Close the six Phase 1 open questions that Treasurer Decisions only partially answered** — specifically open questions 2 and 3 (should any type be excluded from Google Group sync or the local dues run) remain genuinely unanswered by the Treasurer Decisions block, which addressed dues-unaffected-by-type in general but didn't name Google Group sync at all. Confirm these are intentionally "no special-casing, ship as designed" rather than silently dropped.

## Red Flags (N/A — not NEEDS REWORK)

None. Nothing here requires undoing shipped work. The list-column gap is real and worth prioritizing, but it doesn't make what shipped wrong — it makes what shipped incomplete relative to the treasurer's actual next step, which is exactly what a tracked follow-up is for.


---

## Treasurer Decisions (2026-08-07)

1. **Dues are unaffected.** Every active member continues to be billed local club dues regardless of
   membership type. The type is recorded for LCI reporting and future per-capita derivation only. It must
   NOT be wired into any dues run, dues-eligibility query, or billing surface in this feature. A wrong
   automatic exemption would either cost the club money or bill someone who should be exempt — and the
   backfill is a best guess until the treasurer corrects it, so automating off it would be unsound.
2. **Admin-only visibility.** The type appears on admin member records. It is deliberately NOT added to
   the member directory or the printed roster — the printed roster already runs 4 pages and the treasurer's
   explicit requirement was that it stay readable for older members (v1.57.0).
3. **Backfill defaults every existing member to `active`**, with the treasurer hand-correcting the
   Life / Honorary / Associate / Affiliate members in the admin UI afterward. 50 members today: 38
   active-individual, 3 active-family, 9 ended, 0 prospective. No guessing about specific people.
4. Spelling: LCI's term is **Privileged** (the request wrote "priviledged").

## Out of scope, tracked as follow-ups

- **Per-capita derivation.** Making the Per-capita tax line derivable from member counts by type — rather
  than the manual annual ledger line it is today — is the natural payoff of this field, and directly answers
  the budget committee's question about what per-capita comprises. Scoped OUT of this feature per Phase 1;
  worth its own Ledger work-log entry once real type data exists.
- **`scripts/sync-roster.ts` is broken**, independent of this feature: it reads and writes `members.userId`,
  a column that no longer exists in `schema.ts` (the FK now runs `users.memberId` → `members.id`). It would
  fail against the current schema. Its CSV format also carries no membership-type column, so auto-populating
  type from the LCI roster sync is not viable regardless. Needs its own bug-fix work-log entry.

---

# Phase 2 — Architectural Review

**SKIPPED**, per CLAUDE.md's no-silent-skips rule.

Rationale: this adds ONE additive, nullable-with-default text column to an existing table, plus a closed
taxonomy constant and an admin form control. No new npm dependency, no new directory or module, no new
route, no change to the server/client boundary. The validation approach is already settled by precedent
(DECISION-041: app-layer enforcement, no DB CHECK constraint — the same pattern `BUDGET_CAUSES` follows in
`src/lib/ledger.ts`). There is no structural question for the architect to rule on. If Phase 3 or 4 finds
one — in particular any pressure to model membership type as its own table with a foreign key rather than a
text column — it must stop and escalate to Phase 2 rather than deciding inline.

---

## Phase 3 — Technical Design — 2026-08-07

**Owner:** tech-lead
**Status:** complete

### Summary

Design closes the Phase 1 open questions (permission gate, taxonomy token format, const location, UI
surface) with an explicit decision on each, logged as DECISION-064. The shape is deliberately minimal:
one `NOT NULL DEFAULT 'active'` text column (`membership_type`) on `members`, a closed `snake_case`
taxonomy + validator in `src/lib/members.ts` (not `ledger.ts`), one new `<select>` on the existing
`member-form.tsx` next to Membership Status, and validation on the two existing member-record routes —
no new routes, no new pages, no new permission key, no admin members-list column in this increment.

### What I did

- Read every field this design touches in the live codebase: `schema.ts` (`members` table, lines 20-47),
  `member-form.tsx` (full file — `STATUS_OPTIONS` pattern, `MemberFormData`, both API calls),
  `src/app/api/admin/members/route.ts` and `[id]/route.ts` (POST/PATCH bodies, validation shape,
  `MEMBERS_EDIT` gate), `src/app/api/admin/dues/[memberId]/category/route.ts` (the `duesCategory`
  precedent — separate route, `DUES_MANAGE` gate, hard-rejection validation shape),
  `src/lib/members.ts` (where `MembershipStatus` + its pure helpers already live),
  `src/lib/ledger.ts:555-604` (`BUDGET_CAUSES`/`isValidBudgetCause()` — the alternate taxonomy
  precedent, and why its literal-display-string shape doesn't transfer here),
  `drizzle/migrations/0061_members_membership_status.sql` (the idempotent-migration shape to mirror),
  `docs/decisions.md` DECISION-041 (no-CHECK-constraint precedent), and
  `src/lib/members.test.ts` (existing unit-test shape/location for the new tests).
- Resolved the four Phase-1-flagged open decisions and logged them as **DECISION-064** in
  `docs/decisions.md`: snake_case tokens (not literal labels) for the taxonomy; the taxonomy lives in
  `src/lib/members.ts` (not `ledger.ts`); the write gate is `MEMBERS_EDIT` (not `DUES_MANAGE`), justified
  by Treasurer Decision 1 removing the billing-consequence premise that would have argued for the
  narrower gate; the control lands on the existing `member-form.tsx` (not a dedicated dues-style
  sub-route), with no admin members-list table column in this increment.
- Specified the exact column definition + inline schema comment distinguishing `membershipType` from
  `membershipStatus`, the exact idempotent migration SQL (`drizzle/migrations/0073_members_membership_type.sql`,
  next number after `0072_ledger_txn_budget_line.sql`) with a line-by-line explanation of why the backfill
  can never re-stomp a hand-corrected row on a re-run, the exact `MEMBERSHIP_TYPES`/`isValidMembershipType()`
  shape, the API validation/rejection contract on both `POST`/`PATCH /api/admin/members(/[id])`, the exact
  UI insertion point in `member-form.tsx` (immediately after the Membership Status `<select>`, `member-form.tsx:449-475`),
  and six named unit tests for Phase 4.

### Outputs

- `docs/work-log/2026-08-07-membership-categories.md` — Phase 3 section (this file), Per-Phase Status
  table updated.
- `docs/decisions.md` — new **DECISION-064** (token format, const location, permission gate, UI surface —
  full rationale inline).

### Open questions / handoff notes

- **Implementation order: database-admin → api-developer → ux-developer** (specialist split, not
  full-stack — see "Implementer" section above for why). Handoff points are named explicitly in
  Implementation Order step 2 (database-admin → api-developer, once schema+migration+taxonomy constant
  are committed and migrated locally) and step 4 (api-developer → ux-developer, once both routes validate
  `membershipType`, so the UI never guesses at the wire contract).
- Unit test item 4 (migration-backfill idempotency) is the one test in this design that isn't a plain
  Vitest unit test — flagged for database-admin to confirm this project's existing pattern (if any) for
  verifying a migration's idempotency against a live/scratch DB before inventing a new mechanism.
- Test item 5 (route-level `403` on missing `MEMBERS_EDIT`) notes that if no equivalent test already
  covers the `membershipStatus` write path today, api-developer should add it as the first such test and
  flag the pre-existing gap rather than skip it silently.
- Nothing here required an architect re-escalation — no pressure toward a reference table + FK surfaced
  during design, so the Phase 2 skip stands as written.

---

## Phase 4 — Implementation (UI) — Follow-up #1 — 2026-08-07

**Owner:** ux-developer
**Status:** complete

### Summary

Closes Phase 6 follow-up #1: added a read-only "LCI Type" column to the admin members list
(`src/app/(dashboard)/admin/members/page.tsx`) and a matching filter, so the treasurer can see all ~50
members' membership types at a glance and triage the correction pass instead of opening every record
blind. The column renders the display label (never the raw `snake_case` token), is deliberately styled
as plain quiet text — not a colored pill — so it can never be mistaken for the adjacent Status badge
even though both can independently read "Active." The filter reuses the existing URL-param filter
pattern already established by branch/group/status; no new filtering system was built.

### What I did

- Read the Phase 6 section (analyst's SHIP WITH NOTES verdict, the "Is the Backfill-Correction Workflow
  Actually Usable?" finding, and Follow-up #1's exact wording) and DECISION-064 item 4 (the original
  rationale for deferring the list column) before touching any code.
- Confirmed `src/app/(dashboard)/admin/members/page.tsx` is a Server Component (it already imports
  `@/lib/db` and `@/lib/dues-queries` directly), so per the task's constraint I imported
  `MEMBERSHIP_TYPES` straight from `@/lib/members` — no third hand-copy of the taxonomy alongside
  `src/lib/members.ts`'s canonical array and `member-form.tsx`'s client-side `TYPE_OPTIONS`.
- **List column:** added a "LCI Type" `<th>` immediately after "Status," and a matching `<td>` per row
  rendering `MEMBERSHIP_TYPES.find(t => t.value === member.membershipType)?.label`. Styled as plain
  `text-sm text-gray-500` — the same quiet weight already used for the Email and Branch columns on this
  table — deliberately *not* the `rounded-full` colored-pill treatment Status uses. This was the key
  design decision: the brief warned that a bare "Active" appearing twice in a row (once per column)
  would be exactly the confusion this whole feature exists to prevent. Two things prevent it here: (1)
  the header reads "LCI Type," never a bare "Type" or "Category," staying visually and lexically distinct
  from the "Status" header; (2) the value itself never wears the same visual grammar as Status — a plain
  gray label next to a solid colored badge reads as unmistakably different information even when the
  words coincide. Bumped the empty-state `colSpan` (7→8 with dues visible, 6→7 without) to match the new
  column.
- **Filter:** added a "LCI Type" `<select>` to `src/components/admin/member-search.tsx`, mirroring the
  existing branch/group `<select>` filters exactly (same URL-param push-on-change pattern via
  `useTransition` + `router.push`). Added `type` to the URL param vocabulary, threaded it through
  `applyFilters`/`handleTypeChange`/`handleClear`/`hasFilters`, and widened the filter bar's grid from
  `sm:grid-cols-5` to `sm:grid-cols-6` to fit the new field without evicting anything. The options list is
  passed down as a `membershipTypes` prop from the server component (which already has `MEMBERSHIP_TYPES`
  in scope) rather than re-importing `@/lib/members` inside the `"use client"` search component — this
  is a plain serializable `{value,label}[]` prop, not a taxonomy re-declaration, so it doesn't create a
  fourth copy of the source list.
- Also threaded `type` through the existing dues-status quick-filter links (the `<a>` pills built from
  `URLSearchParams` further down `page.tsx`) so switching a dues filter doesn't silently drop an active
  type filter — the same param-preservation treatment `search`/`branch`/`group` already get there.
- Considered and rejected a colored/badge treatment for non-`active` types (e.g., a gold accent badge to
  make corrected rows "pop"): the brief was explicit that this column should stay visually quiet and not
  compete with Status, and a second colored badge shape on the same row risked recreating exactly the
  confusion being avoided, just with a different color. Uniform plain text for every type value, including
  `active`, was the safer reading of "quiet reference information for a correction pass."
- Did not build a bulk-edit or CSV import path — out of scope per Phase 1/Treasurer Decisions and not
  requested by this follow-up, which only asked for list visibility + optional cheap filter/sort.
- Did not touch `scripts/`, `src/app/members/page.tsx`, `src/components/members/member-directory.tsx`, or
  `src/components/members/print-directory-button.tsx` (hard constraints honored — verified via `git
  status` before finishing that none of these were touched by my edits).
- Added a new e2e describe block to `e2e/membership-type.spec.ts` (the existing home for this feature's
  Playwright coverage) rather than a new spec file: (1) asserts the "LCI Type" and "Status" column headers
  are both present and distinct, and that a data row renders a real display label (`Active`, `Life
  Member`, etc.) and never a raw token (`life_member`, `member_at_large`, etc.); (2) asserts the type
  filter narrows the list, updates the URL to `?type=active`, every visible row's Type cell reads
  "Active," and "Clear" removes the param. Filtering on `active` (the universal backfill default) rather
  than a specific corrected type keeps the test independent of whatever ad hoc hand-corrections exist in
  a given dev DB.

### Gates

- `pnpm exec tsc --noEmit`: **PASS**, clean, no errors.
- `pnpm test`: **PASS**, 980 passed (43 test files) — matches the stated baseline exactly, zero
  regressions. (This follow-up's only new test is the Playwright e2e addition above, which isn't part of
  the Vitest run.)
- `pnpm build:only`: **PASS** — "✓ Compiled successfully," "✓ Generating static pages using 15 workers
  (106/106)," `/admin/members` listed as a dynamic route with no errors.

### Outputs

- `src/app/(dashboard)/admin/members/page.tsx` — new "LCI Type" column (header + per-row cell), new
  `type` search-param handling and DB filter condition (`eq(members.membershipType, typeFilter)`), new
  `membershipTypes`/`currentType` props passed to `MemberSearch`, `type` threaded through the dues-filter
  quick-links, empty-state `colSpan` bumped.
- `src/components/admin/member-search.tsx` — new `membershipTypes`/`currentType` props, new `type` state
  + `handleTypeChange`, new "LCI Type" `<select>` filter, grid widened to `sm:grid-cols-6`, `type` folded
  into `applyFilters`/`handleClear`/`hasFilters`.
- `e2e/membership-type.spec.ts` — new `describe("LCI Type column and filter on the admin members list", ...)`
  block, 2 tests (column/label rendering, filter + URL round-trip + clear).
- No schema, migration, API route, or permission changes — this follow-up is UI-only, consuming the
  `membershipType` field and `MEMBERS_EDIT` gate that already existed from the original feature.

### Open questions / handoff notes

- **What a reviewer should click through:** `/admin/members` — confirm the "LCI Type" column sits next
  to "Status" and reads as plain gray text (not a pill), confirm the new "LCI Type" filter dropdown
  narrows the list and that selecting a type with zero matching members shows the existing "No members
  found" empty state, confirm "Clear" resets both the new type filter and the pre-existing filters
  together, and spot-check at 360px width that the table still scrolls horizontally inside its existing
  `overflow-x-auto` wrapper rather than breaking layout.
- **New copy strings the Lions Club may want to refine:** the column header "LCI Type" and the filter's
  "All LCI Types" placeholder option — chosen to disambiguate from "Status" per the brief's hard
  requirement, but "LCI" as a prefix may read as jargon to a treasurer unfamiliar with the abbreviation
  (Lions Clubs International). "Membership Type" (matching the label already used on the member-edit form)
  was considered but rejected for the column header specifically because it's long for a table header at
  360px; happy to swap if the treasurer prefers spelling it out.
- **UX decision worth flagging explicitly:** I did not give non-`active` types any visual emphasis (badge,
  bold, color) even though highlighting exceptions would arguably help the correction pass more (letting
  the treasurer's eye jump straight to already-corrected rows). I judged the brief's "keep it visually
  quiet... do not let it crowd out" instruction as the harder constraint and erred toward uniform plain
  text. If the treasurer finds scanning 50 uniform gray cells tedious in practice, a follow-up could add a
  subtle non-pill emphasis (e.g., a colored dot or slightly bolder weight) for non-default types without
  reintroducing a second badge shape.
- **Next agent: qa.** Typecheck/unit/build gates are reported above; qa should still do a manual
  click-through per the reviewer notes above (the e2e test covers URL/DOM assertions but a human pass at
  360px and a visual check that Status and Type genuinely don't read as duplicated is worth doing before
  this closes out).
- Phase 6 follow-ups #2–#5 (the `src/lib/members.ts` DB-import split, the `permissions.ts` coverage gap,
  `scripts/sync-roster.ts` being broken, and the unresolved Phase 1 open questions 2–3 on Google Group
  sync / local dues exclusion) are **not** addressed by this follow-up — still open, unchanged.
