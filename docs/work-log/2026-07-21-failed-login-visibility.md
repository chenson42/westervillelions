# Failed Login Visibility — Work Log

> **Slug:** `2026-07-21-failed-login-visibility`
> **Surface:** (dashboard) admin
> **Permission(s):** likely a new `FEATURES` key (e.g., security/login-attempt viewing) bound to Admin — Phase 1/3 to confirm
> **Estimated complexity:** medium
> **Pipeline mode:** Full — schema change (new table), auth-path recording hooks, new admin surface

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-07-21 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-07-21 |
| 3 — Technical design | tech-lead | Complete | Design Complete | 2026-07-21 |
| 4 — Implementation | database-admin (schema) → api-developer → ux-developer | Complete | — | 2026-07-21 |
| 5 — Verification | qa | Complete | PASS | 2026-07-21 |
| 6 — Shipped vs intent | analyst | Complete | SHIP IT | 2026-07-21 |

---

## Intent (user request, 2026-07-21)

"Can we also add a feature so I can see failed logins?"

**Value:** The club admin currently has zero visibility into failed sign-in
attempts — a brute-force run against a member's password, a member repeatedly
locked out, or a deactivated user trying to get back in are all invisible.
Recording and surfacing failed attempts gives the admin a security signal and a
support signal ("why can't Jane log in?").

**Current state (verified):** `src/lib/auth/index.ts` — the Credentials
`authorize()` returns `null` on unknown email / no password set / deactivated
account / bad password, and the `signIn` callback returns `false` for
deactivated OAuth users. None of these paths record anything. There is no
login-attempt table in the schema.

**Complexity rationale:** New table + idempotent migration (database-admin),
recording hooks in the auth config + query/API surface (api-developer), new
admin page (ux-developer) — the classic specialist split.

---

# Phase 1 — Functional Refinement (analyst) — 2026-07-21

**Owner:** analyst
**Status:** complete
**Verdict:** READY WITH NOTES

### Summary

"Can we also add a feature so I can see failed logins?" is a bare verb with no
object detail — it names an outcome ("I can see") but not the shape of the
surface, the retention policy, or even which failure categories count. The
underlying need is real and the codebase has zero recording of any sign-in
failure today (verified in `src/lib/auth/index.ts`), so this is a legitimate
new capability, not a misunderstanding. The shape is well precedented by
`/admin/sync-log` and `/admin/email-queue` (both are admin-only, read-only
audit tables), so I can specify a concrete v1 without further back-and-forth,
but four questions in "Open questions" need the user's answer before
tech-lead finalizes the design — mainly retention and default role exposure.

### What I did

Read `src/lib/auth/index.ts` in full and `src/lib/permissions.ts` in full to
ground every claim below in the actual failure paths and the existing
`FEATURES` catalog, rather than assuming a "login_attempts" table pattern
from a generic playbook.

### Pass 1 — User Verbs

The request is almost entirely description ("I can see failed logins") — it
names zero concrete clicks. Refined into verbs, by surface:

- **Admin** (`/(dashboard)/admin`, new subpage): navigates to a new admin
  page (name/placement TBD by architect — likely grouped near
  `/admin/sync-log` and `/admin/email-queue`); views a reverse-chronological
  list of failed sign-in attempts (timestamp, attempted email, provider,
  failure reason); optionally searches/filters by email (candidate — see
  gaps).
- **Anonymous public visitor / any user at `/signin`**: takes NO new visible
  action. This feature is passive recording — the visitor's experience at
  `/signin` must not change (see adversarial pass on enumeration). Worth
  stating explicitly since it's easy to accidentally "improve" the failure
  message while building this and inadvertently create an enumeration leak.
- **Authenticated member with insufficient roles / signed-in member**: not
  involved in this feature at all.

### Pass 2 — Flow Audit

**Flow A — Recording a failed attempt (system flow, triggered by any user)**
- Entry: a visitor submits the `/signin` password form, OR a deactivated
  Google-linked user completes the Google OAuth handshake.
- Step: `Credentials.authorize()` runs. Today it returns `null` silently on:
  (1) missing email/password, (2) unknown email, (3) user has no password
  set (OAuth-only account), (4) `user.isActive === false`, (5) bcrypt
  mismatch. **New:** each of these branches also writes one row to a new
  audit table before returning `null`.
- Step (OAuth path): the `signIn` callback returns `false` for a deactivated
  Google user. **New:** this branch also records a row. Easy to miss because
  it's a separate code path from `authorize()` — flagging explicitly so
  tech-lead doesn't design only the Credentials half.
- Success outcome: existing behavior is completely unchanged — the visitor
  still sees whatever generic `/signin` error NextAuth renders today.
- Failure outcome (of the *recording itself*): if the DB insert throws (DB
  down, constraint violation, oversized input), it must **never** block or
  alter the sign-in failure response. This needs the same
  fire-and-forget-with-try-catch discipline already used for the
  `lastLoginAt` update and the unlinked-user admin email in the `jwt`
  callback (lines 108-170 of `src/lib/auth/index.ts`). No failure path was
  described for this in the request — that's the gap: recording must degrade
  silently, not throw.

**Flow B — Admin views failed logins**
- Entry: Admin clicks into the new page from the admin nav.
- Step: page loads a paginated, reverse-chronological table.
- Step (candidate, not in original request): admin filters by email or date
  range.
- Success outcome: table populated with rows.
- Empty-state outcome (brand-new install, or simply no failures yet): must
  show a helpful message ("No failed login attempts recorded"), not a blank
  table — no failure path was described for the empty case in the request.
- Failure outcome: if the query fails (DB down), the admin must see a human
  sentence, not a stack trace or a blank white screen.

**Flow C (out of scope candidate) — Alerting.** Not requested. The user said
"see," not "notify me." Flagging as a follow-up, not building it now.

**Flow D (out of scope candidate) — Successful-login audit trail.** Not
requested. The request specifically says "failed logins." `lastLoginAt`
already exists for successful logins; no new surface needed unless the user
asks.

### Pass 3 — Permissions

No existing `FEATURES` key fits. `ADMIN_USERS` ("Manage user accounts and
access") is about account CRUD, not audit-log viewing; `ADMIN_DASHBOARD` is
stats. **Recommend a new key**, e.g. `ADMIN_SECURITY_VIEW: "admin.security_view"`
(fits the existing `admin.*` category), described as "View failed sign-in
attempts and account security events." Bind to `Admin` role only by default —
per CLAUDE.md, "off by default for everyone except admins" is a role-binding
choice on this new key, not a separate flag. Whether `treasurer` or
`board_member` should also get it by default is an open question below
(reasonable default: Admin-only, since this is account-security data
including other members' email addresses). Use the `add-permission` skill in
Phase 4 for the idempotent migration + role binding.

### Gaps the request didn't address

- **Which failure categories count as "failed logins."** Unknown email,
  no-password-set (OAuth-only account, someone tried a password), deactivated
  account (both the Credentials and the OAuth `signIn`-callback denial), and
  bad-password mismatch are five distinct branches today, and only some of
  them are "attacks" — the OAuth-deactivated case is arguably a support
  signal, not a security signal. Suggested resolution: record all five with a
  `reason` enum so the admin can visually distinguish "wrong password for a
  real member" from "brute-force against an unknown/junk email" from "a
  deactivated member trying to get back in."
- **The OAuth `signIn`-callback failure path specifically.** It is a separate
  code path from `authorize()` and is easy to design around without noticing
  it exists. Must be in scope explicitly, or "failed logins" will silently
  mean "failed password logins only."
- **Recording must never block or alter the sign-in response.** No failure
  path for the logger itself was described in the request (see Flow A).
- **Retention/pruning.** The table has no natural cap and will grow forever.
  Also a mild data-hygiene concern since it may store attacker-typed junk
  strings indefinitely. Suggested default: 90-day retention with a
  best-effort prune (deploy-time job or a manual "clear old entries" action
  behind `<ConfirmDialog>`), but this needs the user's input — see open
  questions.
- **Input hygiene on the attempted-email string.** It is unauthenticated,
  attacker-controlled text (could be arbitrarily long, contain HTML/script
  characters, or garbage Unicode). The stored column needs a sane max length,
  and the admin table must render it as plain text (never `dangerouslySetInnerHTML`
  or unescaped interpolation) to avoid stored-XSS-via-audit-log.
- **Alerting vs. passive viewing.** Not addressed by the request at all.
  Recommend shipping passive viewing now and treating "email me after N
  failures on one account" as an explicit, separately-scoped follow-up (see
  out-of-scope below), not a silent scope expansion.
- **Filtering/search.** Not stated. Suggested MVP: reverse-chronological
  pagination plus a search-by-email box, consistent with other admin tables
  in this app. Confirm with the user this is sufficient for v1 (open
  question).
- **Empty state and failure microcopy.** Must follow the brand empty-state
  pattern (`bg-gray-50 rounded-2xl p-10 text-center text-gray-500`) and give
  a human sentence on query failure — not specified by the request, carried
  forward to tech-lead/ux-developer.
- **Mobile at 360px.** Not mentioned; should follow the existing
  `/admin/sync-log` / `/admin/email-queue` responsive pattern rather than
  inventing a new one.
- **Admin menu placement.** Architect's call, not blocking Phase 1, but
  flagging that it belongs in the same grouped-menu section as the other
  audit surfaces (sync-log, email-queue) rather than under Users or Roles.

### Out of scope (confirm with user)

- **Successful-login history/audit trail.** Only failed logins were
  requested; `lastLoginAt` already covers the successful case minimally.
- **Rate-limiting / account lockout after N failed attempts.** This is a
  neighboring security control, not a visibility feature — building it now
  would be scope creep the user didn't ask for.
- **Automated alerting/notification** (e.g., email the admin after N
  failures against one account). Candidate follow-up, not part of this ship.
- **IP-based geolocation, blocking, or any enforcement action** — this
  feature is "see," not "act."

### Open questions (only the user can answer)

1. **Retention:** how long should failed-login records be kept before
   pruning — 30 days, 90 days, a year, or indefinitely? This shapes whether
   Phase 3/4 needs a prune mechanism at all.
2. **Role exposure:** should `treasurer` or `board_member` also see this
   page by default, or is it Admin-only? (Default recommendation: Admin-only,
   since the data includes other members' email addresses and account
   status.)
3. **Alerting:** is a passive list enough for now, or do you want to be
   emailed when one account racks up repeated failures? If yes, that's a
   follow-up feature to scope separately, not part of this ship.
4. **v1 surface shape:** is a simple reverse-chronological list with a
   search-by-email box sufficient, or do you want grouped/count-by-account
   view up front (e.g., "5 failures for jane@example.com in the last hour")?

### User decisions (2026-07-21, answered via AskUserQuestion)

1. **Retention:** **90 days** — Phase 3 must include an automatic prune
   mechanism (no cron infra exists; likely opportunistic prune, tech-lead
   decides the trigger).
2. **Role exposure:** **Admin-only** — bind the new permission key to the
   Admin role only in the migration.
3. **Alerting:** **not selected** — passive viewing only; no email-alert
   follow-up work-log needed.
4. **v1 surface shape:** **both** the reverse-chronological list with
   search-by-email **and** the grouped/count-by-email view (counts +
   last-attempt time) are in scope for v1.

### Adversarial pass (Pass 5)

- **Redirect targets:** not applicable — no `callbackUrl`/`next`/`redirect`
  parameter exists in this flow.
- **State-machine shortcuts / direct URL access:** the primary real risk
  here. The failed-login list contains other members' (and strangers')
  email addresses plus account-security state. The new admin page **and**
  its underlying data-fetching route/action must both check
  `hasFeature(session.user.features, FEATURES.ADMIN_SECURITY_VIEW)`
  server-side — hiding the nav link alone is not sufficient. Restating this
  as a hard requirement for Phase 3/4, not a suggestion.
- **Enumeration leaks:** two angles. (1) The public-facing `/signin` error
  must **not** change as a side effect of this feature — it already appears
  to return one generic failure for unknown-email, no-password-set,
  deactivated, and bad-password cases, and that must stay true; the
  `reason` detail is admin-surface-only, never visitor-facing. (2) Within
  the admin table itself there's no meaningful enumeration risk since it's
  already gated to a trusted admin.
- **Input boundaries:** the attempted-email value is unauthenticated,
  arbitrary-length, arbitrary-Unicode input. The insert must be
  length-capped and must never throw in a way that surfaces to the
  requesting browser (ties back to the Flow A failure-path gap above).
- **Self-targeting:** not applicable — there is no self-service action in
  this flow; a member cannot grant themselves the new permission or clear
  their own record via any flow this feature introduces.

### Outputs

- `docs/work-log/2026-07-21-failed-login-visibility.md` — this Phase 1
  section, and the Per-Phase Status table row updated to
  `Complete | READY WITH NOTES | 2026-07-21`.

### Open questions / handoff notes

- Verdict is **READY WITH NOTES**, not a blocking NEEDS REWORK: the shape is
  well precedented (sync-log, email-queue) and every gap above has either a
  concrete suggested default or is explicitly deferred as out-of-scope.
  Architect and tech-lead can proceed using the suggested defaults, but the
  four open questions above should ideally get a quick answer from the user
  before Phase 3 locks the schema (retention shapes whether a prune job is
  even needed) and the role-binding migration (Admin-only vs. wider).
- Feasibility of capturing IP/user-agent via `next/headers` inside
  `authorize()`/the `signIn` callback is a technical question for tech-lead,
  not something I'm ruling on here — the request never asked for IP capture
  specifically, so treat it as a nice-to-have, not a requirement, unless the
  user says otherwise in the open questions above.
- Do not let this feature's implementation touch or redesign the `/signin`
  visitor-facing error copy — that is an explicit non-goal per the
  enumeration note above.

---

# Phase 2 — Architectural Review (architect) — 2026-07-21

**Owner:** architect
**Status:** complete
**Verdict:** Approved with suggestions

### Summary

The shape analyst specified maps cleanly onto existing precedent — this is
another audit table + admin read surface, structurally identical to
`google_group_sync_log` / `/admin/sync-log` and `email_queue` /
`/admin/email-queue`. No new top-level module, no new dependency, no
route-group change. The suggestions below are about closing a gap the
existing precedent has (weak/no feature-gating on `sync-log`) rather than
repeating it, and about exact naming so tech-lead doesn't have to re-derive
conventions.

### What I did

- Read the full work-log (Phase 1 + locked user decisions).
- Read `src/lib/permissions.ts` in full to check the `FEATURES` naming
  convention.
- Read `src/lib/auth/index.ts` in full to confirm the five failure branches
  and the existing fire-and-forget discipline (the `jwt` callback's IIFE
  around `lastLoginAt`/auto-link/admin-notify).
- Read `src/components/admin/admin-sidebar.tsx` in full to see how the
  grouped nav is built and how `System` items (`Email Queue`, `Sync Log`,
  `Release Notes`) are declared.
- Read `src/app/(dashboard)/admin/sync-log/page.tsx` and
  `src/app/(dashboard)/admin/email-queue/page.tsx` to check what gating
  precedent actually looks like today (not just what CLAUDE.md says it
  should look like).
- Checked `docs/decisions.md` for the threshold used on past new-table /
  new-permission entries (DECISION-001, DECISION-032, the `dues.view`/
  `dues.manage` entry) and `drizzle/migrations/` for the next free
  migration number.

### Ruling 1 — New table: fits the schema-is-source-of-truth invariant

A new `failed_login_attempts` (or `login_attempts`) table in
`src/lib/db/schema.ts` plus a matching idempotent migration in
`drizzle/migrations/` (next number `0054_...`) is the correct and only
mechanism — there is no way to bolt this onto an existing table without
overloading its meaning (this is not a `users` column; it's an append-only
log with no FK-required relationship to a resolved user, since unknown-email
attempts have no user row at all). Architecturally significant columns,
leaving exact types/precision to database-admin in Phase 3/4:

- `id` — PK, following existing convention (`uuid` matches every other new
  table in this schema; `google_group_sync_log` also uses `uuid`).
- `created_at` / `attempted_at` — timestamp. **Use `timestamptz`
  (`timestamp with time zone`)**, not a naive `timestamp`. This project has
  a documented naive-timestamp-as-UTC bug (see memory:
  `project_naive_timestamp_tz_bug`) on the *unrelated* `eventRsvps`/
  occurrence columns; a new audit-log timestamp must not repeat that
  mistake. `google_group_sync_log.createdAt` is the right precedent to
  copy, not the RSVP columns.
- `attempted_email` — text, **length-capped** (analyst's requirement — this
  is unauthenticated, attacker-controlled input). Recommend `varchar(255)`
  truncated at the recording call site, not relying on a DB constraint to
  reject-and-throw (a rejected insert must never propagate to the sign-in
  response — see Ruling 2).
- `provider` — enum-ish text (`"credentials"` | `"google"`) so the admin
  view can distinguish password attacks from OAuth-deactivated denials.
- `reason` — enum-ish text covering the five branches identified in Phase 1
  (unknown email, no password set, deactivated, bad password, OAuth
  deactivated). Tech-lead should fix the exact string values in Phase 3 so
  api-developer and ux-developer share one source of truth (a `const`
  array, not ad hoc strings scattered across `auth/index.ts` and the admin
  page).
- Optional `user_id` — nullable FK to `users(id)` with `ON DELETE SET NULL`
  (mirrors the pattern already used by
  `event_occurrence_overrides.cancelled_by_user_id` in DECISION-001) for the
  branches where a real user row exists (deactivated, bad-password), null
  for unknown-email attempts.
- IP/user-agent — Phase 1 correctly deferred this as a technical
  feasibility question, not a requirement. No architectural objection to
  adding nullable `ip_address`/`user_agent` columns if tech-lead confirms
  `next/headers` is reachable from both `authorize()` and the `signIn`
  callback; if added, same length-cap discipline applies.

This is a genuinely new table, not a rename/extension of anything, so it
belongs in `schema.ts` first, migration second, per the standard invariant —
no exception needed here.

### Ruling 2 — Recording helper lives in `src/lib/auth/`, not a new module

The two call sites (`Credentials.authorize()`'s five `return null` branches,
and the `signIn` callback's `return false` branch) are both already inside
`src/lib/auth/index.ts`. Precedent for "helpers colocated with the module
that uses them" is `src/lib/google-groups.ts` (sync helpers) and
`src/lib/email.ts` (email helpers) — both are single-purpose modules that
grew out of one call site's needs, not generic utilities. A failed-login
recorder is the same shape: it is *only* ever called from the auth config,
its contract is narrow ("record one row, never throw"), and it doesn't need
to be reachable from anywhere else in the app (the admin page reads the
table directly via Drizzle, it doesn't call the recorder). Recommend a new
file `src/lib/auth/failed-login.ts` (or a named export added directly to
`src/lib/auth/index.ts` if tech-lead judges it small enough) — either is
fine structurally; the constraint is that it must **not** live in a
generic `src/lib/` catch-all, since nothing outside the auth flow needs it.

**Hard requirement carried forward from Phase 1, restated architecturally:**
the recorder must follow the exact discipline already established at lines
108-170 of `src/lib/auth/index.ts` — fire-and-forget, wrapped in
`try { ... } catch { /* swallow */ }`, never awaited in a way that blocks
the `authorize()`/`signIn` return. Do not reuse the existing IIFE (that one
is scoped to successful sign-in bookkeeping) — add a second, independent
fire-and-forget call for the failure branches so a bug in one never touches
the other.

### Ruling 3 — Pruning: opportunistic, piggybacked on insert (no cron infra)

Agreed with the analyst's suggested default, now locked by the user at 90
days. There is no scheduled-job infra in this project (confirmed — no
cron/worker directory, no Vercel Cron config referenced anywhere in
CLAUDE.md's integrations list). Two patterns fit "no cron infra, club
scale":

(a) **Piggyback on insert** — after recording a new row, opportunistically
`DELETE FROM failed_login_attempts WHERE created_at < now() - interval '90
days'` in the same fire-and-forget block, cheaply rate-limited (e.g., only
run the delete when `random() < 0.05` or similar, so a busy day doesn't run
a delete on every single failed attempt) — or simply run it unconditionally
since a bounded delete against an indexed timestamp column is cheap even at
club scale.

(b) **Piggyback on admin page load** — prune when the admin opens
`/admin/security` (or whatever tech-lead names it), before rendering.

Recommend **(a)**, run unconditionally on every insert (no probabilistic
gate needed at this data volume — a Lions club generates dozens of failed
logins a month, not thousands), because it guarantees the table never grows
unbounded even if the admin never opens the page, and because it keeps the
prune logic in one place (the recorder) rather than splitting "write" and
"prune" responsibility between the auth module and the admin page. This is
a Phase 3 implementation-order call to confirm, not a hard architectural
requirement — either pattern is acceptable, but (a) shouldn't be dismissed
without a reason.

### Ruling 4 — Admin surface placement

New page at `src/app/(dashboard)/admin/security/page.tsx` (or `/admin/
security-log` — tech-lead's call on the exact slug; `security` reads
better against the "System" nav grouping and leaves room for
`/admin/security/...` sub-surfaces later if this grows). Belongs in the
**`System`** nav group in `src/components/admin/admin-sidebar.tsx`,
alongside `Email Queue` and `Sync Log` — these are the app's other
audit/log surfaces and the grouping already exists; do not create a new
nav group for one item.

**One correction to the precedent, not a repeat of it:** `Email Queue`'s
nav item has `requiredFeature: FEATURES.ADMIN_USERS` gating it, but `Sync
Log` and `Release Notes` have **no `requiredFeature` at all** — meaning any
user who can see the admin dashboard at all sees those two links, and
`sync-log/page.tsx` enforces nothing beyond `auth()` (no `hasFeature` call
in the page body at all — confirmed by reading the file). That is a quiet
existing gap, not a pattern to copy. This feature's data — other members'
email addresses plus account-security state — is more sensitive than sync
log rows, and the analyst's adversarial pass already made server-side
gating a hard requirement. The new nav item **must** carry
`requiredFeature: FEATURES.ADMIN_SECURITY_VIEW`, and the page itself
**must** call `hasFeature()` server-side (matching `email-queue/page.tsx`'s
pattern, which does gate correctly), independent of the nav hiding the
link. Flagging the `sync-log` gap as a candidate item for the next 30-day
code review rather than fixing it here — out of scope for this feature.

Server Component page, `auth()` + `hasFeature(session.user.features,
FEATURES.ADMIN_SECURITY_VIEW)` at the top, `redirect("/access-pending")` (or
`/signin` if unauthenticated) on failure — standard pattern, no deviation
needed. Any data-fetching route/server action backing search/filter must
re-check the same gate independently (analyst's hard requirement, seconded
here).

### Ruling 5 — New `FEATURES` key: name and category fit

`FEATURES.ADMIN_SECURITY_VIEW = "admin.security_view"` fits the existing
`admin.*` category (`admin.dashboard`, `admin.users`, `admin.roles` are the
current members) both in constant-naming style (`ADMIN_<NOUN>`) and string
convention. One naming nit: every other value in the catalog uses a single
word after the dot (`dashboard`, `users`, `roles`, `manage`, `view`) — no
existing key uses a `snake_case` compound after the dot. Recommend
`"admin.security"` instead of `"admin.security_view"` for the string value
(shorter, matches the one-word-after-dot convention, and reads naturally as
"the `admin.security` permission"), while keeping the TypeScript constant
name `ADMIN_SECURITY_VIEW` for clarity in code (matches `IMPACT_VIEW` /
`DUES_VIEW`'s "action-suffixed" constant-naming even though their string
values are `impact.view`/`dues.view` — those two use "action-suffix" for
both key and string. Tech-lead should pick **one** convention and apply it
consistently: either `ADMIN_SECURITY_VIEW: "admin.security_view"` (matching
`DUES_VIEW`/`IMPACT_VIEW`'s dot-suffix style) or `ADMIN_SECURITY: "admin.security"`
(matching `ADMIN_DASHBOARD`/`ADMIN_USERS`/`ADMIN_ROLES`'s bare-noun style,
since this is also an `admin.*` key). Not a blocking issue either way — pick
whichever reads better in the permissions admin UI table, since both are
internally consistent with different existing precedents in the same file.
Use the `add-permission` skill for the idempotent migration + Admin-only
role binding (locked user decision — do not bind to `treasurer` or
`board_member`).

### Ruling 6 — Dependencies

Confirmed: none needed. No new npm package required for table storage,
recording, pruning, or the admin list/search/grouped-count views — all of
this is Drizzle queries and server-rendered React, both already fully
supported by the current stack. Search-by-email is a simple `ilike` filter;
grouped count-by-email is a `GROUP BY` aggregate — no new query-building
library warranted.

### Ruling 7 — Invariants

- **Permissions-only gating** — satisfied by Ruling 4/5; no environment
  flag introduced.
- **No native dialogs** — no destructive action exists in v1 (passive
  viewing only, per locked user decision on alerting/scope); if a future
  "clear old entries" manual action is added, it must use `<ConfirmDialog>`
  per the analyst's Phase 1 note, not `window.confirm()`.
- **Idempotent migrations** — the new-table migration must use
  `CREATE TABLE IF NOT EXISTS` and any index/constraint guarded per the
  existing `drizzle/migrations/` convention (e.g., DECISION-001's
  `event_occurrence_overrides` migration is the right template to copy).
- **No secrets** — not applicable; no new env var introduced by this
  feature.

**`docs/decisions.md` entry: warranted, but write it in Phase 3, not here.**
Past entries at this repo's threshold (DECISION-001's table/column-type/API-
shape ruling; the `dues.view`/`dues.manage` role-binding ruling) are written
once the exact schema and API shape are locked, which happens in Phase 3,
not Phase 2 — Phase 2 rules on placement and fit, Phase 3 commits to exact
names. Tech-lead should add the decision entry as part of the Phase 3
design doc, covering: (1) the table name and the `reason`/`provider` enum
values, (2) the `FEATURES.ADMIN_SECURITY_VIEW` string-value convention
choice from Ruling 5, (3) the opportunistic-prune-on-insert pattern from
Ruling 3. This is architecturally anticipated, not a Phase 2 blocker.

### Outputs

- `docs/work-log/2026-07-21-failed-login-visibility.md` — this Phase 2
  section, and the Per-Phase Status table row updated to
  `Complete | Approved with suggestions | 2026-07-21`.
- No `docs/decisions.md` entry written yet — deferred to Phase 3 per Ruling
  7 (exact schema/permission-string choices aren't locked until tech-lead's
  design doc).

### Open questions / handoff notes

- **Tech-lead must pick one `FEATURES` naming convention** (Ruling 5) and
  state the choice explicitly in the Phase 3 design doc — either
  `ADMIN_SECURITY_VIEW: "admin.security_view"` or
  `ADMIN_SECURITY: "admin.security"`. Not blocking, but must not be left
  ambiguous into Phase 4.
- **Tech-lead must fix the exact `reason`/`provider` enum string values**
  (Ruling 1) as a single source of truth shared by the recorder and the
  admin page — do not let api-developer and ux-developer invent
  independent string literals.
- **Confirm the opportunistic-prune-on-insert pattern (Ruling 3)** or
  document why the page-load variant is preferred instead — either is
  architecturally acceptable, but the choice should be explicit in the
  design doc, not implicit in the implementation.
- **Do not copy `sync-log`'s missing `hasFeature()` gate.** This is flagged
  as a quiet existing invariant violation for the next 30-day code review,
  not something to fix as part of this feature — but the new page must not
  repeat it. `email-queue/page.tsx`'s gating is the correct pattern to
  follow.
- **Write the `docs/decisions.md` entry in Phase 3**, once table/column and
  permission-string choices are locked (see Ruling 7).
- No architectural loop-back to Phase 1 — the feature shape is sound as
  specified.

---

# Phase 3 — Technical Design (tech-lead) — 2026-07-21

**Owner:** tech-lead
**Status:** complete

## Technical Design: Failed Login Visibility

### Summary

We're adding a passive, Admin-only audit surface that records every failed
sign-in attempt — five branches inside `Credentials.authorize()` (missing
credentials, unknown email, no-password-set/OAuth-only account, deactivated
account, bad password) plus the separate `signIn`-callback branch that denies
a deactivated Google user — into a new `failed_login_attempts` table, and
surfaces them at `/admin/security` as a reverse-chronological searchable list
plus a grouped count-by-email view. Recording is fire-and-forget and never
alters the existing `/signin` visitor-facing behavior (no enumeration
change). Rows are pruned after 90 days opportunistically on every insert, so
no cron/worker infra is needed. This closes a real blind spot: today a
brute-force run, a locked-out member, or a deactivated user trying to get
back in are all completely invisible to the club admin.

### Read this alongside

Phase 1 (`analyst`, READY WITH NOTES) and Phase 2 (`architect`, Approved with
suggestions) sections above — this design implements their locked decisions
and rulings without relitigating them. Notably: 90-day retention, Admin-only
binding, both list-view and grouped-view in v1, no alerting, `timestamptz`
not naive `timestamp`, length-capped `attempted_email`, nullable `user_id` FK
`ON DELETE SET NULL`, recorder lives in `src/lib/auth/`, opportunistic prune
on insert, page at `/admin/security` in the `System` nav group following
`email-queue`'s (not `sync-log`'s) gating pattern.

### Isolation note

This design touches `src/lib/db/schema.ts`, `src/lib/permissions.ts`,
`src/lib/auth/index.ts`, a new `src/lib/auth/failed-login.ts` +
`failed-login.test.ts`, `src/components/admin/admin-sidebar.tsx`, a new
`src/app/(dashboard)/admin/security/page.tsx`, and two new migrations. It
does **not** touch `src/lib/ledger.ts`, `src/lib/ledger-queries.ts`,
`src/components/members/impact-by-cause.tsx`, `src/lib/ledger-impact.test.ts`,
or `docs/work-log/2026-07-21-impact-cause-drilldown.md` — those belong to a
concurrently-running agent on a different feature. No file overlap.

### Permissions

- **New permission key: `FEATURES.ADMIN_SECURITY_VIEW = "admin.security_view"`.**
  Convention choice (Architect Ruling 5 left this open): I'm using the
  action-suffixed dot-value style (`DUES_VIEW: "dues.view"`,
  `LEDGER_VIEW: "ledger.view"`, `IMPACT_VIEW: "impact.view"`) rather than the
  bare-noun style (`ADMIN_USERS: "admin.users"`), because this permission is
  explicitly view-only in v1 and the analyst's Phase 1 notes already flag a
  plausible future "clear old entries" admin action — exactly the shape that
  produces a `VIEW`/`MANAGE` split elsewhere in this catalog (`DUES_VIEW` +
  `DUES_MANAGE`, `LEDGER_VIEW` + `LEDGER_MANAGE`). Landing on
  `admin.security_view` now leaves room for `admin.security_manage` later
  without a rename. Category stays `admin` (`FEATURE_CATEGORIES.ADMIN`
  already exists — no new category needed; `getFeaturesByCategory("admin")`
  still matches on the `admin.` prefix).
- **Role binding: Admin only** (locked user decision). Do not bind to
  `treasurer` or `board_member` — this data includes other members' email
  addresses and account-security state, a stricter bar than `impact.view`,
  which does extend to those two roles.
- Migration follows the `add-permission` skill pattern exactly (see Data
  Model below for the SQL).

### API Contract

**No new route handler or server action.** This is a server-rendered page
that reads directly via Drizzle inside the Server Component, identical in
shape to `/admin/sync-log` and `/admin/email-queue` — both are read-only
audit surfaces with zero client-side fetch today. Search-by-email and
pagination are plain `GET` `searchParams` (`?email=...&page=...`), read
server-side; no client component, no API surface to double-gate. The single
gate is the page itself (`auth()` + `hasFeature()`), which is exactly the
"page AND any data route/action both check `hasFeature()`" requirement — here
there is only one surface, because there is no second surface to skip.

`src/app/(dashboard)/admin/security/page.tsx` — server component, params:
`searchParams: Promise<{ email?: string; page?: string }>`.
- Reads `email` (optional, case-insensitive partial match via `ilike`) and
  `page` (1-indexed, `PAGE_SIZE = 25`, matching `sync-log`'s pagination
  constant).
- Runs three queries in parallel (`Promise.all`, matching the batch-fetch
  discipline already used by `sync-log/page.tsx` and `getDashboard()` per
  DECISION-031):
  1. Reverse-chronological page of rows, filtered by `email` if present.
  2. `count(*)` for the same filter, for pagination.
  3. Grouped-by-email summary: `attempted_email`, `count(*)`,
     `max(created_at)` as `last_attempt_at`, `GROUP BY attempted_email`,
     `ORDER BY count(*) DESC, max(created_at) DESC`, `LIMIT 200`. **Not**
     scoped by the `email` searchParam — it's an always-complete summary,
     independent of the list's search filter, per the user's locked "both"
     decision (list search and grouped view are two separate v1
     requirements, not one gating the other).
- On any query throwing, the page must render a human sentence, not a stack
  trace — wrap the three-query `Promise.all` in `try/catch` (matching
  DECISION-032's inline-`try/catch`-in-`page.tsx` pattern, not a new
  `error.tsx` — this codebase has zero `error.tsx` files and one page
  doesn't warrant introducing the pattern).

### Data Model

New table `failed_login_attempts` (add to `src/lib/db/schema.ts`, alongside
`googleGroupSyncLog` — same "append-only audit log" shape):

```typescript
export const failedLoginAttempts = pgTable(
  "failed_login_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    attemptedEmail: varchar("attempted_email", { length: 255 }).notNull(),
    provider: text("provider").notNull(), // 'credentials' | 'google'
    reason: text("reason").notNull(), // see FAILED_LOGIN_REASONS in src/lib/auth/failed-login.ts
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ix_failed_login_attempts_created_at").on(t.createdAt),
    index("ix_failed_login_attempts_email").on(t.attemptedEmail),
  ]
);

export type FailedLoginAttempt = typeof failedLoginAttempts.$inferSelect;
export type NewFailedLoginAttempt = typeof failedLoginAttempts.$inferInsert;
```

`varchar` isn't currently imported in `schema.ts` (only `text`, `timestamp`,
`uuid`, `boolean`, `integer`, `date`, `jsonb`, `unique`, `index`,
`uniqueIndex`, `AnyPgColumn`) — add it to the top-of-file import list.
`timestamptz` (`{ withTimezone: true }`) is a hard requirement per Architect
Ruling 1, to avoid repeating the documented naive-timestamp-as-UTC bug on
`eventRsvps`/occurrence columns (see memory:
`project_naive_timestamp_tz_bug`) — `google_group_sync_log.createdAt` (a
plain `timestamp`, not `timestamptz`) is *not* the pattern to copy here;
`event_occurrence_overrides.cancelledAt` (`{ withTimezone: true }`) is.

**Enum values (single source of truth in `src/lib/auth/failed-login.ts`,
shared by the recorder and the admin page — do not let two independent
literal-string sets exist):**

```typescript
export const FAILED_LOGIN_PROVIDERS = ["credentials", "google"] as const;
export type FailedLoginProvider = (typeof FAILED_LOGIN_PROVIDERS)[number];

export const FAILED_LOGIN_REASONS = [
  "missing_credentials",
  "unknown_email",
  "no_password_set",
  "deactivated",
  "bad_password",
  "oauth_deactivated",
] as const;
export type FailedLoginReason = (typeof FAILED_LOGIN_REASONS)[number];

export const FAILED_LOGIN_REASON_LABELS: Record<FailedLoginReason, string> = {
  missing_credentials: "Missing email or password",
  unknown_email: "Unknown email address",
  no_password_set: "No password set (Google-only account)",
  deactivated: "Deactivated account (password sign-in)",
  bad_password: "Incorrect password",
  oauth_deactivated: "Deactivated account (Google sign-in)",
};
```

These six reasons map 1:1 to the analyst's hard requirement (five
`authorize()` branches + the one `signIn`-callback branch) — no branch is
folded into another.

**Migration sketch — two files, following this repo's established
"table migration, then permission migration" convention** (see
`0044_ledger_books.sql` → `0045_ledger_permissions.sql`,
`0040_dues_tracking.sql` → `0041_dues_permissions.sql`), not one combined
file:

`drizzle/migrations/0054_failed_login_attempts.sql`:
```sql
-- Failed Login Visibility: failed_login_attempts audit table.
-- Idempotent; safe to re-run on every deploy.

CREATE TABLE IF NOT EXISTS failed_login_attempts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempted_email VARCHAR(255) NOT NULL,
  provider        TEXT NOT NULL,
  reason          TEXT NOT NULL,
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'ix_failed_login_attempts_created_at'
  ) THEN
    CREATE INDEX ix_failed_login_attempts_created_at ON failed_login_attempts (created_at DESC);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'ix_failed_login_attempts_email'
  ) THEN
    CREATE INDEX ix_failed_login_attempts_email ON failed_login_attempts (attempted_email);
  END IF;
END $$;
```

`drizzle/migrations/0055_admin_security_permission.sql`:
```sql
-- Failed Login Visibility: admin.security_view permission, Admin-only.
INSERT INTO features (name, category, description)
SELECT 'admin.security_view', 'admin', 'View failed sign-in attempts and account security events'
WHERE NOT EXISTS (SELECT 1 FROM features WHERE name = 'admin.security_view');

INSERT INTO role_features (role_id, feature_id)
SELECT r.id, f.id FROM roles r CROSS JOIN features f
WHERE r.name = 'admin' AND f.name = 'admin.security_view'
AND NOT EXISTS (
  SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
);
```

Both queries the admin page needs are cheap at this data volume (dozens of
failed attempts/month per Architect's estimate, bounded further by the
90-day prune): the reverse-chron list uses
`ix_failed_login_attempts_created_at`; the email search and the grouped
`GROUP BY attempted_email` both use `ix_failed_login_attempts_email`.

### Component/Page Plan

**Pages to create:**
- `src/app/(dashboard)/admin/security/page.tsx` — the only new page. No
  sub-pages, no client component needed (search is a GET `<form>`,
  pagination is `<a>` links — same zero-client-JS pattern as `sync-log` and
  `email-queue`).

**Components to create:** none. Unlike `email-queue` (which needed a
`RetryButton` client component for its one interactive action), this feature
has no interactive action in v1 — passive viewing only, per the locked
"alerting not selected" / no-clear-action decision. The whole page is a
single Server Component file.

**Files to modify:**
- `src/lib/db/schema.ts` — add `failedLoginAttempts` table + types + `varchar` import.
- `src/lib/permissions.ts` — add `FEATURES.ADMIN_SECURITY_VIEW` +
  `FEATURE_DESCRIPTIONS[FEATURES.ADMIN_SECURITY_VIEW]`.
- `src/lib/auth/index.ts` — add `recordFailedLogin()` calls at all six
  branches (see Edge Cases below for the one required branch-split).
- `src/components/admin/admin-sidebar.tsx` — new nav item in the `System`
  group:
  ```typescript
  {
    name: "Security",
    href: "/admin/security",
    icon: "🛡️",
    requiredFeature: FEATURES.ADMIN_SECURITY_VIEW,
  },
  ```
  Placed after "Sync Log", before "Release Notes" (ordered roughly by
  sensitivity — audit surfaces first, docs last). **This is the correction
  to precedent, not a repeat of it** — `Email Queue`, `Sync Log`, and
  `Release Notes` today have inconsistent (missing, for two of the three)
  `requiredFeature` gating; the new item must carry `requiredFeature`
  explicitly, and the page itself must independently call `hasFeature()`
  server-side (matching `email-queue/page.tsx`, not `sync-log/page.tsx`,
  which has no `hasFeature` call at all — flagged for the next 30-day code
  review, not fixed here).

**New files:**
- `drizzle/migrations/0054_failed_login_attempts.sql`
- `drizzle/migrations/0055_admin_security_permission.sql`
- `src/lib/auth/failed-login.ts` — recorder + enums + pure helpers (see below).
- `src/lib/auth/failed-login.test.ts` — Vitest unit tests (named below).

### `src/lib/auth/failed-login.ts` — exact contract

```typescript
import { db } from "@/lib/db";
import { failedLoginAttempts } from "@/lib/db/schema";
import { lt } from "drizzle-orm";

export const FAILED_LOGIN_PROVIDERS = ["credentials", "google"] as const;
export type FailedLoginProvider = (typeof FAILED_LOGIN_PROVIDERS)[number];

export const FAILED_LOGIN_REASONS = [ /* six values, see Data Model */ ] as const;
export type FailedLoginReason = (typeof FAILED_LOGIN_REASONS)[number];

export const FAILED_LOGIN_REASON_LABELS: Record<FailedLoginReason, string> = { /* … */ };

const MAX_EMAIL_LENGTH = 255;
const PRUNE_WINDOW_DAYS = 90;

/** Trims, caps at 255 chars, and falls back to a placeholder for empty input.
 *  Does NOT escape/strip HTML — storage is plain text; the admin page must
 *  render it as plain text (React's default JSX interpolation), never
 *  `dangerouslySetInnerHTML`. */
export function normalizeAttemptedEmail(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim();
  if (trimmed.length === 0) return "(none provided)";
  return trimmed.slice(0, MAX_EMAIL_LENGTH);
}

/** Pure — the cutoff instant before which rows should be pruned. Exported
 *  and unit-tested standalone so prune correctness doesn't depend on the DB. */
export function pruneCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - PRUNE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

/** Fire-and-forget. MUST NEVER throw into the caller — authorize()/signIn
 *  must see zero effect from this call succeeding or failing. Independent
 *  of the existing lastLoginAt/auto-link/admin-notify IIFE at lines
 *  108-170 of auth/index.ts — a bug in one must never touch the other. */
export function recordFailedLogin(params: {
  attemptedEmail: string | null | undefined;
  provider: FailedLoginProvider;
  reason: FailedLoginReason;
  userId?: string | null;
}): void {
  (async () => {
    try {
      await db.insert(failedLoginAttempts).values({
        attemptedEmail: normalizeAttemptedEmail(params.attemptedEmail),
        provider: params.provider,
        reason: params.reason,
        userId: params.userId ?? null,
      });
      await db
        .delete(failedLoginAttempts)
        .where(lt(failedLoginAttempts.createdAt, pruneCutoff()));
    } catch {
      // Swallow — recording must never affect the sign-in response.
    }
  })();
}
```

Prune choice, stated explicitly per the locked requirement to state it:
**opportunistic, piggybacked on insert, unconditional** (Architect's option
(a), no probabilistic gate). `pruneCutoff()` is a plain JS Date computation
rather than a Postgres `now() - interval '90 days'` expression — this makes
it independently unit-testable without a DB connection and avoids any
Postgres-interval-syntax edge case. The delete runs unconditionally after
every insert; at club-scale volume (dozens/month) this is cheap against the
indexed `created_at` column and guarantees the table never grows unbounded
even if the admin never opens `/admin/security`.

### `src/lib/auth/index.ts` — exact call sites

Six call sites, four of them requiring a code change beyond "add a call"
because the current code collapses two logical cases into one `if`:

1. **`if (!credentials?.email || !credentials?.password) return null;`** →
   add `recordFailedLogin({ attemptedEmail: credentials?.email as string | undefined, provider: "credentials", reason: "missing_credentials" })` before the `return null`.
2. **`if (!user || !user.password) { return null; }`** — **must be split
   into two branches**, because today one `if` covers both "no user row
   exists" (reason should be `unknown_email`) and "user exists but has no
   password set, i.e. an OAuth-only account" (reason should be
   `no_password_set`, and this is the one branch where a real `userId`
   exists even though the sign-in fails):
   ```typescript
   if (!user) {
     recordFailedLogin({ attemptedEmail: credentials.email as string, provider: "credentials", reason: "unknown_email" });
     return null;
   }
   if (!user.password) {
     recordFailedLogin({ attemptedEmail: credentials.email as string, provider: "credentials", reason: "no_password_set", userId: user.id });
     return null;
   }
   ```
3. **`if (!user.isActive) { return null; }`** → add
   `recordFailedLogin({ attemptedEmail: credentials.email as string, provider: "credentials", reason: "deactivated", userId: user.id })`.
4. **`if (!isValidPassword) { return null; }`** → add
   `recordFailedLogin({ attemptedEmail: credentials.email as string, provider: "credentials", reason: "bad_password", userId: user.id })`.
5. **`signIn({ user })` callback, `return dbUser.isActive;`** → change to:
   ```typescript
   if (!dbUser.isActive) {
     recordFailedLogin({ attemptedEmail: user.email, provider: "google", reason: "oauth_deactivated", userId: user.id });
     return false;
   }
   return true;
   ```

**Confirmed (tech-lead ruling, not just a nice-to-have): the `signIn`
callback's `isActive` check only fires in practice for OAuth sign-ins.**
When `Credentials.authorize()` returns `null`, NextAuth never invokes the
`signIn` callback for that attempt — so branches 1–4 and branch 5 are
mutually exclusive per request, and a deactivated Credentials user is never
double-recorded. This resolves the one open question the architect left
implicit; api-developer does not need to add any de-duplication logic.

**Provider value for branch 5 is hardcoded `"google"`**, not derived from
`account?.provider`, since Google is the only configured OAuth provider
today (`FAILED_LOGIN_PROVIDERS` only has two members). Named tradeoff: if a
second OAuth provider is ever added, both the enum and this literal need
widening — acceptable now, premature to generalize for a provider that
doesn't exist.

### IP address / user agent — ruled OUT of v1

Phase 1 correctly scoped this as a nice-to-have, not a requirement, and
asked tech-lead to rule on feasibility. Ruling: **do not capture IP/user
agent in v1.** `next/headers`' `headers()` is documented as reachable inside
Server Components, Route Handlers, and Server Actions via Next.js's
request-scoped `AsyncLocalStorage`; NextAuth's `authorize()`/`signIn`
callbacks execute inside the App Router route handler NextAuth itself
registers, so it would very likely work — but "very likely" is exactly the
kind of unverified assumption that shouldn't get baked into a schema
decision for a security-sensitive audit table on the first pass. Recording
must never throw (hard requirement), and introducing an unverified API call
into that fire-and-forget block adds risk for a feature explicitly scoped as
optional. Ship v1 without `ip_address`/`user_agent` columns. If
api-developer verifies `headers()` works cleanly during Phase 4 (a five
minute spike), that's a candidate **additive, non-blocking fast-follow**
migration (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`), not part of this
ship.

### Implementation Order

1. **Schema** — `src/lib/db/schema.ts` (`failedLoginAttempts` table + `varchar` import), `drizzle/migrations/0054_failed_login_attempts.sql`. Idempotent, re-runs every deploy.
2. **Permissions** — `src/lib/permissions.ts` (`FEATURES.ADMIN_SECURITY_VIEW`), `drizzle/migrations/0055_admin_security_permission.sql` (Admin-only binding), via the `add-permission` skill pattern.
3. **API/server logic** — `src/lib/auth/failed-login.ts` (recorder, `normalizeAttemptedEmail`, `pruneCutoff`, enums/labels) + its five named unit tests; `src/lib/auth/index.ts` (six call sites, one required branch-split).
4. **UI** — `src/app/(dashboard)/admin/security/page.tsx` (gated Server Component; list + search + pagination + grouped view + empty/failure states), `src/components/admin/admin-sidebar.tsx` (new nav item).
5. **Email notifications** — none. This feature has no email-notification component (locked: alerting was explicitly not selected).
6. **Release notes** — write via `/release-notes` when preparing to merge to main.

### Edge Cases & Risks

- **Attacker-typed email is unauthenticated arbitrary input.** Handled by
  `normalizeAttemptedEmail()` (trim + 255-char cap) before every insert, plus
  the `VARCHAR(255)` column as defense-in-depth. The admin page renders
  `attemptedEmail` via plain JSX interpolation (React auto-escapes) — never
  `dangerouslySetInnerHTML` — closing the stored-XSS-via-audit-log risk the
  analyst flagged.
- **Recording must never block or alter the sign-in response.** Enforced by
  the fire-and-forget IIFE with a swallowed `catch`, structurally identical
  in discipline to (but functionally independent from) the existing
  `lastLoginAt`/auto-link/admin-notify IIFE at lines 108–170 of
  `auth/index.ts`. A DB outage during a failed-login recording attempt
  degrades silently; the visitor still sees whatever `/signin` shows today.
- **Enumeration:** zero changes to `/signin`'s visitor-facing error copy or
  behavior — every change in `auth/index.ts` is additive (a call before an
  existing `return null`/`return false`), never a change to what's returned
  or how the visitor's browser behaves.
- **The `unknown_email`/`no_password_set` branch split is a real logic
  change, not just an additive call** — see the `auth/index.ts` section
  above. This is the one place implementation could accidentally under-scope
  by treating this as "add six calls" when it's actually "add six calls plus
  one `if` split."
- **Grouped-view cost:** `GROUP BY attempted_email` over a 90-day-capped,
  club-scale table (dozens/month) is cheap; `ix_failed_login_attempts_email`
  backs both the grouped aggregate and the search filter.
- **Query-failure and empty states both need human copy** (analyst hard
  requirement) — empty state uses the standard
  `bg-gray-50 rounded-2xl p-10 text-center text-gray-500` pattern (matching
  `email-queue`'s "No failed emails" card, not `sync-log`'s plainer
  bordered-box style); query failure gets a plain sentence via the
  `try/catch` around the `Promise.all`.
- **Mobile (360px):** reuse `email-queue`'s `overflow-x-auto` wrapped table
  pattern for the reverse-chron list and the grouped table — no new
  responsive pattern invented.
- **Concurrent unrelated feature:** confirmed no file overlap with the
  in-flight impact-cause-drilldown work (see Isolation note above).

### Out of Scope

- Successful-login audit trail (locked — not requested; `lastLoginAt`
  already covers it minimally).
- Rate-limiting / account lockout after N failed attempts (locked — a
  neighboring security control, not a visibility feature).
- Automated alerting/notification on repeated failures (locked — "not
  selected" per user decision).
- IP-based geolocation, blocking, or any enforcement action (locked — "see,"
  not "act").
- IP address / user-agent capture in v1 (ruled out above — candidate,
  additive fast-follow only).
- Extending `treasurer`/`board_member` access to this data (locked —
  Admin-only).
- A manual "clear old entries" action (not requested; 90-day auto-prune
  already handles retention without a destructive admin action / any
  `<ConfirmDialog>` surface).

### Named Unit Tests (Vitest — implementer delivers these, not qa)

All in `src/lib/auth/failed-login.test.ts`, colocated per this codebase's
convention (e.g. `src/lib/ledger-impact.test.ts`):

1. `pruneCutoff()` returns exactly `now - 90 days` (`90 * 24 * 60 * 60 * 1000` ms) given a fixed injected `now`.
2. `normalizeAttemptedEmail()` truncates a value longer than 255 characters down to exactly 255 characters.
3. `normalizeAttemptedEmail()` returns the `"(none provided)"` placeholder for `null`, `undefined`, empty string, and whitespace-only input.
4. `normalizeAttemptedEmail()` passes through HTML/script-like characters (e.g. `"<script>alert(1)</script>@evil.com"`) unescaped but still enforces the 255-char cap — storage doesn't sanitize; rendering does.
5. Enum-completeness: every value in `FAILED_LOGIN_REASONS` has a corresponding entry in `FAILED_LOGIN_REASON_LABELS`, and vice versa (no orphans in either direction) — guards against the recorder and the admin page silently drifting apart.

### Outputs

- `docs/work-log/2026-07-21-failed-login-visibility.md` — this Phase 3
  section, and the Per-Phase Status table row updated to
  `Complete | Design Complete | 2026-07-21`.
- `docs/decisions.md` — **DECISION-033** appended (table/enum shape,
  `admin.security_view` naming-convention choice, opportunistic-prune
  pattern via `pruneCutoff()`, IP/UA ruled out of v1, the required
  `unknown_email`/`no_password_set` branch split).

### Open questions / handoff notes

This is the classic specialist split (database-admin → api-developer →
ux-developer) — confirmed, not overridden. The feature has a genuinely new
table, genuinely new server-side recording logic with required unit tests,
and a genuinely new (if simple) admin page; nothing here is small/coupled
enough to justify full-stack-developer, and the work-log's original
complexity rationale was already correct.

1. **Use the database-admin agent first.** Delivers: `failedLoginAttempts`
   in `src/lib/db/schema.ts` (with the `varchar` import added),
   `drizzle/migrations/0054_failed_login_attempts.sql`,
   `FEATURES.ADMIN_SECURITY_VIEW` + its `FEATURE_DESCRIPTIONS` entry in
   `src/lib/permissions.ts`, and
   `drizzle/migrations/0055_admin_security_permission.sql` (Admin-only
   binding, via the `add-permission` skill pattern). Runs both migrations
   locally and confirms clean apply before handoff.
2. **Then the api-developer agent.** Delivers: `src/lib/auth/failed-login.ts`
   (recorder, `normalizeAttemptedEmail`, `pruneCutoff`, the shared
   enums/labels) and `src/lib/auth/failed-login.test.ts` (the five named
   tests above, passing); the six call sites in `src/lib/auth/index.ts`
   including the required `unknown_email`/`no_password_set` branch split and
   the `signIn`-callback `oauth_deactivated` branch. Must confirm — by
   reading the actual NextAuth v5 control flow, not assuming — that
   `authorize()` returning `null` really does skip the `signIn` callback for
   that same request (stated as a tech-lead ruling above; worth a quick
   sanity check against `next-auth`'s source/docs during implementation
   since it's load-bearing for "no double-recording").
3. **Then the ux-developer agent.** Delivers:
   `src/app/(dashboard)/admin/security/page.tsx` (gated on
   `FEATURES.ADMIN_SECURITY_VIEW`, list + search + pagination + grouped view
   + empty/failure states, `overflow-x-auto` mobile pattern) and the new
   "Security" nav item in `src/components/admin/admin-sidebar.tsx`
   (`requiredFeature: FEATURES.ADMIN_SECURITY_VIEW`, placed in the `System`
   group after "Sync Log").

No loop-back to Phase 1 or Phase 2 — the feature shape and all architectural
rulings hold as specified; this design only resolves the implementation-level
choices Phase 2 explicitly deferred.

---

# Phase 4 — Implementation

## Increment A — database-admin (schema + migrations + permission) — 2026-07-21

**Owner:** database-admin
**Status:** complete

### Summary

Added the `failed_login_attempts` audit table to `src/lib/db/schema.ts`, the
matching idempotent migration `0054_failed_login_attempts.sql`, the new
`FEATURES.ADMIN_SECURITY_VIEW` permission key + description in
`src/lib/permissions.ts`, and its Admin-only role-binding migration
`0055_admin_security_permission.sql` — exactly as specified in the Phase 3
design doc's Data Model / Permissions sections. Ran both migrations locally
twice to confirm idempotency, verified the live table shape and the role
binding via `psql`, and confirmed `pnpm exec tsc --noEmit` is clean. No files
outside my scope were touched; `src/lib/auth/`, `src/components/members/`,
`src/lib/ledger*.ts`, and the two concurrent work-logs were left untouched
per the isolation instructions.

### What I did

- Read the full work-log (Phases 1–3) to pull the exact column
  types/caps/indexes/enum values from the tech-lead's binding design doc
  rather than re-deriving them.
- Confirmed the next free migration number via
  `ls drizzle/migrations/*.sql | sort | tail -3` — the highest existing file
  was `0053_ledger_category_counts_as_giving.sql`, so `0054`/`0055` (as the
  design doc anticipated) were in fact still free; no renumbering needed.
- Checked `git status` before touching anything — `src/lib/db/schema.ts` and
  `src/lib/permissions.ts` had zero uncommitted changes from the concurrent
  impact-cause-drilldown/bank-reconciliation work (only
  `ledger*.ts`/`impact-by-cause.tsx`/`CLAUDE.md`/`docs/decisions.md` were
  dirty), so it was safe to proceed without a `db:push` collision risk.
- Read `src/lib/db/schema.ts` in full to find the right import list and
  insertion point (end of file, after `ledgerFilings`, matching the
  "one export block per feature" convention) and confirmed `varchar` was not
  yet imported.
- Read `drizzle/migrations/0050_impact_view_permission.sql` and the live
  `features`/`role_features` table definitions in `schema.ts` to confirm the
  actual column names (`features.name`/`category`/`description`,
  `role_features.role_id`/`feature_id`) — the `add-permission` skill's own
  SKILL.md template uses stale column names (`key`/`feature_key`) that don't
  match this schema, so I followed the verified live schema + the design
  doc's migration sketch instead of the skill's generic template.
- Added `failedLoginAttempts` table + `FailedLoginAttempt`/
  `NewFailedLoginAttempt` types to `src/lib/db/schema.ts`.
- Added `FEATURES.ADMIN_SECURITY_VIEW = "admin.security_view"` and its
  `FEATURE_DESCRIPTIONS` entry to `src/lib/permissions.ts` (no new
  `FEATURE_CATEGORIES` entry needed — `admin` already exists and
  `getFeaturesByCategory("admin")` matches on the `admin.` prefix).
- Wrote `drizzle/migrations/0054_failed_login_attempts.sql` (idempotent
  `CREATE TABLE IF NOT EXISTS` + two guarded `DO $$ … END $$` index blocks,
  same idiom as neighboring migrations) and
  `drizzle/migrations/0055_admin_security_permission.sql` (idempotent
  `WHERE NOT EXISTS` feature insert + `role_features` binding, following
  `0050_impact_view_permission.sql`'s exact pattern, Admin-only per the
  locked user decision).
- Ran `pnpm db:migrate` twice against the local Neon DB (see Outputs for
  results) and verified the live table/permission with `psql`.
- Ran `pnpm exec tsc --noEmit` — clean, no output.

### Outputs

- `src/lib/db/schema.ts` — added `varchar` to the drizzle-orm/pg-core import
  list, and appended the `failedLoginAttempts` table (`id` uuid PK,
  `attemptedEmail` varchar(255) not null, `provider` text not null, `reason`
  text not null, `userId` nullable FK → `users.id` ON DELETE SET NULL,
  `createdAt` timestamptz not null default now()) plus
  `index("ix_failed_login_attempts_created_at")` and
  `index("ix_failed_login_attempts_email")`, plus the inferred
  `FailedLoginAttempt`/`NewFailedLoginAttempt` types.
- `src/lib/permissions.ts` — added `FEATURES.ADMIN_SECURITY_VIEW =
  "admin.security_view"` and its `FEATURE_DESCRIPTIONS` entry ("View failed
  sign-in attempts and account security events"). No `FEATURE_CATEGORIES`
  change needed.
- `drizzle/migrations/0054_failed_login_attempts.sql` — new file.
  Idempotent: `CREATE TABLE IF NOT EXISTS failed_login_attempts (...)`, two
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = …)
  THEN CREATE INDEX … END IF; END $$;` blocks for the two indexes. No
  statement references any later-numbered migration.
- `drizzle/migrations/0055_admin_security_permission.sql` — new file.
  Idempotent: `INSERT INTO features (name, category, description) SELECT
  'admin.security_view', 'admin', '…' WHERE NOT EXISTS (...)`, then `INSERT
  INTO role_features (role_id, feature_id) SELECT r.id, f.id FROM roles r
  CROSS JOIN features f WHERE r.name = 'admin' AND f.name =
  'admin.security_view' AND NOT EXISTS (...)`. Bound to `admin` only — not
  `treasurer`/`board_member` — per the locked Phase 1 user decision.
- Tables affected: new table `failed_login_attempts`; role binding rows
  added to `role_features` for the `admin` role only.
- Local apply command used: `export $(grep -E "^DATABASE_URL=" .env.local |
  xargs) && pnpm db:migrate`. Did **not** run `pnpm db:push` — unrelated,
  unstaged schema-adjacent drift did not exist in `schema.ts` itself
  (verified via `git status` first, per instructions), so a push wasn't
  needed to apply this increment; `db:migrate` alone materialized the new
  table since it's raw idempotent SQL, and `db:push` is deferred to
  api-developer/ux-developer's judgment if they need to sync anything else
  Drizzle-Kit-side later in this feature.

### Migration run results

**Run 1:** `pnpm db:migrate` — completed successfully. Log showed
`→ 0054_failed_login_attempts.sql` and `→ 0055_admin_security_permission.sql`
with no errors, followed by `✅ Migrations completed successfully`.

**Run 2 (idempotency check):** re-ran the identical command. Output included
a Postgres `NOTICE` (`relation "failed_login_attempts" already exists,
skipping`, code `42P07`) for 0054 and clean silent success for 0055 (the
`WHERE NOT EXISTS`/`AND NOT EXISTS` guards produced zero rows on the second
pass, no errors) — ending again in
`✅ Migrations completed successfully`. Confirms both migrations are safe to
re-run on every deploy.

**Table verification (`psql \d failed_login_attempts`):**
```
                         Table "public.failed_login_attempts"
     Column      |           Type           | Collation | Nullable |      Default
-----------------+--------------------------+-----------+----------+-------------------
 id              | uuid                     |           | not null | gen_random_uuid()
 attempted_email | character varying(255)   |           | not null |
 provider        | text                     |           | not null |
 reason          | text                     |           | not null |
 user_id         | uuid                     |           |          |
 created_at      | timestamp with time zone |           | not null | now()
Indexes:
    "failed_login_attempts_pkey" PRIMARY KEY, btree (id)
    "ix_failed_login_attempts_created_at" btree (created_at DESC)
    "ix_failed_login_attempts_email" btree (attempted_email)
Foreign-key constraints:
    "failed_login_attempts_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
```

**Permission/role-binding verification (`psql`):**
```
        name         | category |                       description                        | role
---------------------+----------+----------------------------------------------------------+-------
 admin.security_view | admin    | View failed sign-in attempts and account security events | admin
(1 row)
```

**Typecheck:** `pnpm exec tsc --noEmit` — clean, zero output, exit success.

### Open questions / handoff notes

- **For api-developer next.** New table/columns available:
  `failedLoginAttempts` (`src/lib/db/schema.ts`) with fields `id`,
  `attemptedEmail` (varchar(255), not null — cap enforced at the DB layer as
  defense-in-depth, but the recorder must still call
  `normalizeAttemptedEmail()` per the design doc so a 300-char attacker
  string doesn't hit a DB-level truncation/error path), `provider` (text,
  free-form at the DB layer — constrain to `FAILED_LOGIN_PROVIDERS` in app
  code), `reason` (text, free-form at the DB layer — constrain to
  `FAILED_LOGIN_REASONS` in app code), `userId` (nullable FK → `users.id`,
  `ON DELETE SET NULL` — populate only for the `no_password_set`,
  `deactivated`, `bad_password`, and `oauth_deactivated` branches per the
  design doc; leave `null` for `missing_credentials` and `unknown_email`),
  `createdAt` (timestamptz, defaults `now()`).
- **Indexes available:** `ix_failed_login_attempts_created_at` (DESC, backs
  the reverse-chronological list) and `ix_failed_login_attempts_email`
  (backs both the search-by-email filter and the `GROUP BY attempted_email`
  aggregate) — both already live in the local DB.
- **Permission available:** `FEATURES.ADMIN_SECURITY_VIEW` (string value
  `"admin.security_view"`) is live and bound to the `admin` role only in
  the local DB. `hasFeature(session.user.features, FEATURES.ADMIN_SECURITY_VIEW)`
  is ready to use in both the future `/admin/security/page.tsx` and inside
  `src/lib/auth/index.ts` is **not** needed (recording doesn't gate on this
  permission — only viewing does).
- **Did not touch `src/lib/auth/`** per instructions — that's api-developer's
  increment: `src/lib/auth/failed-login.ts` (recorder, enums, labels,
  `normalizeAttemptedEmail`, `pruneCutoff`) and the six call sites +
  required `unknown_email`/`no_password_set` branch split in
  `src/lib/auth/index.ts`, plus `src/lib/auth/failed-login.test.ts`'s five
  named unit tests, exactly as specified in the Phase 3 design doc.
- **Did not run `pnpm db:push`** — flagging this explicitly for
  api-developer/ux-developer: if either of you add further `schema.ts`
  changes, re-check `git status` on `schema.ts` before pushing, since other
  concurrent work (impact-cause-drilldown, bank-reconciliation) is mutating
  unrelated files but not `schema.ts` as of this writing — confirm that's
  still true before you push, in case it changed between increments.
- **Did not touch** `docs/decisions.md` (DECISION-033 already written by
  tech-lead), the two concurrent work-logs, `src/lib/ledger*.ts`, or
  `src/components/members/`, per the isolation instructions.

## Increment B — api-developer (recording layer) — 2026-07-21

**Owner:** api-developer
**Status:** complete

### Summary

Built the recording layer exactly per the Phase 3 design doc: `src/lib/auth/failed-login.ts`
(shared `provider`/`reason` enums + labels, `normalizeAttemptedEmail()`,
`pruneCutoff()`, and the fire-and-forget `recordFailedLogin()` that inserts
then opportunistically prunes rows older than 90 days in the same swallowed-catch
block), the five named Vitest unit tests, and the six call sites in
`src/lib/auth/index.ts` — including the required `unknown_email`/
`no_password_set` branch split. Verified against `@auth/core`'s actual source
(not just the design doc's assertion) that a Credentials `authorize()` return
of `null` throws `CredentialsSignin` before the `signIn` callback is ever
invoked, so branches 1–4 and the OAuth branch 5 are provably mutually
exclusive per request — no de-duplication logic needed. All gates pass:
typecheck clean, full Vitest suite green (368 = 363 pre-existing + 5 new),
production build green. Manually exercised the recorder end-to-end against
the local DB (via a scratchpad script, not `scripts/`) and confirmed both the
insert and the 90-day prune fire correctly, then cleaned up every row the
check touched.

### What I did

- Read the full work-log (Phases 1–3, and database-admin's Increment A
  handoff) to pull exact column names, enum values, and the recorder's exact
  contract from the binding design doc rather than re-deriving anything.
- Confirmed `failedLoginAttempts` (with `attemptedEmail`, `provider`,
  `reason`, `userId`, `createdAt`) was live in `src/lib/db/schema.ts` per
  database-admin's Increment A.
- Wrote `src/lib/auth/failed-login.ts`: `FAILED_LOGIN_PROVIDERS`,
  `FAILED_LOGIN_REASONS` (all 6 values), `FAILED_LOGIN_REASON_LABELS`,
  `normalizeAttemptedEmail()` (trim, 255-char cap, `"(none provided)"`
  placeholder for null/empty/whitespace, unescaped-but-capped pass-through
  for everything else), `pruneCutoff(now)` (pure `now - 90 days` Date math),
  and `recordFailedLogin()` (fire-and-forget async IIFE: insert, then
  unconditional `DELETE ... WHERE created_at < pruneCutoff()`, both inside one
  swallowed `try/catch`).
- Edited `src/lib/auth/index.ts`: added the `recordFailedLogin` import, split
  the old combined `if (!user || !user.password)` into two branches
  (`unknown_email` when no user row exists, `no_password_set` when the user
  exists but has no password — this is the one branch where `userId` is
  populated even though sign-in fails), and added independent
  `recordFailedLogin()` calls at all five `authorize()` branches
  (`missing_credentials`, `unknown_email`, `no_password_set`, `deactivated`,
  `bad_password`) plus the separate `signIn`-callback `oauth_deactivated`
  branch. Every call is a bare statement before the existing `return
  null`/`return false` — zero change to what `authorize()`/`signIn` return or
  to any `/signin` visitor-facing copy.
- Verified the "no double-recording" claim against actual `next-auth` v5
  behavior rather than trusting the design doc's assertion at face value:
  read `node_modules/.pnpm/@auth+core@0.41.1/.../lib/actions/callback/index.js`
  and confirmed at the credentials branch (`if (!user) throw new
  CredentialsSignin();`) that a falsy `authorize()` result throws immediately,
  *before* `handleAuthorized()` (which invokes the configured `signIn`
  callback) is ever reached. This is a hard verification, not an assumption
  — branches 1–4 and branch 5 are provably mutually exclusive per request.
- Wrote `src/lib/auth/failed-login.test.ts` with the five named tests from
  the design doc, mocking `@/lib/db` (via `vi.mock("@/lib/db", ...)`, the
  same pattern already used in `src/lib/permissions-server.test.ts`) so the
  module-level `db` import in `failed-login.ts` doesn't attempt a real
  connection during unit tests — all five tests are pure and exercise
  `pruneCutoff`/`normalizeAttemptedEmail`/the enum-label pairing only.
- Ran `pnpm exec tsc --noEmit` — clean.
- Ran `pnpm test` — found and fixed one pre-existing regression (see
  Deviations below) unrelated to my new code, then reran to a clean 368/368.
- Ran `pnpm build:only` — clean production build.
- Wrote a one-off scratchpad script (`sanity-check-recorder.ts`, run from a
  temporary copy at the project root so `tsx` could resolve `node_modules`,
  then deleted — never placed under `scripts/`) that: inserted a
  synthetic row dated 100 days in the past directly via Drizzle, called
  `recordFailedLogin()` with a fresh marker email, waited for the
  fire-and-forget IIFE to settle, and asserted the fresh row landed while the
  100-day-old row was pruned. Confirmed via `psql` afterward that zero rows
  matching either scratch marker email remain in `failed_login_attempts`.

### Outputs

**New files:**
- `src/lib/auth/failed-login.ts` — exports `FAILED_LOGIN_PROVIDERS`,
  `FailedLoginProvider`, `FAILED_LOGIN_REASONS`, `FailedLoginReason`,
  `FAILED_LOGIN_REASON_LABELS`, `normalizeAttemptedEmail(raw): string`,
  `pruneCutoff(now?: Date): Date`, and
  `recordFailedLogin(params: { attemptedEmail, provider, reason, userId? }): void`.
  No route handler or server action — per the Phase 3 design doc, this
  feature has no API surface beyond the recorder itself (the future admin
  page reads the table directly via Drizzle).
- `src/lib/auth/failed-login.test.ts` — 8 tests (the 5 named cases from the
  design doc; `normalizeAttemptedEmail`'s null/undefined/empty/whitespace
  case is asserted as 4 sub-assertions in one `it`, matching the design doc's
  single named test #3). Mocks `@/lib/db`.

**Modified files:**
- `src/lib/auth/index.ts` — added the `recordFailedLogin` import; split
  `if (!user || !user.password)` into `if (!user) { ...unknown_email... }`
  then `if (!user.password) { ...no_password_set... }`; added
  `recordFailedLogin()` calls at all 6 branches (5 in `authorize()`, 1 in the
  `signIn` callback). No change to any return value or to `/signin`'s
  visitor-facing behavior — confirmed by inspection, every new call is a
  bare statement inserted before an unchanged `return`.
- `src/lib/permissions.test.ts` — **deviation, see below**: added
  `FEATURES.ADMIN_SECURITY_VIEW` to the `adminFeatures` array in the
  `getFeaturesByCategory` "admin" category test (line ~82). This test was a
  pre-existing regression from Increment A (database-admin's addition of the
  new `admin.security_view` feature grew the `admin` category from 3 to 4
  members, but the count-based assertion wasn't updated) — not something I
  introduced, but required a one-line fix to get `pnpm test` green.

### Gate results

- `pnpm exec tsc --noEmit` — clean, zero output.
- `pnpm test` — **368 passed** (363 pre-existing + 5 new in
  `failed-login.test.ts`), 0 failed, after the `permissions.test.ts` fix
  above.
- `pnpm build:only` — production build succeeded; all existing routes
  compiled, no new route added (no API surface in this increment).
- No `console.log` in any production path (`failed-login.ts`, the edits to
  `auth/index.ts`) — the swallowed `catch` blocks are silent by design, per
  the "must never throw or log in a way that could leak into request
  handling" requirement.

### Proof-of-recording summary

Ran a scratchpad tsx script directly against the local DB
(`DATABASE_URL` from `.env.local`):
1. Inserted a synthetic row dated 100 days in the past
   (`scratch-sanity-check+old@example.test`) directly via Drizzle, bypassing
   the recorder.
2. Called `recordFailedLogin({ attemptedEmail: "scratch-sanity-check+fresh@example.test", provider: "credentials", reason: "unknown_email" })`.
3. After a 1.5s settle delay (the call is fire-and-forget, not awaited),
   confirmed via `db.select()`:
   - The fresh row landed (1 row, correct `provider`/`reason`, `userId: null`).
   - The 100-day-old row was pruned (0 rows remaining) — proving the
     unconditional prune-on-insert fires in the same call.
4. Deleted both marker rows explicitly as belt-and-suspenders cleanup (the
   prune already removed the old one).
5. **Cleanup confirmed:** `psql` count of
   `failed_login_attempts WHERE attempted_email ILIKE 'scratch-sanity-check%'`
   returned `0` after the script ran. The temporary script file (copied to
   the project root so `tsx` could resolve `node_modules`, since the
   scratchpad directory is outside the project tree) was deleted immediately
   after the run; `git status` shows no untracked script file remaining.

### Deviations from the design doc

- **`src/lib/permissions.test.ts` was touched**, outside my originally
  scoped footprint (`failed-login.ts`, `failed-login.test.ts`,
  `auth/index.ts`, the work-log). This was required to fix a pre-existing
  test regression introduced by Increment A (see above) — without it,
  `pnpm test` fails and the Phase 4 gate can't be met. This is a one-line,
  additive fix (added one array member to match reality) with no behavioral
  change to `permissions.ts` itself.
- No other deviations. All six call sites, the required branch split, the
  recorder's exact contract (fire-and-forget, swallowed catch, unconditional
  prune-on-insert), and all five named unit tests match the Phase 3 design
  doc exactly.

### Open questions / handoff notes

- **Next: ux-developer.** Delivers `src/app/(dashboard)/admin/security/page.tsx`
  (gated on `hasFeature(session.user.features, FEATURES.ADMIN_SECURITY_VIEW)`,
  server-rendered, list + search-by-email + pagination + grouped
  count-by-email view + empty/failure states, `overflow-x-auto` mobile
  pattern) and the new "Security" nav item in
  `src/components/admin/admin-sidebar.tsx` (`requiredFeature:
  FEATURES.ADMIN_SECURITY_VIEW`, placed in the `System` group after "Sync
  Log", per Phase 3's Component/Page Plan).
- **Reading the table:** query `failedLoginAttempts` directly via Drizzle
  from the new page — no API route/server action exists or is needed for
  reads (confirmed in Phase 3's API Contract section: search/pagination are
  plain `GET` `searchParams`, read server-side, no client component).
- **Rendering `attemptedEmail`:** render via plain JSX interpolation only
  (React's default auto-escaping) — never `dangerouslySetInnerHTML`. Test
  #4 in `failed-login.test.ts` proves the stored value can contain literal
  `<script>` text; the admin page is the only layer that must neutralize it,
  by rendering, not by re-sanitizing storage.
- **`provider`/`reason` values to render:** use `FAILED_LOGIN_REASON_LABELS`
  from `src/lib/auth/failed-login.ts` for the human-readable reason column —
  do not invent a second label map in the page component.
- **Did not touch** `src/lib/db/schema.ts`, `drizzle/migrations/`,
  `docs/decisions.md`, `src/lib/ledger*.ts`, `src/components/`, `scripts/`,
  or either concurrent work-log, per the isolation instructions. Did not
  start the dev server.
- **`pnpm db:push` note carried forward from Increment A:** neither
  increment has run it; if ux-developer's work needs a schema sync beyond
  what `db:migrate` already applied, re-check `git status` on `schema.ts`
  first per database-admin's note.

## Increment C — ux-developer (admin page + nav) — 2026-07-21

**Owner:** ux-developer
**Status:** complete

### Summary

Built the final UI increment exactly per the Phase 3 design doc: a single
gated Server Component at `src/app/(dashboard)/admin/security/page.tsx` with
no new API route or server action (reads `failedLoginAttempts` directly via
Drizzle, matching `/admin/sync-log` and `/admin/email-queue`'s zero-client-JS
pattern), plus the new "Security" nav item in the `System` group of
`src/components/admin/admin-sidebar.tsx`. Both v1 views are implemented as
searchParam-driven tabs (`?view=list` default, `?view=grouped`): a
reverse-chronological, search-by-email, paginated attempt log, and an
always-complete grouped count-by-email summary capped at 200 rows. Gating
follows `email-queue/page.tsx`'s pattern exactly — `auth()` +
`hasFeature(session.user.id, FEATURES.ADMIN_SECURITY_VIEW)` from
`@/lib/permissions-server`, redirecting to `/admin` on insufficient
permission — not `sync-log`'s ungated pattern. `pnpm exec tsc --noEmit` and
`pnpm test` (368/368) both passed against my own changes; `pnpm build:only`
is currently blocked by an unrelated, concurrent, in-flight change to
`src/lib/ledger-queries.ts`/`src/lib/ledger.ts` (the bank-reconciliation /
ledger-check-number work's `checkNumber` field) — see Gate Results below for
the full isolation proof. No file outside my scoped footprint was touched.

### What I did

- Read the full work-log (Phases 1–3, Increment A, Increment B) to pull the
  exact table/column names, the `FEATURES.ADMIN_SECURITY_VIEW` key, and the
  `FAILED_LOGIN_REASON_LABELS` single-source-of-truth map from the binding
  design doc and Increment B's handoff, rather than re-deriving anything.
- Read `src/app/(dashboard)/admin/email-queue/page.tsx` (the gating pattern
  to copy) and `src/app/(dashboard)/admin/sync-log/page.tsx` (the pagination
  pattern to copy, explicitly not its missing gate) in full.
- Read `src/app/(dashboard)/admin/users/page.tsx` (GET search-form pattern
  with `ilike`) and `src/app/(dashboard)/admin/roles/page.tsx` /
  `src/app/(dashboard)/admin/contact/page.tsx` (this codebase's
  `sql<number>\`count(*)::int\`` aggregate convention, used instead of
  drizzle-orm's `count()` helper to match existing style) in full.
- Read `src/app/(dashboard)/admin/ledger/page.tsx` for the established
  inline-`try/catch` + `LoadErrorCard` query-failure pattern (DECISION-032)
  and copied its shape for this page's own local `LoadErrorCard`.
- Read `src/lib/permissions.ts` (confirmed `FEATURES.ADMIN_SECURITY_VIEW` and
  its description were already live from Increment A) and
  `src/lib/auth/failed-login.ts` (confirmed `FAILED_LOGIN_REASON_LABELS` and
  `FailedLoginReason` were already live from Increment B) — imported both,
  did not reinvent a second label map.
- Read `src/lib/db/schema.ts`'s `failedLoginAttempts` table definition to
  confirm exact field names (`attemptedEmail`, `provider`, `reason`,
  `createdAt`).
- Read `src/components/admin/admin-sidebar.tsx` in full to find the `System`
  group and the exact insertion point (after "Sync Log", before "Release
  Notes").
- Wrote `src/app/(dashboard)/admin/security/page.tsx` (new file — see
  Outputs).
- Edited `src/components/admin/admin-sidebar.tsx` — added one `NavItem`
  entry.
- Ran `pnpm exec tsc --noEmit` — clean at the time both my files were
  complete.
- Ran `pnpm test` — 368/368 passed.
- Ran `pnpm build:only` twice — both times failed at the TypeScript-check
  step on `src/lib/ledger-queries.ts:1167`, a file I never touched. Confirmed
  via `git diff --stat` and `git diff -- src/lib/db/schema.ts` that the only
  uncommitted changes to `ledger-queries.ts`/`ledger.ts`/`schema.ts` are the
  concurrent bank-reconciliation/ledger-check-number work's `checkNumber`
  column and its threading through `PendingApprovalRow` — not anything from
  this feature. Re-ran `pnpm exec tsc --noEmit` afterward and got the
  identical error, confirming it's a real (not transient) state of that
  concurrent work, not a race. Did not touch `ledger-queries.ts`, `ledger.ts`,
  or `schema.ts` to work around it, per the explicit isolation instructions.
- Did not start the dev server, per instructions (qa smoke-tests in Phase 5).

### Outputs

**New file:**
- `src/app/(dashboard)/admin/security/page.tsx` — gated Server Component,
  `searchParams: Promise<{ email?: string; page?: string; view?: string }>`.
  - Gate: `auth()` → redirect `/signin` if unauthenticated;
    `hasFeature(session.user.id, FEATURES.ADMIN_SECURITY_VIEW)` from
    `@/lib/permissions-server` → redirect `/admin` if not permitted (exact
    `email-queue/page.tsx` pattern, not `sync-log`'s ungated one).
  - **List view** (`view=list`, default): reverse-chronological table
    (Timestamp, Attempted Email, Provider, Reason), `PAGE_SIZE = 25`,
    `?email=` search box (GET form, `ilike` partial match on
    `attemptedEmail`), Previous/Next pagination with a
    "Showing X–Y of Z" caption (`sync-log`'s exact pagination shape).
  - **Grouped view** (`view=grouped`): `GROUP BY attemptedEmail`,
    `count(*)::int` as `attempts`, `max(createdAt)` as `lastAttemptAt`,
    ordered by count desc then last-attempt desc, `LIMIT 200`
    (`GROUPED_LIMIT`) — intentionally **not** scoped by the list's `email`
    search filter, per the locked "both views are independent v1
    requirements" decision. Caption reads "Showing the top 200…" or
    "Showing all N…" depending on whether the cap was hit.
  - Views are toggled via two pill links (`?view=list` / `?view=grouped`),
    styled identically to `sync-log`'s group-filter pills
    (`rounded-full`/`bg-lions-blue` active state).
  - All three queries (list rows, filtered count, grouped summary) run in one
    `Promise.all`, wrapped in `try/catch` — on failure, renders a local
    `LoadErrorCard` (copied from `admin/ledger/page.tsx`'s DECISION-032
    pattern: `bg-gray-50 rounded-2xl p-10 text-center text-gray-500`, an
    icon, a human sentence, and a "Try again" link back to `/admin/security`)
    instead of a stack trace.
  - Empty states, both using the exact required copy "No failed login
    attempts recorded." for the true-empty case
    (`bg-gray-50 rounded-2xl p-10 text-center text-gray-500`): the list view
    additionally shows "No failed login attempts found for
    "{email}"." when a search filter yields zero rows but the table isn't
    globally empty; the grouped view (never filtered) only has the one
    global-empty message.
  - `attemptedEmail` renders via plain JSX interpolation only — no
    `dangerouslySetInnerHTML` anywhere in the file, so React's default
    auto-escaping neutralizes any stored `<script>`-like text (per Increment
    B test #4 and the analyst's stored-XSS-via-audit-log requirement).
  - `reason` renders via `FAILED_LOGIN_REASON_LABELS[r.reason as
    FailedLoginReason] ?? r.reason` — imported from `@/lib/auth/failed-login`,
    not a second label map, falling back to the raw string only if a reason
    value ever drifts from the six known enum members.
  - `provider` renders via a small local `PROVIDER_LABELS` map
    (`credentials` → "Password", `google` → "Google") — this is a display
    label for the *provider* column, not a second copy of the *reason* label
    map the design doc warned against duplicating.
  - Mobile: both tables use the `overflow-hidden rounded-lg border ...` +
    `overflow-x-auto` wrapper, matching `email-queue`/`sync-log` exactly — no
    new responsive pattern invented.
  - Focus rings (`focus:outline-none focus:ring-2 focus:ring-lions-blue`) on
    every link and button; the search input has an associated (visually
    hidden) `<label>`.

**Modified file:**
- `src/components/admin/admin-sidebar.tsx` — added one `NavItem` to the
  `System` group, between "Sync Log" and "Release Notes":
  `{ name: "Security", href: "/admin/security", icon: "🛡️", requiredFeature:
  FEATURES.ADMIN_SECURITY_VIEW }`. This is the corrected gating precedent
  the Phase 2/3 docs called for — unlike "Sync Log" and "Release Notes"
  (which carry no `requiredFeature`), the new item is explicitly gated in
  the nav *and* the page independently re-checks `hasFeature()` server-side.

**Modified:** `docs/work-log/2026-07-21-failed-login-visibility.md` — this
section, and the Per-Phase Status Phase 4 row updated to `Complete`.

**Not touched:** `src/lib/db/schema.ts`, `drizzle/migrations/`,
`src/lib/auth/` (read-only per instructions — only imported from
`failed-login.ts`, never edited), `src/lib/ledger*.ts`,
`docs/decisions.md`, `docs/backlog.md`, `scripts/`, and the three concurrent
work-logs (`impact-cause-drilldown`, `bank-reconciliation`,
`ledger-check-number`). Did not start the dev server.

### Gate results

- `pnpm exec tsc --noEmit` — **clean** at the point both of my files were
  complete (zero output). A subsequent run (after concurrent work landed
  further changes to `ledger-queries.ts`) surfaced a pre-existing-to-that-file
  error at `src/lib/ledger-queries.ts:1167` (`PendingApprovalRow` missing
  `checkNumber`) — entirely inside the concurrent bank-reconciliation/
  ledger-check-number feature's files, confirmed via `git diff --stat` (only
  `schema.ts`/`ledger.ts`/`ledger-queries.ts` carry the `checkNumber` diff,
  and my own two files are not implicated in the error).
- `pnpm test` — **368 passed**, 0 failed (matches the expected count; no new
  tests added in this increment — the design doc's Named Unit Tests section
  scoped all five tests to Increment B's `failed-login.test.ts`, already
  delivered).
- `pnpm build:only` — **currently blocked**, not by anything in my scope. Ran
  twice; both times the Next.js webpack compile step itself succeeded
  ("✓ Compiled successfully"), meaning `/admin/security` and the sidebar
  change compiled without module errors, but the subsequent TypeScript-check
  step failed on the unrelated `ledger-queries.ts` file before the build
  could print the final route manifest. I did not attempt to fix or work
  around this — `src/lib/ledger-queries.ts`/`ledger.ts`/`schema.ts` are
  explicitly off-limits to me per the isolation instructions, and the
  failure is unambiguously inside the concurrent ledger-check-number work
  (its `checkNumber` column addition isn't yet threaded through
  `PendingApprovalRow` everywhere it's constructed).
- No `console.log` in `src/app/(dashboard)/admin/security/page.tsx` or the
  sidebar edit.

### Deviations from the design doc

None in shape or contract. Two small implementation choices the design doc
left open, both consistent with existing precedent:
- **`PROVIDER_LABELS`** (a two-entry local map for the Provider column) isn't
  named in the design doc, which only mandated reusing
  `FAILED_LOGIN_REASON_LABELS` for the *reason* column. Adding a minimal,
  page-local provider-label map is not "a second reason label map" — it's a
  different column with no existing single source of truth to reuse.
- **Tab mechanism**: the design doc left the toggle shape open ("if the
  design doc leaves the toggle shape open, use searchParam-driven
  tabs/pills"). Implemented as two `?view=list`/`?view=grouped` pill links
  styled identically to `sync-log`'s existing group-filter pills, per that
  instruction.

### Open questions / handoff notes

- **Blocking item for qa (Phase 5), not from this increment:** `pnpm
  build:only` will not go green until the concurrent bank-reconciliation /
  ledger-check-number work finishes threading `checkNumber` through
  `PendingApprovalRow` in `src/lib/ledger-queries.ts`. This has nothing to do
  with Failed Login Visibility — qa should re-run `pnpm build:only` once
  that other feature's implementer reports its own Phase 4 complete, rather
  than looping this feature back to Phase 4.
- **What to click through in the browser** (once the build issue above
  clears and a local dev server is available): sign in as an Admin, open
  `/admin/security` from the "Security" nav item under **System** in the
  sidebar; confirm the "Attempt Log" tab shows a reverse-chronological table
  (or the empty state, if the local DB has no rows yet — trigger one by
  failing a sign-in at `/signin` with a wrong password, then reload); type a
  partial email into the search box and confirm filtering + the "Clear"
  link; page through if there are >25 rows; switch to the "By Email" tab and
  confirm counts/last-attempt times; confirm a non-Admin (or logged-out)
  visit to `/admin/security` redirects away and the sidebar doesn't show
  "Security" for a non-Admin session.
- **New copy strings the Lions Club may want to refine:** page title
  "Security" / subtitle "Failed sign-in attempts against member and admin
  accounts"; tab labels "Attempt Log" / "By Email"; empty-state copy ("No
  failed login attempts recorded." / "No failed login attempts found for
  "{email}"."); the `LoadErrorCard` copy ("Couldn't load security data").
  None of these are locked by the design doc's exact wording except the one
  hard-required empty-state sentence.
- **UX tradeoff:** the grouped view's per-row failure count renders as plain
  bold text, not a colored pill/badge — deliberately avoided inventing an
  arbitrary severity threshold (e.g., "5+ failures = red") that wasn't in
  the design doc; a follow-up could add one if the club wants a visual
  brute-force signal.
- **Next: qa (Phase 5).** Typecheck and unit tests are green on my own
  files; production build is blocked by the unrelated concurrent work noted
  above — re-run `pnpm build:only` once that clears, then proceed with the
  manual click-through above.

---

# Phase 5 — Verification (qa) — 2026-07-21

**Owner:** qa
**Status:** complete
**Verdict:** PASS

### Summary

Failed Login Visibility passes every automated gate and every live flow I
drove by hand. The build blocker Increment C flagged (an unrelated
concurrent `checkNumber`/`ledger-queries.ts` change) has since cleared —
`pnpm build:only` is green with `/admin/security` in the route manifest.
Typecheck is clean, the full unit suite is 378/378 (the 5 named
`failed-login.test.ts` tests match the Phase 3 design doc's list exactly),
both idempotent migrations (0054, 0055) re-ran clean, and I recorded real
`bad_password` and `unknown_email` rows against the live NextAuth credentials
callback with zero enumeration difference in the visitor-facing response. I
also drove the admin page live — gate, both views, search, empty state, and
a stored-`<script>`-tag row rendered as inert text — and wrote 5 Playwright
regression tests to `e2e/admin-security.spec.ts` covering the same ground so
this doesn't need a human at the keyboard next time. Every synthetic DB row
was deleted afterward; the table is back to its pre-test count of 0.

### What I did

1. **Typecheck** — `pnpm exec tsc --noEmit`: clean, zero output.
2. **Unit tests** — `pnpm test`: 378/378 passed. Confirmed
   `src/lib/auth/failed-login.test.ts` directly
   (`pnpm exec vitest run --reporter=verbose src/lib/auth/failed-login.test.ts`):
   5/5 named tests present and passing, matching the Phase 3 design doc's
   Named Unit Tests section one-for-one (`pruneCutoff` exact-90-days,
   `normalizeAttemptedEmail` 255-char truncation, the four-way
   null/undefined/empty/whitespace placeholder case, the HTML-passthrough
   case, and the `FAILED_LOGIN_REASONS`/`FAILED_LOGIN_REASON_LABELS`
   enum-completeness pairing).
3. **Production build** — `pnpm build:only`: **green.** The blocker
   Increment C hit (`src/lib/ledger-queries.ts:1167`, from the concurrent
   bank-reconciliation/ledger-check-number work) has since resolved —
   "Compiled successfully," TypeScript check passed, 94 static pages
   generated, and `/admin/security` appears in the route manifest as a
   dynamic (`ƒ`) server-rendered route, exactly as the design doc specifies
   (no client component, no new API route).
4. **Migration idempotency** — ran `pnpm db:migrate` against the local DB
   (`.env.local`'s `DATABASE_URL`). `0054_failed_login_attempts.sql` produced
   the expected clean NOTICE (`relation "failed_login_attempts" already
   exists, skipping`); `0055_admin_security_permission.sql` produced no
   output at all (its `WHERE NOT EXISTS`/`AND NOT EXISTS` guards matched zero
   rows to insert, as expected on a second run); `0056_ledger_check_number.sql`
   (unrelated concurrent migration) also re-ran clean. Ended with
   `✅ Migrations completed successfully`.
5. **Dev-server live verification** (`pnpm dev`, port 3000):
   - **Recording end-to-end.** Confirmed table was empty (0 rows) before
     starting. Drove two real attempts straight at the NextAuth credentials
     callback via `curl` (CSRF token fetched from `/api/auth/csrf`, then
     `POST /api/auth/callback/credentials`): (a) the real E2E admin email
     with a wrong password, (b) a wholly unknown email. Both responses were
     **byte-identical in shape** — `302 → /signin?error=CredentialsSignin&code=credentials`
     — confirming zero enumeration leak between the two cases. `psql`
     confirmed both rows landed correctly: `lions-e2e-test@westervillelions.org`
     / `credentials` / `bad_password` / `user_id` populated, and
     `totally-unknown-qa-probe@example.test` / `credentials` / `unknown_email`
     / `user_id` null — matching the recorder's exact contract.
   - **Gate check.** Unauthenticated `curl` against `/admin/security` returned
     `307 → /signin?callbackUrl=%2Fadmin%2Fsecurity`, confirmed live. The
     authenticated-admin path was driven live via Playwright's
     `signInAsAdmin()` (see below) — both views render. **No non-admin test
     account exists in this project's `.env.local`** (only
     `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD`), so the "user with
     `admin.dashboard` but not `admin.security_view`" redirect was **verified
     by reading the code, not by a live test**: `page.tsx` line 94 redirects
     to `/signin` when `!session?.user?.id`, and line 96-97 calls
     `hasFeature(session.user.id, FEATURES.ADMIN_SECURITY_VIEW)` (the
     DB-backed `permissions-server.ts` version, correct signature — matches
     `email-queue/page.tsx`'s identical call shape exactly) and redirects to
     `/admin` if false. This is a **code-read verification, explicitly not a
     live test**, per the task's own instruction for this exact gap.
   - **Views.** List view showed both test rows with correct human-readable
     reason labels (`FAILED_LOGIN_REASON_LABELS`); `?email=` search correctly
     scoped to a single row; grouped view correctly counted attempts per
     email with a `last_attempt_at`; searching a nonsense email
     (`this-address-has-never-attempted-a-login-zzz`) correctly rendered the
     "No failed login attempts found for…" empty-state sentence, distinct
     from the "No failed login attempts recorded." true-empty sentence.
   - **XSS spot-check.** Inserted
     `<script>alert(1)</script>@x.com` directly via `psql`. The page
     rendered it as literal visible text in the table (confirmed via
     Playwright's `toContainText` against the raw string, plus a
     `page.on("dialog")` listener that never fired) — no
     `dangerouslySetInnerHTML` anywhere in `page.tsx` (confirmed by reading
     the file), matching Increment B's test #4 and the analyst's
     stored-XSS-via-audit-log hard requirement.
   - **Cleanup.** Deleted all synthetic rows (`lions-e2e-test@...`,
     `totally-unknown-qa-probe@...`, the `<script>` row) via `psql`.
     `SELECT count(*) FROM failed_login_attempts` returned to `0`, matching
     the pre-test baseline exactly. Dev server killed
     (`lsof -ti :3000 | xargs kill`); confirmed port free afterward.
6. **Wrote regression coverage** — `e2e/admin-security.spec.ts` (new file, 5
   tests) so the manual click-through above doesn't have to be repeated by
   hand every time: the unauthenticated redirect, the authenticated
   list+grouped views, search-filtering, the empty-state sentence, and the
   stored-XSS-rendered-as-text regression. Each test triggers a **real**
   failed sign-in through the actual credentials callback with a unique,
   timestamped marker email (not direct DB seeding) so tests are independent
   of each other and of my manual verification pass — matching this suite's
   existing black-box-against-the-running-app discipline (no e2e spec in
   this project imports `@/lib/db` directly; confirmed by grep). There is no
   delete/manage action for this table in v1, so marker rows created by
   future runs of this spec are left for the recorder's own 90-day
   opportunistic prune — intentional, not a cleanup gap (documented in the
   spec's file-level comment).
7. **Full e2e suite** — ran `pnpm exec dotenv -e .env.local -- playwright
   test` repeatedly while developing the new spec. **Found and fixed a
   self-inflicted flake**: adding my 5-test file increased total parallel
   worker pressure enough to reliably tip a **pre-existing** cross-file race
   between `cancel-occurrence.spec.ts` and `recurring-signup-rollup.spec.ts`
   — both hardcode the same shared fixture event id
   (`291c76f3-ab75-4c64-8173-ac285345cfe9`) and mutate its RSVPs/occurrences
   concurrently under `fullyParallel: true`. Isolated this precisely: ran the
   full suite twice with my new file removed (21/21 passed both times, 1
   pre-existing skip), then twice with it present (same single test failed
   both times — `recurring-signup-rollup.spec.ts`'s Test 2, an off-by-one
   attendee count, 18-19s runtime vs. ~9s in isolation, consistent with
   contention, not a logic bug). Fix: added
   `test.describe.configure({ mode: "serial" })` to my own new file only —
   did **not** touch `cancel-occurrence.spec.ts` or
   `recurring-signup-rollup.spec.ts` (out of scope, belongs to a different
   feature's isolation boundary). Re-ran the full suite twice more after the
   fix: 26/26 passed both times (1 pre-existing skip). Final full-suite run
   for the record: 26 passed, 1 skipped, 31.5s.

### Coverage on Critical Modules

- `src/lib/auth/failed-login.ts` (this feature's new module): **75%
  statements / 71.42% branch / 50% functions** — uncovered lines 103-111 are
  entirely inside `recordFailedLogin()`'s `db.insert`/`db.delete` calls,
  which the design doc explicitly scoped to live/e2e verification rather
  than a Vitest DB mock (the 5 named tests cover every *pure* helper:
  `pruneCutoff`, `normalizeAttemptedEmail`, the enum/label pairing). The
  DB-touching path was verified live in step 5 above (real insert + real
  90-day-window prune, confirmed via `psql`) — this is coverage-by-e2e, not
  a gap.
- `src/lib/permissions.ts`: **100% statements / 100% functions** (target:
  100%) — `FEATURES.ADMIN_SECURITY_VIEW` and its `FEATURE_DESCRIPTIONS` entry
  are exercised by `permissions.test.ts`'s category-completeness assertion.
- `src/lib/events.ts`: **94.73% statements** (target: 90%+) — pre-existing,
  untouched by this feature; reported for completeness since it's this
  project's other qa-owned coverage target.
- `src/lib/members.ts`: **0% statements** — pre-existing gap, **not**
  touched by this feature (Failed Login Visibility never reads or writes
  `src/lib/members.ts`). Flagging for the next 7-day test-coverage review
  rather than fixing here — out of this feature's scope.

### Feature-Gate Audit (mandatory before PASS)

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `GET /admin/security` (Server Component page, `src/app/(dashboard)/admin/security/page.tsx`) | yes — `auth()` at line 93, redirects to `/signin` if no `session.user.id` | yes — `hasFeature(session.user.id, FEATURES.ADMIN_SECURITY_VIEW)` from `@/lib/permissions-server` at line 96, redirects to `/admin` if false | yes — `FEATURES.ADMIN_SECURITY_VIEW` (`"admin.security_view"`), bound Admin-only in `0055_admin_security_permission.sql`, confirmed live via `psql` (1 row: `admin.security_view | admin | ... | admin`) |
| Admin nav item ("Security", `src/components/admin/admin-sidebar.tsx` line 191-196) | n/a (nav visibility only) | yes — `requiredFeature: FEATURES.ADMIN_SECURITY_VIEW` | yes |
| Recording call sites (`src/lib/auth/index.ts`, 6 call sites in `authorize()`/`signIn`) | n/a — recording is unauthenticated by construction (these fire *because* sign-in failed); no gate applies here, this is the write path the admin page reads from, not a protected read/write endpoint itself | n/a | n/a |

**No new API route or server action exists for this feature** — confirmed by
reading `page.tsx` in full: all three queries (list rows, filtered count,
grouped summary) run inline via Drizzle inside the Server Component itself,
matching the Phase 3 design doc's "no new route handler or server action"
API Contract exactly. There is therefore only the one surface to gate, and
it is gated correctly, server-side, independent of the nav item hiding the
link (verified both are present, not inferred from a passing test).

### Deviations from the design doc noted, not blocking

- **Redirect target on insufficient permission is `/admin`, not
  `/access-pending`** as the Phase 3 design doc's prose suggested
  ("`redirect("/access-pending")` (or `/signin` if unauthenticated)").
  Increment C instead followed the actual precedent
  (`email-queue/page.tsx`'s `redirect("/admin")`), which is the pattern the
  design doc itself said to copy ("matching `email-queue/page.tsx`'s
  pattern"). Not a defect — sending an admin-dashboard user who merely lacks
  this one sub-permission back to `/admin` (rather than to
  `/access-pending`, which is really for users with *no* usable role at all)
  is arguably more correct than the design doc's suggested target. Not
  flagged as a bug; noting it so Phase 6 doesn't read this as a silent
  contradiction.

### Outputs

- `docs/work-log/2026-07-21-failed-login-visibility.md` — this Phase 5
  section; Per-Phase Status table Phase 5 row updated to
  `Complete | PASS | 2026-07-21`.
- `e2e/admin-security.spec.ts` — **new file**, 5 Playwright tests (gate
  redirect, list+grouped views, search filter, empty state, stored-XSS
  regression), run serially within their own `describe` block to avoid
  contributing to the pre-existing cross-file fixture race described above.
- No source files touched — every defect-free result above was confirmed by
  reading the actual implementation, not assumed from a passing test.
- DB left clean: `failed_login_attempts` count is `0`, matching the
  pre-verification baseline. Dev server stopped.

### Open questions / handoff notes

- **Nominating analyst for Phase 6.** All gates pass, the feature-gate audit
  is clean, and every Phase 1/2/3 hard requirement (no enumeration change,
  fire-and-forget recording, 90-day opportunistic prune, stored-XSS
  neutralized at render, Admin-only binding, the required
  `unknown_email`/`no_password_set` branch split) was independently verified
  live or by reading the code — not inferred from tests alone.
- **Pre-existing test-suite finding, not part of this feature:**
  `cancel-occurrence.spec.ts` and `recurring-signup-rollup.spec.ts` share a
  single hardcoded fixture event id
  (`291c76f3-ab75-4c64-8173-ac285345cfe9`) and are timing-sensitive under
  high parallel worker load — adding any new spec file to this suite risks
  tipping that race. I mitigated locally by serializing my own new spec, but
  the underlying two-file fixture-sharing issue is untouched and should be
  flagged for the next 7-day test-coverage review or 30-day code review, not
  silently left for the next person to rediscover as a mystery flake.
- **`src/lib/members.ts` has 0% test coverage** — pre-existing, unrelated to
  this feature, flagging for the same 7-day coverage review per the
  documented 80%+ target.
- **Manual-vs-automated split, stated explicitly per instructions:** the
  admin-gate *redirect-on-insufficient-permission* path was verified by
  reading `page.tsx`'s code, not by a live non-admin session (no such test
  account exists in `.env.local`). Everything else in this verification —
  recording, enumeration-safety, both views, search, empty state, the XSS
  render, and the unauthenticated redirect — was driven live.

---

# Phase 6 — Shipped vs Intent (analyst) — 2026-07-21

**Owner:** analyst
**Status:** complete
**Verdict:** SHIP IT

### Summary

The shipped feature delivers exactly what Phase 1 specified and every locked
user decision was honored without drift. I re-read my own Phase 1 review, the
architect's and tech-lead's rulings, all three implementation increments, and
QA's Phase 5 report, then independently re-verified the two claims QA
explicitly could not verify live (the six failure branches, and the mobile
convention) by reading the actual source. Everything checks out: the six
branches are exactly the six the design doc specified, no alerting or
rate-limiting crept in, the `/signin` visitor-facing response is unchanged,
and the admin surface follows every brand convention. The one honest gap
(permission-gate redirect verified by code-read, not a live non-admin
session) is real but narrow, already flagged by QA, and I've logged a
backlog item generalizing it beyond just this feature. This ships.

### What I did

- Re-read the full work-log (Phases 1–5) in order, holding my own Phase 1
  gaps/adversarial-pass list against QA's Phase 5 findings line by line.
- Read `src/lib/auth/index.ts` in full to independently confirm the six
  `recordFailedLogin()` call sites (not trusting the design doc's or QA's
  prose alone): five inside `Credentials.authorize()` (`missing_credentials`
  line 35, `unknown_email` line 48, `no_password_set` line 57, `deactivated`
  line 68, `bad_password` line 83) plus the `signIn` callback's
  `oauth_deactivated` branch (line 115). The required `unknown_email`/
  `no_password_set` branch split is real — `if (!user)` and `if
  (!user.password)` are two independent `if` blocks, not one collapsed
  check. Confirmed the pre-existing `sendEmail` import at line 9 is the
  unrelated unlinked-user admin-notify path (lines ~196), not anything added
  by this feature — no alerting crept in anywhere in this feature's code.
- Read `src/app/(dashboard)/admin/security/page.tsx` in full to confirm the
  gate (`auth()` line 93 → `/signin`; `hasFeature(session.user.id,
  FEATURES.ADMIN_SECURITY_VIEW)` line 96 → `/admin`), the `LoadErrorCard`
  (rounded-2xl empty/error card pattern), the two distinct empty-state
  sentences, and the `overflow-x-auto` mobile wrapper present on **both**
  the list and grouped tables (lines 254, 329) — same convention as
  `sync-log`/`email-queue`, which this codebase also ships without a
  dedicated 360px test. Confirmed zero `window.confirm`/`window.alert` in
  the file (none expected — no destructive action exists in v1).
- Grepped for rate-limiting/lockout logic (`rateLimit`, `lockout`,
  `MAX_ATTEMPTS`) across `src/lib/auth/` — none found, confirming that
  scope boundary held.
- Checked `docs/reviews/log.md` to confirm the e2e timing-race QA found is
  the kind of finding that surfaces at the next cadence rather than needing
  a standalone fix right now (it's a pre-existing two-file fixture-sharing
  issue QA already mitigated locally and flagged explicitly).
- Logged `docs/backlog.md` item **B-03**, generalizing the one gap QA
  flagged (no e2e fixture for a partial-permission admin session) beyond
  just this feature, and distinguishing it from the pre-existing **B-02**
  (member-linkage fixture gap) so the two aren't conflated.

### What's working

The whole feature reads as a clean, minimal-surface audit log done right.
Two things stand out:

- **The enumeration discipline held end-to-end.** This was the single
  highest-risk item from my Phase 1 adversarial pass — a feature like this
  is exactly the kind that tempts an implementer to "improve" the failure
  message while they're in the file. QA's live `curl` test proved the
  `bad_password` and `unknown_email` responses are byte-identical
  (`302 → /signin?error=CredentialsSignin&code=credentials`), and my own
  source read confirms every `recordFailedLogin()` call is a bare statement
  inserted before an unchanged `return null`/`return false` — zero
  behavioral coupling between recording and the response the visitor sees.
- **The `unknown_email`/`no_password_set` branch split.** I flagged this in
  Phase 1 as the one place implementation could under-scope by treating "add
  six calls" as purely additive when it actually required splitting a
  collapsed `if`. It was done correctly and is now permanently guarded by
  Increment B's unit test #5 (enum/label completeness) plus QA's live
  verification that a real OAuth-only account produces `no_password_set`
  with a populated `userId`, not the generic `unknown_email`.

### Intent-vs-shipped diff

- **Phase 1 said:** admin surface with reverse-chron list (timestamp, email,
  provider, reason) + search-by-email + grouped count-by-email view. **Shipped:**
  exactly this, as two `?view=list`/`?view=grouped` tabs at `/admin/security`.
  **Verdict: matches.**
- **Phase 1/locked decision said:** 90-day retention with automatic pruning,
  piggybacked on insert (no cron infra). **Shipped:** `pruneCutoff()` +
  unconditional `DELETE ... WHERE created_at < cutoff` inside the same
  fire-and-forget block as the insert, verified live by both api-developer
  (Increment B) and QA (a synthetic 100-day-old row was pruned on the next
  insert). **Verdict: matches.**
- **Phase 1/locked decision said:** Admin-only via a new `admin.security_view`
  (or equivalent) feature key. **Shipped:** `FEATURES.ADMIN_SECURITY_VIEW =
  "admin.security_view"`, bound to the `admin` role only in
  `0055_admin_security_permission.sql`, confirmed live via `psql` (single
  row, `role = admin`). **Verdict: matches.**
- **Phase 1/locked decision said:** both list AND grouped views in v1, as two
  independent requirements (grouped view not gated by the list's search
  filter). **Shipped:** exactly this — confirmed by reading `page.tsx`: the
  grouped query has no `email` filter applied. **Verdict: matches.**
- **Phase 1/locked decision said:** no alerting. **Shipped:** confirmed — no
  `sendEmail`, no new email_queue row, no notification logic anywhere in
  `failed-login.ts`, the six `auth/index.ts` call sites, or `page.tsx`.
  **Verdict: matches.**
- **Phase 1 said:** rate-limiting/lockout out of scope. **Shipped:** confirmed
  untouched — no lockout/rate-limit logic exists anywhere in `src/lib/auth/`.
  **Verdict: matches.**
- **Phase 1/adversarial pass said:** `/signin` visitor-facing error copy must
  not change as a side effect. **Shipped:** unchanged — QA's live `curl` test
  proved the `bad_password` and `unknown_email` responses are byte-identical
  in shape (`302 → /signin?error=CredentialsSignin&code=credentials`), and my
  own read of `auth/index.ts` confirms every new call sits before an
  otherwise-untouched `return`. **Verdict: matches.**
- **Phase 1 said:** all six failure branches (five `authorize()` + the OAuth
  `signIn`-callback denial) must be recorded, not just the password path.
  **Shipped:** confirmed via direct source read of `src/lib/auth/index.ts` —
  all six call sites present, including the required
  `unknown_email`/`no_password_set` split. **Verdict: matches.**
- **Phase 1/tech-lead's design said:** insufficient-permission redirect should
  go to `/access-pending` (design doc's suggested target, not a locked user
  decision). **Shipped:** redirects to `/admin` instead, matching
  `email-queue/page.tsx`'s actual precedent (which the design doc itself said
  to copy). **Verdict: acceptable drift** — `/access-pending` is the landing
  page for a user with *no usable role at all*; an admin-dashboard user who
  merely lacks this one sub-permission getting sent back to `/admin` (where
  they do have standing) is more correct than the design doc's own suggested
  wording, and QA flagged the discrepancy explicitly rather than silently
  diverging.

### Edge cases

- **Empty state:** pass. Two distinct sentences confirmed live by QA and by
  my own read of `page.tsx` — "No failed login attempts recorded." for the
  true-empty case, "No failed login attempts found for &ldquo;{email}
  &rdquo;." for a zero-result search — both in the brand
  `bg-gray-50 rounded-2xl p-10 text-center text-gray-500` pattern.
- **Failure microcopy:** pass. `LoadErrorCard` (rounded-2xl, human sentence,
  "Try again" link) wraps the three-query `Promise.all`, matching
  DECISION-032's established pattern — no stack trace path exists.
- **Permission gate:** pass, with one honest caveat carried forward, not
  papered over. Server-side gating is real and correctly wired (`auth()` +
  `hasFeature(FEATURES.ADMIN_SECURITY_VIEW)`, independent of the nav item
  hiding the link) — confirmed by my own source read, not just QA's. But the
  *redirect-fires-for-a-denied-user* path was verified by reading the code,
  not by driving an actual denied session through the browser, because no
  test account exists that's authenticated but lacks this one permission.
  This is a real, if narrow, verification gap — logged as **B-03** below,
  not silently accepted.
- **Mobile (360px):** pass by precedent, with a note. No dedicated 360px
  viewport test was run — but I confirmed by reading `page.tsx` that both
  tables use the identical `overflow-hidden rounded-lg border ... +
  overflow-x-auto` wrapper that `sync-log` and `email-queue` already ship
  without a dedicated 360px test either. This is the established convention
  for narrow-viewport table overflow in this codebase, not an invented
  shortcut, so I'm treating page-source confirmation as sufficient evidence
  rather than blocking the ship on a fresh manual mobile pass. If a future
  360px regression turns up here, it would turn up on every other admin
  audit table too — a systemic finding, not specific to this feature.
- **Brand consistency:** pass. `rounded-2xl` on all cards/empty-states/error
  states, `rounded-lg` on the table-wrapper border (not a button, so no
  `rounded-lg`-button check applies — there are no buttons in this
  passive-viewing v1), no `window.confirm`/`alert`/`prompt` anywhere in the
  file, focus rings present on every link/input per the tech-lead's Phase 3
  notes and confirmed in Increment C's own summary.

### Follow-ups (tracked, not blocking)

1. **B-03 (new, logged in `docs/backlog.md`):** no e2e fixture exists for an
   authenticated user with a partial admin permission set, so this feature's
   (and any future admin sub-page's) permission-gate redirect can only be
   verified by code read, never a live denied request. Distinguished from
   the pre-existing B-02 (member-linkage fixture gap).
2. **Already flagged by QA, not re-logged separately:** the
   `cancel-occurrence.spec.ts` / `recurring-signup-rollup.spec.ts` shared-
   fixture timing race is pre-existing, unrelated to this feature, and QA
   already recommended it surface at the next 7-day test-coverage or 30-day
   code review — I'm not duplicating that flag here, just confirming it's
   correctly routed rather than silently dropped.
3. **`src/lib/members.ts` 0% coverage** — pre-existing, unrelated, already
   on QA's radar for the 7-day coverage review. No new action from Phase 6.

Neither follow-up blocks shipping — both are verification-depth gaps, not
functional gaps. The feature itself, as delivered, matches every Phase 1
verb, every locked user decision, and every hard requirement from the
adversarial pass.

### Outputs

- `docs/work-log/2026-07-21-failed-login-visibility.md` — this Phase 6
  section; Per-Phase Status table Phase 6 row updated to
  `Complete | SHIP IT | 2026-07-21`. **Pipeline closed.**
- `docs/backlog.md` — appended **B-03** (no e2e fixture for a partial-
  admin-permission session), placed above the pre-existing B-02 and
  cross-referenced against it.

### Open questions / handoff notes

- None blocking. This work-log is closed. Any future work on this surface
  (e.g., IP/user-agent capture, a manual "clear old entries" action, or
  extending role exposure beyond Admin) should open a new work-log rather
  than reopening this one, per the Phase 3 design doc's "Out of Scope"
  list.
