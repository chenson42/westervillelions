# Financial Report Auto-Send on Full Reconciliation — Work Log

> **Slug:** `2026-09-25-financial-report-auto-send`
> **Surface:** (dashboard) admin (ledger reconciliation) + email; reads /members/financial-reports data
> **Permission(s):** TBD in Phase 1 — no new user-facing key expected; the send is automatic, not user-invoked
> **Estimated complexity:** medium
> **Pipeline mode:** Full

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-09-25 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-09-25 |
| 3 — Technical design | tech-lead | Complete | Design complete, implementer named | 2026-09-25 |
| 4 — Implementation | database-admin → api-developer → ux-developer | Complete | — | 2026-09-25 |
| 5 — Verification | qa | Complete | PASS (with a required follow-up) | 2026-09-25 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-09-25 |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> "Autosend financial reports when reconciled" is really "decide what 'reconciled' triggers, decide send-once semantics, decide who's allowed to fire an irreversible email to the whole board, and decide whether 'auto' means no human at all or one click" — the literal ask, taken literally, is the riskiest of the four readings and I'm recommending a narrower one.

## Ground Truth Verified

- **The reconciliation predicate** is `isMonthGatedForEntity(entityId, monthEnd)` in `src/lib/financial-report-queries.ts`. A month is gated (not ready) when it hasn't calendar-elapsed yet, OR a posted+unreconciled transaction exists on/before `monthEnd` in a member-exposed fund (`administrative` | `charitable`), excluding outstanding checks and uncleared deposits. This is **scoped per entity**, and per the codebase's own note "every seeded entity has one exposed fund" — so in practice this is per (Club/Administrative) and per (Foundation/Charitable) independently. There is no combined "both funds done" predicate anywhere.
- **There are TWO write paths that can flip a transaction's `reconciled` flag**, and therefore two places that can cause a month to transition from gated → open:
  1. `POST /api/admin/ledger/reconciliation/sessions/[sessionId]/close` — bulk, inside a `db.transaction()`, sets `reconciled=true` for every matched transaction and closes the session.
  2. `POST /api/admin/ledger/transactions/[id]/reconcile` — the legacy per-row toggle, **not** wrapped in a transaction, and it explicitly supports **un-reconciling** (`reconciled: false`) "for corrections." This route can flip an already-fully-reconciled month back to gated, and a later re-toggle can flip it open again.
- **No cron exists in this project** (confirmed against CLAUDE.md's hosting constraint). Any "auto" behavior has to be inline in one or both of the routes above, or on some other user-triggered read path. `sendEmail()` delivers synchronously in-request via the Resend API (with up to 3 in-request retries) — there's no background drain of `email_queue` except the manual `/admin/email-queue` retry route. So an inline trigger means the request that closes the last transaction pays the latency of an outbound email call, and any failure past the 3 retries is only recoverable by an admin manually visiting `/admin/email-queue`.
- **`BOARD_EMAIL` (`board@westervillelions.org`)** is a plain constant in `src/lib/club-contacts.ts`, explicitly documented as **not** a Google Group this app syncs — "presumed externally/manually managed." This matters for Gap 4 below: the app has no visibility into who is actually on that list.
- **Precedent for "send exactly once"**: the acknowledgment-letter email route runs `UPDATE ledger_acknowledgments SET sent_at = now(), sent_via = 'email' WHERE id = $id AND sent_at IS NULL RETURNING id` *before* sending, so a total send failure can be safely retried and a successful one never re-fires. This pattern applies directly here but needs a new table — nothing in `schema.ts` currently tracks "was the statement for (entity, month) ever sent."
- **Precedent for signing**: `resolveTreasurer()` (`src/lib/board-positions.ts`, DECISION-086) signs dues reminders as the Board `position = 'Treasurer'` holder, never the clicking user. **Precedent for permission narrowing**: `events.announce` is deliberately narrower than `events.edit` because it fires a bulk outward email — same shape of decision applies here relative to `ledger.record`/`ledger.manage`.
- **Role bindings today**: `ledger.record` → `admin` + `treasurer`. `ledger.manage` → `admin` **only** (funds/budgets/entities/opening-balances — unrelated to this feature semantically, and the Treasurer, who actually closes reconciliation, doesn't hold it by default). Neither existing key is a clean fit for "authorize sending the board a statement."
- **Untestable in dev by design**: `board@` is a club distribution list, which `sendEmail()`'s deny-by-default guard refuses even if allowlisted. Phase 5 verification is necessarily indirect (unit tests on the trigger predicate + `/admin/email-queue` inspection with the send blocked as `blocked_non_production`), never a real send in dev.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Admin (treasurer/admin, `ledger.record`) | Closes a reconciliation session or toggles a transaction's reconciled flag at `/admin/ledger/[fundSlug]` — **the existing verb that becomes this feature's trigger**, not a new one | Per reconciliation cycle (monthly, roughly) |
| Admin (treasurer/admin, permission TBD — see Permissions) | **New, if Flow B is adopted:** clicks "Send to Board" on a month flagged ready, confirms via `<ConfirmDialog>` | Once per (entity, month), when ready |
| Board member (`board@` distribution list) | **Not one of this app's four user surfaces.** Receives an email outside any `hasFeature()` boundary — the permission check only governs who can *trigger* the send, never who's on the receiving list. Worth stating plainly: this feature's "user" for FEATURES purposes is the treasurer/admin, not the board. |
| Signed-in member (any board member who also has a linked account) | Optionally clicks through the email's deep link to `/members/financial-reports/[entitySlug]/[month]` — the existing, already-shipped read surface. No new verb; reused as-is. |

The request itself ("autosend financial reports to the board") names no actor at all — it's pure description, exactly the Pass-1 flag: nobody is described clicking anything. The trigger has to be reverse-engineered from an *existing* verb (reconciling), which is why the gaps below dominate this review.

## Flows

**Flow 1 — Detection (both write paths, must share one implementation):** Treasurer closes a session or toggles a transaction reconciled → the route (either one) re-evaluates `isMonthGatedForEntity()` for every month touched, for that entity → if a month's gate transitions from `true`→`false` (or was already `false` and untouched, so no re-check needed) **and** no send has been claimed for (entityId, month) → outcome: a send is due.
- Failure: neither write route wraps its update **and** the trigger check **and** the send-claim in one transaction today (the per-row toggle route isn't transactional at all). A race — two rapid toggles, or a toggle racing a session close on the same entity — can double-fire without an atomic claim. This must be closed at the design stage, not discovered in QA.
- Per CLAUDE.md's duplication rule: this predicate-check-and-maybe-send logic must be ONE shared helper called from both routes, never copy-pasted into each — this is exactly the class of "same decision in more than one place" the 30-day code review already watches for, so building it right the first time avoids a guaranteed future finding.

**Flow 2A — Pure auto-send (the literal request):** Detection fires due → atomic claim (`UPDATE financial_report_sends SET sent_at = now() WHERE entity_id = $x AND month = $y AND sent_at IS NULL RETURNING id`, modeled on the acknowledgment-letter pattern) → `sendEmail()` to `BOARD_EMAIL` with a summary + deep link → row recorded.
- Failure: Resend fails after 3 attempts → `email_queue` row is `failed`; the claim already happened, so **there is no automatic retry and no UI signal anywhere in the ledger surface** — the only way to notice is an admin proactively checking `/admin/email-queue`. For a "the board should have gotten this" email, silent failure with no on-screen indication is a real gap.
- No human ever sees the content before it leaves the building. One mis-reconciled transaction that happens to satisfy the gate (e.g., a treasurer clears the last blocking item without double-checking the total) produces a wrong statement in 15+ real inboxes with no undo.

**Flow 2B — Recommended alternative: detect automatically, send on one click.** Detection fires ready → a panel/badge appears on `/admin/ledger/[fundSlug]` (or a small "Financial Reports" section) visible to whoever holds the new send permission → "Send to Board" button → `<ConfirmDialog>` ("Send the [Month] [Fund] statement to the board? This cannot be undone.") → on confirm, same atomic-claim + `sendEmail()` as 2A, attributed via `resolveTreasurer()` in the body regardless of who clicked (consistent with DECISION-086) → toast success/failure, and the panel drops the month from the "ready" list.
- Failure: send fails → toast shows a human error, the month stays in the "ready to send" list (claim not taken until send succeeds — this is the one place I'd deviate from the letter's claim-before-send: here, unlike a per-donor receipt, there is no "might send twice to a stranger" risk from board@ receiving a retried click, so claiming *after* confirmed success is safer against silent failures than claiming before. Tech-lead should weigh both; flagging the tradeoff rather than dictating it.)
- Empty state: no month currently ready → panel reads "No statements ready to send yet" (not blank, not absent without explanation).

**Flow 3 — Correction after send (state-machine branch, not a separate entry point):** Treasurer un-reconciles a transaction dated inside an already-sent month (Flow 1's route 2) → gate flips back to `true` → treasurer fixes the issue and re-reconciles → gate flips back to `false`.
- Outcome required: the system must not treat "already sent" as "never send again, no matter what changes." Recommend the sent-log row also capture a cheap fingerprint of the statement's key totals at send time (e.g., ending balance + net income cents); on a second gate-clear for the same (entity, month), compare the newly computed totals — identical totals suppress a resend (nothing changed, the correction was a wash), different totals require a resend labeled "Corrected Statement — supersedes the version sent on [date]." Silently suppressing a materially corrected statement is a worse failure than a duplicate email for financial data sent to a governing body.
- Failure if unaddressed: naively reusing the acknowledgment-letter's "claimed forever" semantics (fine for a one-time donor receipt) would permanently suppress corrections here — a distinct regression class Phase 3 must design against explicitly, not inherit by copying the wrong precedent.

**Flow 4 — Historical backfill on ship day (shipping hazard, not a user flow but must be named):** The moment this ships, `isMonthGatedForEntity()` already returns `false` for however many months are already fully reconciled today — potentially most or all of the club's history. Absent an explicit guard, the very first deploy sends the board every historical statement at once.
- Required: the migration that creates the sent-log table must seed it with an "already sent" row (or an equivalent cutoff, e.g. "only months with `monthEnd >= <ship date>`") for every month that's already open as of deploy, per entity. This has to be a decision made and executed in the same migration that adds the table — never left as a follow-up.

## Permissions

- **Detection (Flow 1):** No new permission — piggybacks on the existing `ledger.record`-gated routes. Nothing user-facing changes about who can reconcile.
- **Manual send (Flow 2B, recommended):** New key, e.g. `FEATURES.LEDGER_REPORT_SEND` ("Send the monthly financial statement to the board"). Neither existing ledger key is a clean fit — `ledger.record` is the base bookkeeping permission (too broad/mismatched semantically for authorizing an outward board-wide email) and `ledger.manage` is admin-only and governs funds/budgets/entities, unrelated to this action, and would exclude the Treasurer by default. Bind the new key to `admin` + `treasurer` by default — mirrors `events.announce`'s "narrower than the base edit permission, but the two roles who actually do the underlying work still get it" pattern.
- **Pure auto-send (Flow 2A):** No user-facing permission at all, by construction — nobody clicks anything, so there's nothing to gate except the routes that already gate reconciliation. This absence-of-a-gate is itself part of why I'm not recommending 2A: an irreversible board-wide send with zero permission surface of its own is a meaningful step up in blast radius from every other automated email in this codebase (which are either genuinely non-sensitive or, like dues reminders and event announcements, one click away from a human).

## Gaps the Request Didn't Address

- **Send-once semantics under corrections (Flow 3).** The request says "autosend when fully reconciled" and doesn't consider that reconciliation is not append-only — it can be undone. Resolution: fingerprint-and-compare as described above; this needs a schema decision in Phase 3/4, not just an application-level flag.
- **Historical backfill (Flow 4).** Absolute must-fix before ship; loudest hazard in this review. Resolution: seed the sent-log as already-sent for everything before a cutoff, in the same migration that creates the table.
- **Two independent write paths, one shared trigger.** The request implies a single "reconciliation is done" moment; the codebase has two routes that can cause it, one of them non-transactional. Resolution: one shared helper, called from both, with the claim atomic against concurrent calls from either path.
- **Content/rendering duplication.** A full second HTML rendering of the statement inside the email body would violate CLAUDE.md's duplication rule (a second renderer of `getMonthlyStatement()`'s output). Recommend: a short figure summary computed from the *same* query functions, never re-derived from raw transactions, plus a deep link to the existing `/members/financial-reports/[entitySlug]/[month]` page as the one canonical rendering.
- **Audience reachability.** `board@` is externally/manually managed, not synced from this app's data (confirmed in `club-contacts.ts`). If anyone on that list lacks a linked member account, the deep link in the email is dead for them — and the memory note "members must always have user accounts" only covers *members*, not necessarily every `board@` recipient (e.g., an outside advisor). This determines whether the email needs to be self-sufficient (full summary) or can lean on the link. Needs a user answer — see Open Questions.
- **Failure visibility.** Neither Flow 2A nor a naive Flow 2B surfaces a send failure anywhere a treasurer would naturally look. Recommend the ledger UI itself show "last sent" / "send failed, retry" status per (entity, month) the same way dues reminders show a "last-reminded" badge — don't make `/admin/email-queue` the only place this is visible.
- **Race safety.** The per-row reconcile-toggle route has no transaction today. Adding a trigger check there without addressing that is building on an already-shaky foundation; Phase 3 should decide whether to wrap that route's write in a transaction as part of this work or explicitly defer it with a citation.

## Out of Scope (confirm with user)

- Automating anything beyond email — e.g., filing the statement as a Club Record / minutes attachment, or posting it to `/members/records`. The request says "email," not "publish as a governance record."
- Sending to individual board members' personal addresses instead of the `board@` list, or letting a board member opt in/out individually.
- A digest/summary email that combines both funds into one message — per the ground truth above, the gate is inherently per-entity/per-fund, so I'm treating "one email per (entity, month) as each becomes ready" as the natural shape unless told otherwise.
- Any change to the `/members/financial-reports` page itself — this feature only adds a notification layer on top of an already-shipped read surface.

## Open Questions

**Needs the user's actual decision (not a default I can pick):**
1. **Pure auto-send (Flow 2A, the literal ask) vs. detect-and-one-click-send (Flow 2B, my recommendation).** I'm recommending 2B because an irreversible, no-human-in-the-loop email to the whole board carrying real financial figures has no undo and no permission gate of its own under 2A. This is a scope judgment call the user should confirm, not one I should make unilaterally.
2. **Does `board@westervillelions.org` include anyone without a linked member account in this app?** Determines whether the email needs a full self-sufficient summary or can rely on the `/members/financial-reports` deep link.
3. **On a post-send correction with materially different totals (Flow 3), should the corrected statement actually resend, or would the board prefer to be told out-of-band (e.g., verbally at the next meeting) rather than get a second automated email?** I have a recommendation (resend, labeled "Corrected") but this is a judgment call about board communication norms, not a technical one.

**I have a recommended default and can proceed unless told otherwise:**
- One email per (entity, month) as each fund's gate clears independently, rather than waiting for both funds or bundling them (Q2 in the header prompt) — the gate is already computed per-entity, and inventing a synchronization point would be new complexity the data doesn't need.
- New permission key `FEATURES.LEDGER_REPORT_SEND`, bound to `admin` + `treasurer` by default (only relevant if Q1 resolves to Flow 2B).
- Email body: short figure summary + deep link, not a full re-rendering of the statement.
- Signed via `resolveTreasurer()`, consistent with dues reminders (only relevant if Q1 resolves to Flow 2B; a pure system send under 2A shouldn't impersonate a signature at all).
- Historical backfill: seed the sent-log as already-sent for every month open as of the ship-day migration, so deploy never blasts back-statements.

---

# Phase 2 — Architectural Review (architect) — 2026-09-25

## Verdict

**Approved with suggestions.** The feature shape (Flow 2B, detect-and-one-click-send) is architecturally sound and fits the existing Ledger/Reports surface with no new dependency and no new admin nav entry. One suggestion materially simplifies Phase 1's biggest named hazard (the two-write-path race) — tech-lead should adopt it, but it doesn't change the feature's shape enough to warrant a loop-back.

## Rulings on the five Phase 1 items

**1. Shared helper placement, and whether `isMonthGatedForEntity()` is the right thing to reuse.**

Reuse `isMonthGatedForEntity()` as-is — it's the correct, already-correct read predicate and must not be wrapped, re-derived, or copy-pasted. But I'm overruling the *shape* of Phase 1's Flow 1: because sending is now gated behind a manual click (not fired from inside the reconciliation routes), **the two write routes (`sessions/[id]/close` and `transactions/[id]/reconcile`) need zero changes for detection.** Neither route needs to write to a "send is due" queue, and neither needs to be wrapped in a shared-helper-plus-atomic-claim transaction. "Ready to send" becomes a **read-side** computation: the admin panel's `GET` loader calls `isMonthGatedForEntity()` (plus the new totals-fingerprint comparison, see item 2) fresh, on every render, for each member-exposed fund. This defuses Phase 1's loudest structural hazard — the non-transactional per-row reconcile-toggle route racing the transactional session-close route — because nothing is claimed or sent until a human reads current state and clicks a button. Race protection is still needed, but only at the actual send action (two people, or one impatient click, hitting "Send" for the same entity+month at once) — a much smaller, single-call-site problem.

Placement: a **new module**, `src/lib/financial-report-send.ts`, not an addition to `financial-report-queries.ts`. That file's own docblock declares itself "Server-only query helpers" — read-only, no side effects, mirroring the `reconciliation-queries.ts` split from `ledger-queries.ts` (DECISION-049's precedent: a distinct concern gets its own file rather than growing an existing one). The new module owns: the "list months ready to send" read (imports `getMonthlyStatement()` + `isMonthGatedForEntity()` from `financial-report-queries.ts`), the totals-fingerprint comparison, and the send action itself (`sendEmail()` + the sent-log write). This keeps `financial-report-queries.ts` pure and untouched.

**2. Corrections vs. duplicate suppression — does the acknowledgment-letter precedent apply?**

No, not wholesale — say this plainly per the prompt's instruction. The acknowledgment-letter's permanent "claimed forever" pattern exists to prevent a donor from ever receiving one receipt twice for one gift; a resend is never legitimate there. Here, a resend after a genuine correction **is** legitimate and required — a permanently-claimed row would be a functional regression (silently suppressing a materially corrected statement to the board), not a safety improvement. Approve Phase 1's fingerprint-and-compare recommendation for that reason.

What I am overruling: claim timing. Borrow only the acknowledgment-letter's *mechanism* (a single atomic `UPDATE/INSERT ... RETURNING`), not its *timing*. With a human clicking a confirm dialog, claim **after** confirmed send success, not before — Phase 1's own Flow 2B write-up already reasoned to this same place ("claiming after confirmed success is safer against silent failures than claiming before") and I'm ratifying it as the ruling, not a tradeoff left open for tech-lead. A failed send must leave the month showing "ready to send," never silently vanish behind a claimed-but-unsent row. The only remaining atomicity need is a same-instant double-click guard, satisfiable with a unique constraint on `(entity_id, month_end, totals_fingerprint)` and a caught-conflict "already sent" response — far lighter machinery than a pre-send claim across two routes.

Net: yes, this is a genuinely different case from the acknowledgment letter, for the reason above — say so in the design doc rather than silently diverging.

**3. Backfill hazard — is a seeded sent-log still needed?**

Less explosive than under pure auto-send (agreed), but the UI-clutter risk is still real: on ship day, `isMonthGatedForEntity()` already returns `false` for most of the club's history, and an unfiltered "ready to send" list would show a multi-year backlog a treasurer could click through, one email at a time, for statements that were never meant to go out as an automated feature.

Ruling: **don't seed a sent-log with N historical rows.** That requires replicating `isMonthGatedForEntity()`'s logic in raw SQL inside a migration — needless complexity and a second place the predicate could drift from its TypeScript source. Instead, put a **hardcoded cutoff constant** (the ship date of this feature, documented inline with a comment explaining why) in the new module's "list ready to send" query: exclude any month whose `monthEnd` is before the cutoff. This is simpler than a seeded migration, requires no schema seed data, and fully solves the actual problem (UI clutter / accidental historical sends) without inventing fake "already sent" log rows for statements this feature never actually sent. Tech-lead picks the exact constant and its home (a small exported `const` near the top of `financial-report-send.ts`, not buried inline).

**4. New permission — key name and bindings.**

Approve `FEATURES.LEDGER_REPORT_SEND`, bound to `admin` + `treasurer` by default. Matches the `LEDGER_<VERB>` naming convention already established by `LEDGER_VIEW`/`LEDGER_RECORD`/`LEDGER_MANAGE`/`LEDGER_APPROVE`, and the binding rationale mirrors `EVENTS_ANNOUNCE`'s precedent exactly: narrower than the base permission (`ledger.record`/`ledger.manage`), but the two roles who actually do the underlying work (closing reconciliation) still get it.

Placement detail Phase 1 didn't need to resolve but Phase 3 does: this does **not** need a new admin nav entry, and therefore doesn't touch DECISION-082's derive-from-nav machinery at all. The "Send to Board" panel hangs off the *existing* `/admin/ledger/reports` nav item (already gated `LEDGER_VIEW`). Follow the pattern already used elsewhere in this admin area (e.g. action buttons on `/admin/ledger` gated per-button on `LEDGER_RECORD`/`MANAGE`/`APPROVE` while the page itself only requires `LEDGER_VIEW` to view): the page stays reachable by any `LEDGER_VIEW` holder, the Send button is conditionally rendered only for `LEDGER_REPORT_SEND` holders, and — non-negotiably, per the API rules and `admin-page-feature-gates` discipline — the `POST` send route independently checks `auth()` + `hasFeature(FEATURES.LEDGER_REPORT_SEND)` regardless of what the UI shows.

**5. Email content — summary + deep link, shared boundary.**

Confirmed. The new send module composes the email body from a handful of scalar figures pulled from `getMonthlyStatement()`'s own return value (ending book balance, net income, month, fund name) plus a deep link to `/members/financial-reports/[entitySlug]/[month]` — never a second HTML rendering of the statement's line items. This is the same non-negotiable already written into `financial-report-queries.ts`'s docblock ("every figure... is `getFundReport()`'s own output... never re-derives from raw transactions") — extend that same discipline one level up rather than let the email body become a second renderer.

## Placement

- **New file:** `src/lib/financial-report-send.ts` — read-side "list ready to send" query (wraps `isMonthGatedForEntity()` + fingerprint comparison + cutoff-date filter), the send action (compose email + `sendEmail()` + atomic sent-log write), all server-only.
- **New route:** `src/app/api/admin/ledger/reports/send/route.ts` (or nested under the existing reports route group — tech-lead's call) — `POST`, checks `auth()` + `hasFeature(FEATURES.LEDGER_REPORT_SEND)`, calls the send action.
- **Modified:** `src/app/(dashboard)/admin/ledger/reports/page.tsx` — add the "ready to send" panel; existing `LEDGER_VIEW` page-level gate is untouched, the Send button is additionally conditioned client-side on the session's `LEDGER_REPORT_SEND` feature (cosmetic only — the route is the real gate).
- **No changes** to `sessions/[id]/close/route.ts` or `transactions/[id]/reconcile/route.ts` — see ruling #1. If tech-lead's Phase 3 design finds a concrete reason those routes still need a hook (e.g., a future notification-badge count), that's a new finding to surface explicitly, not something to assume forward from Phase 1's original write-up.
- **Server vs. client split:** the reports page stays a Server Component for its data fetch; the "Send to Board" button + `<ConfirmDialog>` needs a small client island (`'use client'`) exactly like every other destructive-confirm action in this codebase — no new pattern.
- **Dependencies:** none needed. Confirmed explicitly per the mandate — `sendEmail()`, `resolveTreasurer()`, `<ConfirmDialog>`, and Drizzle are all already available; nothing here requires a new package.

## Invariants Touched

- **Schema is the source of truth.** New table (name suggestion: `financialReportSends`, mirroring the `duesReminders`/`eventAnnouncements` naming convention) goes in `src/lib/db/schema.ts` first: `id`, `entityId` (FK → `ledgerEntities`), `monthEnd` (date), `totalsFingerprint` (text), `sentByUserId` (FK → `users`), `signedAsMemberId` (FK → `members`, via `resolveTreasurer()`, mirroring `duesReminders.signedAsMemberId`), `emailQueueId` (FK → `emailQueue`), `success` (boolean), `error` (text, nullable), `sentAt` (timestamptz). A unique index on `(entity_id, month_end, totals_fingerprint)` gives the double-click guard from ruling #2 for free. database-admin re-derives the real next migration number at Phase 4 start (currently `0102` is the latest committed — `0103` is a placeholder only, per CLAUDE.md's migration-numbers-are-tentative note).
- **No personal data in the repository.** The table stores only UUID FKs and integers — no member email/name/address is ever written into a migration or a seed. Not a concern here since there's no seed data at all (ruling #3 rejected the seeded-backfill approach specifically).
- **Outbound email is deny-by-default outside production.** `board@westervillelions.org` is a club distribution list — `sendEmail()` will refuse to deliver it in any non-production process even if allowlisted (per CLAUDE.md). This feature is **not** end-to-end testable in dev by design; Phase 5 verification must be indirect (unit tests on the fingerprint/cutoff logic, `/admin/email-queue` inspection showing `blocked_non_production`). Flag this explicitly in the Phase 3 design doc so qa doesn't attempt a live send in dev.
- **Admin-area protection is derived from `ADMIN_NAVIGATION` (DECISION-082).** Not applicable in the "new nav entry" sense — no new nav entry is being added (see Placement). But the two rules that follow from DECISION-082 still bind: (1) the reports page must keep its own `auth()` + `hasFeature()` check independent of the proxy — it already has one for `LEDGER_VIEW`; don't let this change remove or weaken it while adding the panel; (2) the new send action must gate on its own narrower feature (`LEDGER_REPORT_SEND`) in the route body — never rely on the page having already gated `LEDGER_VIEW` as sufficient authorization to send.
- **Permissions are the only gating mechanism.** New `FEATURES.LEDGER_REPORT_SEND` key, bound to `admin` + `treasurer` via the `add-permission` skill's idempotent migration pattern. No environment-flag detour — approved per ruling #4.
- **Duplication rule.** The single biggest duplication risk Phase 1 flagged (predicate logic in two write routes) is designed away entirely by ruling #1 rather than consolidated into a shared helper called from two places — zero duplication because there's only one call site now (the read-side panel query). The email-content boundary (ruling #5) closes the other duplication risk named in Phase 1 (a second statement renderer).

## Decision Logged

[DECISION-100: Financial-report board-send is read-side detection + one-click send, not a write-path hook on the reconciliation routes](/Users/cshenso/git/westervillelions/docs/decisions.md) — logged in `docs/decisions.md`, newest entry.

## Notes for Phase 3 (tech-lead)

- Adopt the read-side-detection simplification (ruling #1) explicitly in the design doc — it removes the transactional-race section Phase 1 spent the most space on. If you find a reason to reject it (e.g., a real need for a live "N ready" badge count somewhere that a read-side query can't cheaply serve), say so and justify keeping a write-path hook instead; don't silently drop back to Phase 1's original shape without noting why.
- Pick the exact ship-date cutoff constant (ruling #3) and where it lives (`financial-report-send.ts`, exported, commented).
- Decide the exact route path/shape for the send action and whether the "ready to send" list is served by the existing reports page's own server-side data fetch or a small dedicated `GET` endpoint — either is fine, no dependency implication either way.
- Specify the totals-fingerprint composition precisely (which fields, what encoding) — this is a data-shape decision, tech-lead's to make, not mine.
- Confirm with database-admin at Phase 4 start whether `financialReportSends` or a different name is preferred; I'm not locking the name, only the shape (unique index on entity+month+fingerprint, FK set above).
- Failure visibility (Phase 1's Gap: "neither flow surfaces a send failure anywhere a treasurer would naturally look") is still open and belongs in the Phase 3 component plan — the ready-to-send panel is the natural place for a "last attempt failed" state, not a new page.

---

# Phase 3 — Technical Design (tech-lead) — 2026-09-25

## Summary

We're adding a "Send to Board" action to the existing `/admin/ledger/reports` page. Today that
page shows fund reports; it will also show, per entity/fund, whichever months have finished
reconciling (per `isMonthGatedForEntity()`) but haven't yet had their Monthly Statement emailed
to the board. A `LEDGER_REPORT_SEND` holder (admin or treasurer) clicks "Send to Board" behind a
`<ConfirmDialog>`; the click composes a short figure summary from `getMonthlyStatement()`'s own
output, emails it to `board@westervillelions.org` with a deep link to the member-portal
statement, and records the attempt. Detection is entirely read-side — per DECISION-100, neither
reconciliation write route changes. A totals fingerprint distinguishes "already sent, nothing
changed" from "reconciliation was corrected after the fact, resend" so the board never gets a
stale statement without a visible path to the corrected one, and never gets silently spammed by
a wash correction either.

## Permissions

- New key: `FEATURES.LEDGER_REPORT_SEND = "ledger.report_send"` — "Send the monthly financial
  statement to the board." Added next to the other `LEDGER_*` keys in `src/lib/permissions.ts`
  (`FEATURES` object, `FEATURE_DESCRIPTIONS` map).
- Default role bindings: `admin` + `treasurer`, via the `add-permission` skill's idempotent
  migration pattern (mirrors `EVENTS_ANNOUNCE`'s binding exactly).
- No new `ADMIN_NAVIGATION` entry — the existing "Reports" entry (`/admin/ledger/reports`,
  `requiredFeature: FEATURES.LEDGER_VIEW`) is unchanged. Two independent checks apply, per
  DECISION-082's two rules:
  1. The reports **page** keeps its existing `LEDGER_VIEW` gate (untouched) and additionally
     reads `session.user.features` to decide whether to render the Send panel's action button
     for the current user — cosmetic only, exactly like the existing `LEDGER_RECORD`/`MANAGE`/
     `APPROVE`-gated buttons already on `/admin/ledger`.
  2. The **send route** (`POST /api/admin/ledger/reports/send`) independently calls `auth()` +
     `hasFeature(session.user.id, FEATURES.LEDGER_REPORT_SEND)` and 403s otherwise — never
     inferring authorization from the fact that the request reached the route at all.

## API Contract

No new `GET` route. The "ready to send" list is computed **inside the existing Server Component**
(`/admin/ledger/reports/page.tsx`'s own data fetch), the same way `/admin/dues/reminders/page.tsx`
calls `getReminderCandidates()` directly — no client-side fetch, no extra network hop, and it
naturally respects `export const dynamic = "force-dynamic"` already on that page.

```ts
// src/lib/financial-report-send.ts

export type ReadyToSendReport = {
  entityId: string;
  entitySlug: string;
  entityName: string;      // ledgerEntities.name, e.g. "Westerville Lions Club"
  fundId: string;
  fundName: string;        // ledgerFunds.name
  month: string;           // 'YYYY-MM'
  monthEndLabel: string;   // "June 30, 2026" — from MonthlyStatement.monthEndLabel
  summary: {
    endingBookBalanceCents: number;
    netOneMonthCents: number;
    netTwelveMonthCents: number;
  };
  fingerprint: string;
  state: "never_sent" | "corrected";
  // Present only when state === "corrected", or to render the "last sent"
  // status line for a month NOT in the ready list (see listReadyToSendReports
  // below — it also returns already-sent months for status-line display).
  lastSuccessfulSend: { sentAt: string; signedAsName: string } | null;
  lastAttemptFailed: { sentAt: string; error: string } | null;
};

/**
 * One row per (entity, member-exposed fund, month) from CUTOFF_MONTH through
 * that fund's latest open month (getLatestOpenMonthForEntity — the gate is
 * monotonic, so every month in between is also open). Two states:
 *   - "ready" rows: never sent, OR sent but the current fingerprint differs
 *     from the last successful send's fingerprint ("corrected").
 *   - status-only rows: already sent with a MATCHING fingerprint — returned
 *     so the page can render a quiet "sent on <date>" line per fund even
 *     when there's nothing actionable, never a blank panel with no context.
 * Callers filter on `state` if they only want actionable rows.
 */
export async function listReadyToSendReports(): Promise<ReadyToSendReport[]>;

export type SendReportResult =
  | { ok: true; emailQueueId: string; sentAt: string; corrected: boolean }
  | { ok: false; reason: "not_found" | "invalid_month" | "not_ready"
                 | "treasurer_unresolved" | "already_sent" | "send_failed";
      detail?: string };

/**
 * Re-validates everything server-side — never trusts the panel's rendered
 * state. Re-runs isMonthGatedForEntity(), recomputes the fingerprint fresh,
 * resolves the treasurer, sends, and claims. See Edge Cases for the ordering.
 */
export async function sendMonthlyReportToBoard(
  entityId: string,
  month: string,
): Promise<SendReportResult>;
```

```
POST /api/admin/ledger/reports/send
Body:    { entityId: string; month: string }   // month = 'YYYY-MM'
200 OK:  { ok: true; emailQueueId: string; sentAt: string; corrected: boolean }
401:     unauthenticated
403:     { error: "forbidden" }                  — missing LEDGER_REPORT_SEND
400:     { error: "invalid_month" }              — malformed 'YYYY-MM' or bad JSON body
404:     { error: "not_found" }                  — entity or its member-exposed fund doesn't exist
409:     { error: "not_ready" }                  — month re-gated since the panel last rendered
409:     { error: "already_sent" }               — unique-index conflict (double-click race)
422:     { error: "treasurer_unresolved" }        — resolveTreasurer() returned ok:false
502:     { error: "send_failed"; detail: string } — sendEmail() failed after its 3 retries
```

The route is a thin wrapper: `auth()` → `hasFeature()` → parse body → call
`sendMonthlyReportToBoard()` → map its `SendReportResult` to the HTTP status above. All real
logic lives in the lib function so it's unit-testable without spinning up a route handler.

## Data Model

New table, `financialReportSends`, added to `src/lib/db/schema.ts` (naming mirrors
`duesReminders`/`eventAnnouncements`):

```ts
export const financialReportSends = pgTable(
  "financial_report_sends",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => ledgerEntities.id, { onDelete: "cascade" }),
    // Recorded for joins/rendering (which fund this statement was), but NOT
    // part of the uniqueness key below — every seeded entity has exactly one
    // member-exposed fund today (MEMBER_EXPOSED_FUND_KINDS ground truth,
    // Phase 1). If that ever changes, the unique index below would need a
    // second look; flagging here rather than silently building on the
    // assumption without saying so.
    fundId: uuid("fund_id")
      .notNull()
      .references(() => ledgerFunds.id, { onDelete: "cascade" }),
    monthEnd: date("month_end").notNull(), // 'YYYY-MM-DD', matches monthBounds().monthEnd
    totalsFingerprint: text("totals_fingerprint").notNull(),
    sentByUserId: uuid("sent_by_user_id").references(() => users.id, { onDelete: "set null" }),
    // The resolved Board position='Treasurer' holder at send time (resolveTreasurer()),
    // mirroring duesReminders.signedAsMemberId — never the clicking user.
    signedAsMemberId: uuid("signed_as_member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    emailQueueId: uuid("email_queue_id").references(() => emailQueue.id, { onDelete: "set null" }),
    success: boolean("success").notNull(),
    error: text("error"),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Double-click / concurrent-send guard: PARTIAL unique index, WHERE
    // success — see "Why claim-after-success needs a partial index" below.
    uniqueSuccessfulSend: uniqueIndex("financial_report_sends_unique_success")
      .on(table.entityId, table.monthEnd, table.totalsFingerprint)
      .where(sql`${table.success} = true`),
    entityMonthIdx: index("financial_report_sends_entity_month_idx").on(
      table.entityId,
      table.monthEnd,
    ),
  }),
);

export type FinancialReportSend = typeof financialReportSends.$inferSelect;
export type NewFinancialReportSend = typeof financialReportSends.$inferInsert;
```

Matching idempotent migration, `drizzle/migrations/0103_financial_report_sends.sql` (database-admin
re-derives the real next number at Phase 4 start — 0103 is a placeholder per CLAUDE.md's
migration-numbers-are-tentative note):

```sql
CREATE TABLE IF NOT EXISTS financial_report_sends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL REFERENCES ledger_entities(id) ON DELETE CASCADE,
  fund_id UUID NOT NULL REFERENCES ledger_funds(id) ON DELETE CASCADE,
  month_end DATE NOT NULL,
  totals_fingerprint TEXT NOT NULL,
  sent_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  signed_as_member_id UUID REFERENCES members(id) ON DELETE SET NULL,
  email_queue_id UUID REFERENCES email_queue(id) ON DELETE SET NULL,
  success BOOLEAN NOT NULL,
  error TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'financial_report_sends_unique_success'
  ) THEN
    CREATE UNIQUE INDEX financial_report_sends_unique_success
      ON financial_report_sends (entity_id, month_end, totals_fingerprint)
      WHERE success = true;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS financial_report_sends_entity_month_idx
  ON financial_report_sends (entity_id, month_end);
```

No seed data (ruling #3) and no personal data — every column is a UUID FK, a date, a boolean, or
a system-generated hash/error string.

### Why claim-after-success needs a *partial* unique index

Phase 2 ruled: claim after confirmed send success, and a failed send must leave the month
"ready to send," never vanish behind a claimed row. Phase 1's still-open Gap ("failure
visibility — neither flow surfaces a send failure anywhere a treasurer would naturally look")
is assigned to this phase to resolve. Both are satisfiable by the SAME table if the unique index
is partial:

- **Insert a row on every attempt, success or failure** (not just successes). This gives the
  panel real failure visibility for free — `listReadyToSendReports()` joins the latest row per
  (entity, month) and surfaces `lastAttemptFailed` when it's `success=false`, without a second
  table or a fragile text-match against `email_queue`.
- **The unique index only applies `WHERE success = true`.** A failed attempt's row never
  collides with anything, so a retry after failure is always insertable — no cleanup, no
  "delete the failed row first" step. Two people (or one impatient double-click) racing a
  *successful* send for the same (entity, month, fingerprint) still collide on the index, which
  is exactly the double-click guard Phase 2 asked for.
- A row is inserted via a single `INSERT ... ON CONFLICT (entity_id, month_end, totals_fingerprint)
  WHERE success DO NOTHING RETURNING id` **after** `sendEmail()` returns, using its `success`
  result. If `sendEmail()` returned `false`, the inserted row has `success: false` and the month
  stays actionable in the panel; if `sendEmail()` returned `true` (which `email.ts` also returns
  for the `blocked_non_production` dev-guard case — see Edge Cases), the row has `success: true`
  and future calls for the same fingerprint conflict-and-no-op.

## The Totals Fingerprint

A SHA-256 hex digest (`crypto.createHash('sha256')`, Node's built-in, no new dependency) over a
canonical JSON string built from a **fixed, explicitly-ordered** object — never
`JSON.stringify(statement)` on the whole `MonthlyStatement`, which would fingerprint line-item
and cause-line detail this feature deliberately never shows the board (per Phase 2 ruling #5,
"never a second HTML rendering of the statement's line items"). The fingerprint's job is: would
a resent summary email read differently than the one already sent? So it covers exactly the
numbers that can appear in that summary or that Flow 3 needs to call "materially different,"
nothing from the line-item/cause-line breakdown:

```ts
// financial-report-send.ts
type FingerprintInput = {
  month: string;                          // 'YYYY-MM' — a fingerprint is never compared cross-month
  beginningBookBalanceCents: number;
  endingBookBalanceCents: number;
  totalRevenueOneMonthCents: number;
  totalExpenseOneMonthCents: number;
  netOneMonthCents: number;
  totalRevenueTwelveMonthCents: number;
  totalExpenseTwelveMonthCents: number;
  netTwelveMonthCents: number;
  bookVsCashDivergenceCents: number;
};

export function computeTotalsFingerprint(statement: MonthlyStatement): string {
  // Field order below is PART OF THE CONTRACT — do not reorder or add keys
  // via spread/Object.keys. Reordering changes every future fingerprint's
  // hash for rows whose totals didn't actually change, which would read as
  // "corrected" for nothing. If a field genuinely needs to be added, that's
  // fine (it only affects fingerprints computed after the change), but never
  // reorder the existing ones.
  const input: FingerprintInput = {
    month: statement.month,
    beginningBookBalanceCents: statement.beginningBookBalanceCents,
    endingBookBalanceCents: statement.endingBookBalanceCents,
    totalRevenueOneMonthCents: statement.totalRevenue.oneMonthCents,
    totalExpenseOneMonthCents: statement.totalExpense.oneMonthCents,
    netOneMonthCents: statement.net.oneMonthCents,
    totalRevenueTwelveMonthCents: statement.totalRevenue.twelveMonthCents,
    totalExpenseTwelveMonthCents: statement.totalExpense.twelveMonthCents,
    netTwelveMonthCents: statement.net.twelveMonthCents,
    bookVsCashDivergenceCents: statement.bookVsCashDivergenceCents,
  };
  const canonical =
    `${input.month}|${input.beginningBookBalanceCents}|${input.endingBookBalanceCents}|` +
    `${input.totalRevenueOneMonthCents}|${input.totalExpenseOneMonthCents}|${input.netOneMonthCents}|` +
    `${input.totalRevenueTwelveMonthCents}|${input.totalExpenseTwelveMonthCents}|` +
    `${input.netTwelveMonthCents}|${input.bookVsCashDivergenceCents}`;
  return crypto.createHash("sha256").update(canonical).digest("hex");
}
```

Using a delimited string literal (not `JSON.stringify`) sidesteps any question of key ordering
entirely — there's only one possible serialization of a template literal. Stored as the full
64-character hex digest in `totalsFingerprint` (no truncation; the table is low-volume, so
collision-avoidance costs nothing).

**Comparison rule (Flow 3):** for a month already in `financialReportSends` with a successful
row, compute the fresh fingerprint from the current `getMonthlyStatement()` call.
- Fresh fingerprint **equals** the last successful row's → nothing changed since the send;
  excluded from the actionable list, shown only as the quiet "sent on <date>" status line.
- Fresh fingerprint **differs** → `state: "corrected"`; included in the actionable list, labeled
  "Corrected — supersedes the version sent on [date]," per Phase 1's recommendation, which
  Phase 2 approved outright (not a case where the acknowledgment-letter's permanent-claim
  precedent applies — a resend here is legitimate and required, not a bug to prevent).

## Component / Page Plan

**Files to modify:**
- `src/lib/db/schema.ts` — add `financialReportSends` (above).
- `src/lib/permissions.ts` — add `LEDGER_REPORT_SEND` to `FEATURES` and `FEATURE_DESCRIPTIONS`.
- `src/app/(dashboard)/admin/ledger/reports/page.tsx` — fetch `listReadyToSendReports()`
  alongside its existing `getEntities()`/`getEntityReport()` calls; render the new panel above
  the existing `FundCard` grid; pass `session.user.features` down so the panel component can
  decide whether to render the Send button at all (cosmetic gate only — see Permissions).

**Files to create:**
- `src/lib/financial-report-send.ts` — `listReadyToSendReports()`, `sendMonthlyReportToBoard()`,
  `computeTotalsFingerprint()`, the `CUTOFF_MONTH` constant (below), the email-body composer.
  Server-only; imports `getMonthlyStatement`/`isMonthGatedForEntity`/`MEMBER_EXPOSED_FUND_KINDS`
  from `financial-report-queries.ts`, `getFunds`/`getEntities` from `ledger-queries.ts`,
  `resolveTreasurer` from `board-positions.ts`, `sendEmail` from `email.ts`, `getFromEmail`/
  `getAppUrl`/`escapeHtml` from `email-compose.ts`, `BOARD_EMAIL` from `club-contacts.ts`.
- `src/app/api/admin/ledger/reports/send/route.ts` — the `POST` handler described above.
- `src/components/admin/ledger/financial-report-send-panel.tsx` (`'use client'`) — renders one
  card per entity/fund: a status line (last successful send date, or "Never sent") plus, when
  `state !== undefined` (i.e. the row is actionable), a one-line figure summary and a "Send to
  Board" / "Resend Corrected Statement" button behind `<ConfirmDialog>`.

**Ship-date cutoff.** Exported `const CUTOFF_MONTH = "2026-09"` (this feature's ship month) in
`financial-report-send.ts`, commented inline: "Months before this were never offered by this
feature and are excluded from `listReadyToSendReports()` — without this, day-one deploy would
list every already-reconciled month in the club's history as 'ready to send' (Phase 1 Flow 4).
Not a seeded DB row (Phase 2 ruling #3) — a hardcoded floor on the query." `listReadyToSendReports()`
iterates candidate months from `CUTOFF_MONTH` through each fund's `getLatestOpenMonthForEntity()`
result (inclusive), skipping nothing else — the gate's monotonicity guarantees every month in
that range is open.

**ConfirmDialog copy** (non-destructive — same reasoning as the dues-reminder sender's inline
comment: sending is irreversible, but a red danger button on a routine board report reads as a
warning about the act itself; the safety here is the explicit fund/month named in the title):

```tsx
<ConfirmDialog
  open={confirmOpen}
  onOpenChange={setConfirmOpen}
  title={
    row.state === "corrected"
      ? `Resend the corrected ${row.fundName} statement for ${row.monthEndLabel}?`
      : `Send the ${row.fundName} statement for ${row.monthEndLabel} to the board?`
  }
  description={
    row.state === "corrected"
      ? `This replaces the version sent on ${formatDate(row.lastSuccessfulSend!.sentAt)} — the ` +
        `totals changed since then. The board will see this labeled "Corrected."`
      : `This emails a summary to board@westervillelions.org with a link to the full statement ` +
        `in the member portal. This cannot be undone.`
  }
  confirmLabel={sending ? "Sending…" : row.state === "corrected" ? "Resend Corrected Statement" : "Send to Board"}
  onConfirm={() => void handleSend(row)}
/>
```

**Empty state** (no fund anywhere has a ready-or-corrected row): `bg-gray-50 rounded-2xl p-10
text-center text-gray-500` — "No statements ready to send yet." per CLAUDE.md's Empty States
pattern, matching Phase 1's Flow 2B recommendation.

**Mobile (360px):** the panel is a single-column card stack (`space-y-4`), each card full-width;
the Send button is full-width on mobile (`w-full sm:w-auto`) with the standard 44px tap target
and `focus:ring-2 focus:ring-lions-blue`.

## Email Shape

- **Signed by:** `resolveTreasurer()`'s result at send time — never the clicking user (mirrors
  DECISION-086, confirming Phase 1's proposal). If `resolveTreasurer()` returns `ok: false`, the
  send **hard-blocks** with `treasurer_unresolved` (422) — same posture as the dues-reminder
  signer (a Board-position-agnostic system email reads as impersonal and undermines the "this is
  the treasurer's report" framing the board expects), not the tolerant CC-only posture the five
  treasury-CC sites use. This is the one deviation from a pure default I'm calling explicitly:
  Phase 1 only asked "confirm or overrule 2A's proposal," and I'm confirming resolveTreasurer()
  but overruling *tolerant* failure in favor of *hard* failure, because unlike a CC line, the
  signature here is load-bearing to the recipient's trust in the statement.
- **Envelope, not body prose:** the resolved treasurer's email goes in `replyTo` — mirroring the
  acknowledgment-letter precedent named in the prompt ("the treasurer is envelope-only, never
  body prose"). `to: BOARD_EMAIL`, `from: getFromEmail("Westerville Lions Club")`. No `bcc`
  needed (unlike the acknowledgment letter, there's no separate "the treasurer should get a copy
  too" requirement here — the treasurer already sees this exact statement inside the admin
  Ledger).
- **Subject:** `` `${entityShortName} Financial Statement — ${monthLabel}` `` (add `"Corrected: "`
  prefix when `state === "corrected"`), e.g. `"Corrected: Club Financial Statement — June 2026"`.
- **Body (HTML, escaped via `escapeHtml` from `email-compose.ts` for every string field — the
  treasurer's resolved first/last name is the only free-text-ish value here, and it still goes
  through the escaper on principle, matching the project's "no exceptions" posture after the
  2026-08-12 incident):**
  - One sentence naming the fund and month.
  - Three lines: Ending Balance, This Month's Net Income, Fiscal-Year-to-Date Net Income — the
    exact three figures the fingerprint also tracks, sourced directly from the same
    `getMonthlyStatement()` call this request already made (never re-derived, never a second
    query).
  - If `corrected`, one line: "This replaces the statement sent on [date]."
  - A single CTA link: `` `${getAppUrl()}/members/financial-reports/${entitySlug}/${month}` ``
    — "View the full statement" — reusing the exact route the member portal already serves.
  - Signature block: "— [Treasurer First] [Treasurer Last], Treasurer, Westerville Lions Club."
    No further prose from the sending user.
- **Never a second renderer:** every number in the email comes from the same `MonthlyStatement`
  object `sendMonthlyReportToBoard()` already fetched to compute the fingerprint — one
  `getMonthlyStatement()` call serves both fingerprinting and email composition.

## Implementation Order

1. **Schema** — `database-admin` adds `financialReportSends` to `schema.ts` and writes
   `drizzle/migrations/NNNN_financial_report_sends.sql` (idempotent, table + partial unique
   index + lookup index as above; re-derive the real next migration number).
2. **Permission** — `database-admin` (or whoever runs the `add-permission` skill) adds
   `LEDGER_REPORT_SEND` to `FEATURES`/`FEATURE_DESCRIPTIONS` in `permissions.ts` and writes the
   idempotent role-binding migration (`admin` + `treasurer`).
3. **Server logic** — `api-developer` writes `src/lib/financial-report-send.ts` (fingerprint,
   cutoff constant, `listReadyToSendReports()`, `sendMonthlyReportToBoard()`, email composer) and
   `src/app/api/admin/ledger/reports/send/route.ts`. This is the layer with the real design risk
   (fingerprint correctness, claim ordering, treasurer resolution, error-status mapping) and
   needs to be solid and unit-tested before any UI is built on top of it.
4. **UI** — `ux-developer` builds `financial-report-send-panel.tsx` and wires it into
   `reports/page.tsx`, following the dues-reminder-sender's ConfirmDialog/toast pattern.
5. **Email** — no separate step; composition lives inside `sendMonthlyReportToBoard()` from
   step 3, calling the existing `sendEmail()`.
6. **Release notes** — `tech-lead` writes the `docs/release-notes/vX.Y.md` entry once QA passes
   and this is ready to ship, per the standing memory rule (release notes on every push to main)
   and CLAUDE.md's no-file-lists guidance (describe the board-visibility value, not the schema).

## Implementer

**Specialist split: database-admin → api-developer → ux-developer.** This spans a real schema
decision (the partial unique index is the load-bearing correctness mechanism, not boilerplate),
a real API-contract/business-logic layer (fingerprinting, claim ordering, treasurer-resolution
failure mode, five-way error mapping) that is meaningfully more than "~150 lines, tightly
coupled," and a UI layer that's genuinely separable once the contract above exists (the panel
only needs `ReadyToSendReport[]` and one `POST` endpoint — it doesn't need to know how the
fingerprint is computed). CLAUDE.md's explicit guidance is to reserve full-stack-developer for
small, tightly-coupled work; this is neither. Follow the same three-hop pattern the minutes
browse/search feature used (2026-09-09), which is cited in this agent's own instructions as the
model for exactly this shape of feature (new query-layer design + a UI surface on top).

## Edge Cases & Risks

- **Zero-transaction month.** `isMonthGatedForEntity()` only inspects UNRECONCILED rows — a
  month with literally zero transactions has none to be unreconciled, so the gate clears
  trivially (assuming the month has elapsed). Ruling: **still offer it.** A month with genuinely
  no activity is a legitimate, if boring, statement (opening balance = ending balance, zero net)
  and the board is entitled to see "nothing happened this month" exactly as much as an active
  one — hiding it would be an undocumented special case with no basis in the settled decisions.
  If this turns out to read as noise in practice, that's a Phase 6/follow-up UX call, not a
  Phase 3 one.
- **Both funds send independently.** Confirmed, not changed: `listReadyToSendReports()` and
  `sendMonthlyReportToBoard()` are per-(entity, fund, month) throughout; there is no
  "wait for both funds" synchronization point, matching Phase 1's recommended default and the
  fact that the gate itself has no cross-entity concept.
- **Partial send failure, can a retry double-send?** No. `sendMonthlyReportToBoard()` re-fetches
  the statement and recomputes the fingerprint on every call (never trusts a client-supplied
  fingerprint), calls `sendEmail()`, and only AFTER that call attempts the
  `INSERT ... ON CONFLICT ... WHERE success DO NOTHING`. A failed `sendEmail()` inserts a
  `success: false` row (no conflict possible — the partial index doesn't cover it) and returns
  `send_failed`; the month stays in the ready list because `listReadyToSendReports()` only
  excludes months with a **successful** row at the current fingerprint. A retry re-runs the same
  path; if it succeeds this time, the `ON CONFLICT ... WHERE success` insert succeeds (no prior
  successful row exists yet) and the month leaves the ready list. Two concurrent successful
  sends for the same (entity, month, fingerprint) — the double-click case — both call
  `sendEmail()` (an unavoidable, acceptable cost: at most one duplicate email in the double-click
  window, never a duplicate DB claim), but only the first `INSERT` wins; the second hits the
  unique-index conflict and the route returns `already_sent` rather than erroring.
- **A correction after send that the treasurer never re-sends.** The board holds a stale
  statement, and this is visible, not silent: `listReadyToSendReports()` recomputes the
  fingerprint on every page load, so the moment totals diverge, that row flips from the quiet
  "sent on <date>" status line to an actionable "Corrected" card sitting right on the page the
  treasurer already visits to reconcile. It is still possible for the treasurer to see that card
  and not click it — that's a human process gap this design surfaces but can't force closed, and
  matches Phase 1 Q3's answer (resend is offered, not automatic).
- **Fingerprint field-order drift.** Called out inline in the fingerprint function itself — see
  above. Guard against a future PR "cleaning up" the object into a spread/`Object.keys()` form.
- **`board@` distribution list is unreachable outside production.** `sendEmail()`'s deny-by-default
  guard refuses it even if allowlisted (per `club-contacts.ts` and `email.ts`'s guardrail
  comment). `sendEmail()` still returns `{ success: true, emailQueueId }` for the
  `blocked_non_production` case, which means the claim row IS written as `success: true` in dev
  — this is correct and intentional (dev behavior mirrors production's success path exactly, per
  the guardrail's own design goal), but it means **dev testing cannot observe the `send_failed`
  path via a real Resend failure** — only via a mocked `sendEmail()` in a unit test. Flag this
  explicitly for qa (Phase 5): verification is unit tests on the lib layer plus `/admin/email-queue`
  inspection showing `blocked_non_production`, never a live send in dev.
- **Fund/entity resolution.** `sendMonthlyReportToBoard(entityId, month)` resolves the entity's
  member-exposed fund the same way `getMonthlyStatement()`'s existing callers do (`getFunds(entityId)`
  filtered to `MEMBER_EXPOSED_FUND_KINDS`) — never trusts a fund id from the request body, only
  an entity id + month. If an entity has zero or more than one member-exposed fund (today: always
  exactly one), return `not_found` rather than guessing.

## Unit Tests the Implementer Must Deliver

Per CLAUDE.md, Phase 4 delivers these, not qa:

1. **`computeTotalsFingerprint()`** — identical `MonthlyStatement` inputs (aside from fields
   deliberately excluded, e.g. a changed `hasUndatedHistoricalRows` flag or a reshuffled
   `causeLines` array with the same category totals) produce the same fingerprint; a changed
   `endingBookBalanceCents` (or any of the other 8 tracked fields) produces a different one.
2. **`listReadyToSendReports()` cutoff behavior** — a month before `CUTOFF_MONTH` is never
   included even when its gate is open; a month at/after `CUTOFF_MONTH` and open is included;
   a still-gated month (not yet elapsed, or a genuine unreconciled backlog) is excluded entirely
   (neither actionable nor a status line).
3. **Zero-transaction month is offered** — an entity/fund/month with no transactions at all
   still appears as `never_sent` once elapsed, not silently skipped.
4. **Corrected-resend predicate** — a month with a successful send row whose fingerprint matches
   the current statement is excluded from the actionable list (only a status line); a month
   whose fingerprint has since changed is `state: "corrected"` and actionable.
5. **Claim/conflict behavior** — `sendMonthlyReportToBoard()` with a mocked `sendEmail()`:
   returning `success: true` results in a `success: true` DB row and `ok: true`; returning
   `success: false` results in a `success: false` DB row (not a missing row) and
   `reason: "send_failed"`, and a subsequent call with the same fingerprint is NOT blocked (no
   `already_sent`) because the partial index only covers successful rows.
6. **Double-send guard** — two sequential calls to `sendMonthlyReportToBoard()` for the same
   (entity, month) where both `sendEmail()` calls succeed and the fingerprint hasn't changed
   between them: the second returns `reason: "already_sent"`, not a duplicate successful row.
7. **Treasurer-unresolved hard block** — a mocked `resolveTreasurer()` returning `ok: false`
   short-circuits before any `sendEmail()` call and returns `reason: "treasurer_unresolved"`.
8. **Permission gate** — `POST /api/admin/ledger/reports/send` 403s for a session without
   `LEDGER_REPORT_SEND` (e.g., a `LEDGER_VIEW`-only or `LEDGER_RECORD`-only session) even though
   that session can view `/admin/ledger/reports` itself; 401s with no session at all.

---

# Phase 4 — Implementation

## Phase 4 — Implementation (schema) — 2026-09-25

**Owner:** database-admin
**Status:** complete

### Summary

Added the `financial_report_sends` sent-log table per DECISION-100/101 and the
`LEDGER_REPORT_SEND` permission (bound to `admin` + `treasurer`), both as steps 1 and 2 of the
Phase 3 design's Implementation Order. Schema-only — no server logic or UI, which are
`api-developer`'s and `ux-developer`'s layers.

### What I did

- Re-derived the real next migration number at Phase 4 start (per CLAUDE.md): `ls drizzle/migrations/*.sql | sort | tail -3` showed the highest existing file was `0102_ledger_audit_log_transaction_target.sql`, so the schema migration is `0103` and the permission migration is `0104` (not the design doc's placeholder `0103` for the table alone — I needed two files, so the permission migration took the next number after it).
- Added `financialReportSends` to `src/lib/db/schema.ts`, immediately after `ledgerSettings` and before the "Bank Reconciliation inc2" section comment — it's a Ledger table (FKs to `ledgerEntities`/`ledgerFunds`) but only loosely related to reconciliation, so I placed it at the end of the original Ledger inc1 block rather than inside inc2.
- Added `import { sql } from "drizzle-orm";` to schema.ts (not previously imported) — needed for the partial unique index's `.where(sql\`...\`)` clause.
- Used the codebase's array-style table-config convention (`(t) => [...]`), not the design doc's object-style (`(table) => ({...})`) — the object style doesn't appear anywhere else in `schema.ts`; the array style does, consistently.
- Wrote `drizzle/migrations/0103_financial_report_sends.sql`: `CREATE TABLE IF NOT EXISTS`, a guarded `DO $$ ... CREATE UNIQUE INDEX ... WHERE success = true` (checked via `pg_indexes`, matching the exact pattern already used for `ledger_bank_accounts`' `is_default` partial index in `0070_default_bank_account.sql`), and a plain `CREATE INDEX IF NOT EXISTS` lookup index.
- Ran the `add-permission` skill for `LEDGER_REPORT_SEND` (per the task's suggestion, for consistency) — added the `FEATURES` key and `FEATURE_DESCRIPTIONS` entry to `src/lib/permissions.ts`, and wrote `drizzle/migrations/0104_ledger_report_send_permission.sql` bound to `admin` + `treasurer` only (not `board_member`, unlike `ledger.view`'s wider spread — sending mail to the whole board is a treasury action, not a read/oversight one). Did **not** run the skill's Step 4 (apply locally) or Step 6 (release notes) — those are out of scope for this agent/phase; release notes land at ship time per `tech-lead`'s step 6 in the Implementation Order.
- Verified the actual live column names before writing SQL (`features.name`/`category`/`description`, `role_features.role_id`/`feature_id` — not the generic `key`/`feature_key` the skill's own doc-comment shows) by reading `0045_ledger_permissions.sql` and `0100_sync_log_view_permission.sql`, the two most recent comparable permission migrations.

### Outputs

- `src/lib/db/schema.ts` — new `financialReportSends` table (+ `FinancialReportSend`/`NewFinancialReportSend` types) and the new `sql` import.
- `src/lib/permissions.ts` — new `FEATURES.LEDGER_REPORT_SEND = "ledger.report_send"` and matching `FEATURE_DESCRIPTIONS` entry.
- `drizzle/migrations/0103_financial_report_sends.sql` — table + partial unique index (`(entity_id, month_end, totals_fingerprint) WHERE success = true`) + lookup index on `(entity_id, month_end)`. Every statement idempotent (`IF NOT EXISTS` / guarded `DO $$` / `pg_indexes` check).
- `drizzle/migrations/0104_ledger_report_send_permission.sql` — `ledger.report_send` feature row + role bindings to `admin` and `treasurer`. Every statement idempotent (`WHERE NOT EXISTS`).
- Tables affected: new `financial_report_sends`; FKs to `ledger_entities` (cascade), `ledger_funds` (cascade), `users` (set null, `sent_by_user_id`), `members` (set null, `signed_as_member_id`), `email_queue` (set null, `email_queue_id`).
- No seed data beyond the permission row/bindings above; no personal data anywhere in either migration (every `financial_report_sends` column is a UUID FK, a date, a boolean, or a system-generated hash/error string).
- Local apply command (not run by me): `export $(grep -E "^DATABASE_URL=" .env.local | xargs) && pnpm db:migrate`, followed by `pnpm db:push` since `schema.ts` changed.

### Column-type rationale (per the task's non-negotiable #5)

- `month_end DATE` (not `timestamp`/`timestamptz`) — it's the last calendar day of a statement month (`monthBounds().monthEnd`, `'YYYY-MM-DD'`), never a point in time. Using `date` avoids any timezone reinterpretation on a value that was never an instant.
- `sent_at TIMESTAMPTZ NOT NULL DEFAULT now()` — a genuine instant (when the send attempt happened), so it gets `{ withTimezone: true }` per the current convention (matches `clubFileEvents.createdAt`, `duesReminders.sentAt`'s sibling tables added after the 2026-09-03 drift finding — I checked `duesReminders` itself still uses naive `timestamp` since it predates the convention switch documented in the "Bank Reconciliation inc2" section comment, but a *new* table has no excuse to inherit that, so I used `withTimezone: true` throughout).
- `entity_id`/`fund_id`/`sent_by_user_id`/`signed_as_member_id`/`email_queue_id` — all `uuid`, matching the referenced tables' PK type, with `onDelete` per the owned-child-vs-optional-link convention (`cascade` for the two Ledger FKs the row is fundamentally about; `set null` for the three "who/what" pointers that shouldn't take this audit row down with them).

### Idempotency verification

**I did not execute either migration file** — the task instructions explicitly say authoring is the deliverable, not running it, and to avoid any live/shared DB writes (this includes scratch Neon branches, which are still a DB write via the Neon MCP tools). Verified by review instead:
- `0103`: `CREATE TABLE IF NOT EXISTS` short-circuits on the second run. The partial unique index is created inside `DO $$ IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = ...) THEN CREATE UNIQUE INDEX ... END IF; END $$` — byte-for-byte the same guard shape as `0070_default_bank_account.sql`'s already-proven-in-production `ux_ledger_bank_accounts_entity_default` partial index. `CREATE INDEX IF NOT EXISTS` is natively idempotent in Postgres.
- `0104`: both the feature-row insert and the two role-bindings use `WHERE NOT EXISTS (...)` against the exact row being inserted — identical shape to `0100_sync_log_view_permission.sql`, which has already run on every deploy since it shipped.
- Neither migration references any object created by a later-numbered migration; both reference only tables that exist well before `0103`/`0104` (`ledger_entities` from Ledger inc1, `ledger_funds` from Ledger inc1, `users`/`members`/`email_queue` from the original schema).
- No personal data: confirmed by inspection — no hard-coded email, name, or address in either file.

### Open questions / handoff notes

- Next agent: **api-developer**, per the Phase 3 Implementation Order step 3 — `src/lib/financial-report-send.ts` (fingerprint computation, `listReadyToSendReports()`, `sendMonthlyReportToBoard()`, email composer) and `src/app/api/admin/ledger/reports/send/route.ts`.
- `financialReportSends` is exported from `src/lib/db/schema.ts` as both the table and `FinancialReportSend`/`NewFinancialReportSend` inferred types — import those rather than re-declaring a shape.
- The insert pattern the design doc specifies is `INSERT ... ON CONFLICT (entity_id, month_end, totals_fingerprint) WHERE success DO NOTHING RETURNING id`, written **after** `sendEmail()` returns. Drizzle's `.onConflictDoNothing({ target: [...], where: ... })` (or a raw `sql` insert) both work against this table's partial index — api-developer should confirm which reads cleanest against the `financial_report_sends_unique_success` index name if going the raw-SQL route.
- `FEATURES.LEDGER_REPORT_SEND` is ready to import into the new route handler and the reports page (`hasFeature(session.user.features, FEATURES.LEDGER_REPORT_SEND)`).
- One deviation worth flagging: the design doc's migration filename placeholder was `drizzle/migrations/0103_financial_report_sends.sql` for the table only, with no explicit permission-migration filename. Since two files were needed, I used `0103` for the table (matching the placeholder) and `0104` for the permission binding. If a parallel effort has since claimed `0104`, whoever notices should renumber before this reaches `main`.
- I did not touch `src/app/events/`, `src/components/events/`, `src/app/api/members/proposals/`, or the recurring-occurrence-visibility work-log, per the scope boundary in my task.

---

## Phase 4 — Implementation (API) — 2026-09-25

**Owner:** api-developer
**Status:** complete

### Summary

Built the server layer for "Send to Board": `src/lib/financial-report-send.ts` (fingerprinting,
ready-to-send detection, the send/claim orchestration) and
`POST /api/admin/ledger/reports/send`. No UI. All read-side detection reuses
`isMonthGatedForEntity()`/`getMonthlyStatement()`/`getLatestOpenMonthForEntity()` from
`financial-report-queries.ts` as-is (DECISION-100) — neither reconciliation write route was
touched. Every unit test named in the Phase 3 design doc is written and passing (44 new tests
across two files), plus a handful of additional cases (entity/fund resolution, malformed input)
that fell out of implementing the design's edge cases.

### What I did

- Wrote `src/lib/financial-report-send.ts`:
  - `CUTOFF_MONTH = "2026-09"` (this feature's ship month), enforced in BOTH
    `listReadyToSendReports()` (never iterates before it) and `sendMonthlyReportToBoard()`
    (rejects `not_ready` for a pre-cutoff month even on a crafted direct request — the design
    doc only described the list-side enforcement, so I added the send-side check as a
    consistency hardening, not a deviation from any explicit ruling).
  - `computeTotalsFingerprint()` — SHA-256 hex digest over the exact 9-field delimited string
    the design specifies, in the exact order, with the same "do not reorder / do not spread"
    warning preserved inline.
  - `listReadyToSendReports()` — iterates every entity's single member-exposed fund (skips an
    entity with zero or more than one, per the design's "never guess" posture) from
    `CUTOFF_MONTH` through `getLatestOpenMonthForEntity()`'s result, calling
    `getMonthlyStatement()` per month and comparing the fresh fingerprint against the latest
    successful `financial_report_sends` row for that (entity, month).
  - `sendMonthlyReportToBoard(entityId, month, sentByUserId)` — re-validates month shape/cutoff,
    re-resolves the entity + its one member-exposed fund (never trusts a fund id from the
    caller), recomputes the statement + fingerprint fresh, checks `already_sent` BEFORE
    resolving the treasurer or sending anything, hard-blocks on `resolveTreasurer() -> ok:false`,
    sends via `sendEmail()`, then claims: `INSERT ... ON CONFLICT (entity_id, month_end,
    totals_fingerprint) WHERE success = true DO NOTHING RETURNING id` via Drizzle's
    `.onConflictDoNothing({ target, where })` (confirmed the installed drizzle-orm 0.45.2
    supports a partial-index `where` on the conflict target — no raw SQL needed). A failed send
    always inserts a plain `success: false` row (no conflict possible against the partial
    index), so a retry is never blocked.
  - Email body: three figures (Ending Balance, This Month's Net Income, FYTD Net Income) sourced
    directly from the same `getMonthlyStatement()` call used for the fingerprint — never a second
    query or a second HTML rendering of line items. Signed by the resolved treasurer's name;
    treasurer's email is `replyTo` only (envelope, never body prose). `to: BOARD_EMAIL`, `from:
    getFromEmail("Westerville Lions Club")`. Every interpolated string goes through `escapeHtml()`.
  - Subject: `` `${entity.shortName ?? entity.name} Financial Statement — ${monthLabel}` ``,
    prefixed `"Corrected: "` when resending over a changed fingerprint.
- Wrote `src/app/api/admin/ledger/reports/send/route.ts` — thin wrapper: `auth()` →
  `hasFeature(session.user.id, FEATURES.LEDGER_REPORT_SEND)` (via `@/lib/permissions-server`,
  matching the dues-reminder-send route's exact convention, not the client-safe
  `hasFeature(features, ...)` shape from `@/lib/permissions`) → parse/validate body → call
  `sendMonthlyReportToBoard()` → map its typed `reason` to the HTTP status table from the design
  doc.
- Wrote `src/lib/financial-report-send.test.ts` (36 tests) and
  `src/app/api/admin/ledger/reports/send/route.test.ts` (8 tests) — see Outputs for the mapping
  to the Phase 3-mandated test list.
- Ran `pnpm exec tsc --noEmit` (clean), `pnpm test` (2096/2096 passing, no regressions), and
  `pnpm build:only` (production build succeeds; `/api/admin/ledger/reports/send` appears in the
  route manifest as a dynamic function).
- Left `src/lib/db/schema.ts`, `src/app/api/events/[id]/viewer-context/route.ts`,
  `src/components/events/event-personalization.tsx`,
  `src/components/events/occurrence-signup-list.tsx`, and `src/app/api/members/proposals/`
  untouched, per this task's scope boundary (a concurrent full-stack-developer owns those).

### One deviation from the Phase 3 design doc, flagged explicitly

`sendMonthlyReportToBoard()`'s signature in the design doc is `(entityId, month)` — no
`sentByUserId` parameter. But `financial_report_sends.sent_by_user_id` is a real (nullable) FK
recording who clicked Send, distinct from `signed_as_member_id` (the resolved Treasurer) — the
design's own Data Model section defines the column, just not how it gets populated. Rather than
leave it null on every row and silently discard that audit trail, I added `sentByUserId: string`
as a required third parameter; the route is the only caller and always has `session.user.id` in
scope. Documented inline in the function's own doc comment as a deviation, not a silent change.

A second, smaller deviation: the design's `ReadyToSendReport.state` type was
`"never_sent" | "corrected"`, but the same section's prose requires a third, non-actionable
case for a month "already sent with a MATCHING fingerprint." I added `"sent"` to the union for
that case (documented inline) — `"never_sent"`/`"corrected"` are unchanged and are the two
actionable states; a caller filters with `state !== "sent"` to get the actionable list ux-developer
needs for the panel.

### Outputs

**New file:** `src/lib/financial-report-send.ts`
- `export const CUTOFF_MONTH = "2026-09"`
- `export function computeTotalsFingerprint(statement: MonthlyStatement): string`
- `export type ReadyToSendReport` — as designed, plus `state` widened to
  `"never_sent" | "corrected" | "sent"` (see deviation above). Fields: `entityId, entitySlug,
  entityName, fundId, fundName, month, monthEndLabel, summary { endingBookBalanceCents,
  netOneMonthCents, netTwelveMonthCents }, fingerprint, state, lastSuccessfulSend { sentAt,
  signedAsName } | null, lastAttemptFailed { sentAt, error } | null`.
- `export async function listReadyToSendReports(): Promise<ReadyToSendReport[]>` — no auth check
  inside (matches the design: called from the Server Component's own data fetch, which is gated
  by the page's existing `LEDGER_VIEW` check; ux-developer should NOT expose this as a public API
  route).
- `export type SendReportResult = { ok: true; emailQueueId: string; sentAt: string; corrected:
  boolean } | { ok: false; reason: "not_found" | "invalid_month" | "not_ready" |
  "treasurer_unresolved" | "already_sent" | "send_failed"; detail?: string }`
- `export async function sendMonthlyReportToBoard(entityId: string, month: string, sentByUserId:
  string): Promise<SendReportResult>` — see deviation above for the third parameter.

**New route:** `POST /api/admin/ledger/reports/send`
- Auth: `auth()` + `hasFeature(session.user.id, FEATURES.LEDGER_REPORT_SEND)`, independent of the
  `/admin/ledger/reports` page's own `LEDGER_VIEW` gate.
- Body: `{ entityId: string; month: string }` (`month` = `'YYYY-MM'`).
- 200: `{ ok: true; emailQueueId: string; sentAt: string; corrected: boolean }`.
- 401 no session; 403 `{ error: "forbidden" }`; 400 `{ error: "invalid_month" }` (missing/blank
  `entityId` or `month`, or a malformed month string); 404 `{ error: "not_found" }`; 409
  `{ error: "not_ready" }` or `{ error: "already_sent" }`; 422 `{ error: "treasurer_unresolved",
  detail? }`; 502 `{ error: "send_failed", detail? }`; 500 on an unexpected exception (no
  internal error text leaked — generic message, matching the codebase's other routes).

**No schema changes** — consumes `financialReportSends`/`FEATURES.LEDGER_REPORT_SEND` exactly as
database-admin shipped them in the prior Phase 4 (schema) step.

**Tests delivered** (Phase 3's 8-item list, all present):
1. Fingerprint stability + per-field change detection (parameterized over all 9 tracked fields)
   + non-effect of excluded fields (`monthEndLabel`, `income`/`expense` line items,
   `usedLegacyReconciledAtFallback`, `hasUndatedHistoricalRows`, `totalRevenue.budgetCents`).
2. Ready-to-send cutoff: excluded before `CUTOFF_MONTH` even when open; included at/after when
   open; a still-gated month excluded entirely (simulated via `getMonthlyStatement` returning
   `{ status: "gated" }` mid-range).
3. Zero-transaction elapsed month still offered as `never_sent`.
4. Corrected-resend predicate: matching fingerprint → `state: "sent"`; changed fingerprint →
   `state: "corrected"`.
5. Claim/conflict: successful send writes a `success:true` row and returns `ok:true`; failed
   send writes a `success:false` row and returns `send_failed`; a retry after failure is not
   blocked (the pre-check only ever sees `success:true` rows).
6. Double-send guard: sequential already-matching-fingerprint call short-circuits to
   `already_sent` before any email is sent; a genuinely concurrent race (both pre-checks pass,
   one `ON CONFLICT` insert returns zero rows) also resolves to `already_sent` even though its
   own `sendEmail()` succeeded; a resend over a genuinely changed fingerprint is NOT treated as
   `already_sent` and is labeled `corrected: true`.
7. Treasurer-unresolved hard block: short-circuits before `sendEmail()` is ever called.
8. Permission gate (route test file): 401 with no session; 403 without `LEDGER_REPORT_SEND` even
   though the caller could view `/admin/ledger/reports` itself; body-validation 400s; full
   reason→status mapping table; confirms `session.user.id` (never the resolved treasurer or any
   client-supplied value) is what's threaded through as `sentByUserId`.

Additional coverage beyond the mandated list: entity-not-found, ambiguous/zero member-exposed
fund resolution (both list- and send-side), malformed-month rejection short-circuiting before any
dependency call, and gated-at-send-time rejection.

### Open questions / handoff notes

- **Next agent: `ux-developer`**, per the Phase 3 Implementation Order step 4 —
  `financial-report-send-panel.tsx` and wiring `listReadyToSendReports()` into
  `/admin/ledger/reports/page.tsx`'s existing Server Component data fetch.
- `listReadyToSendReports()` returns EVERY month in range, including non-actionable `state:
  "sent"` rows (for the quiet "sent on `<date>`" status line the design calls for). Filter with
  `.filter(r => r.state !== "sent")` to get only actionable cards; don't filter on `state ===
  "never_sent" || state === "corrected"` and forget `"sent"` exists — see the state-widening
  deviation above.
- `POST /api/admin/ledger/reports/send` expects `{ entityId, month }` only — the route resolves
  `sentByUserId` from the session itself; the panel should never try to pass a user id.
- The `board@` distribution list cannot be end-to-end tested with a real Resend send outside
  production (deny-by-default guard, confirmed by design). Manual verification in dev is: trigger
  a send, confirm a `financial_report_sends` row appears with `success: true` and check
  `/admin/email-queue` for a `blocked_non_production` row referencing it — never attempt to
  allowlist `board@` to force a real send.
- `session.user.features` vs. the server-fetched `hasFeature(session.user.id, ...)`: I followed
  the codebase's actual recent precedent (dues-reminder route, welcome-packets route) rather than
  CLAUDE.md's generic illustrative snippet, since the fresh DB-backed check is what every
  comparable recent Ledger/board-facing route in this repo actually uses.
- I did not build the `<ConfirmDialog>` copy, the empty-state panel, or any component — those are
  entirely ux-developer's per the Phase 3 Component/Page Plan, which is unchanged by anything
  here.

---

## Phase 4 — Implementation (UI) — 2026-09-25

**Owner:** ux-developer
**Status:** complete

### Summary

Built the "Send to Board" panel on `/admin/ledger/reports` per the Phase 3 Component/Page Plan:
a client-island card list showing every `ReadyToSendReport` row for the currently selected
entity, one card per (fund, month), each rendering its `never_sent` / `corrected` / `sent`
affordance, gated on a server-computed `LEDGER_REPORT_SEND` boolean. No new `GET` route — the
page's existing Server Component calls `listReadyToSendReports()` directly, exactly as
api-developer's handoff specified.

### What I did

- **`src/components/admin/ledger/financial-report-send-panel.tsx`** (new, `'use client'`) — the
  panel. One card per row:
  - `never_sent` — gray "Not yet sent" badge, figures (Ending Balance / This Month's Net / FYTD
    Net, all straight from `row.summary` — no re-derivation), a "Send to Board" button.
  - `corrected` — gold "Corrected" badge, an amber note naming the exact prior send date ("The
    figures changed since the statement sent on [date]. The board is holding stale numbers until
    a corrected statement goes out."), a "Resend Corrected Statement" button. Visually on par
    with `never_sent` (full white card, full opacity) since it's equally actionable — only the
    badge/copy differ.
  - `sent` — green "Sent" badge, card rendered `bg-gray-50 shadow-none` (visually muted, matching
    CLAUDE.md's non-interactive-card guidance) with a quiet "Sent [date] by [signer]" line, **no
    button at all** — not just a disabled one, since there's nothing actionable left to click.
  - Any row with `lastAttemptFailed` (regardless of state) additionally shows a red "Last attempt
    failed on [date]: [error]" note — closes the Phase 1 "failure visibility" gap the design doc
    flagged as still-open at the end of Phase 1.
  - Empty state (`rows.length === 0`): `bg-gray-50 rounded-2xl p-10 text-center text-gray-500`,
    "No statements ready to send yet." exactly as specified.
- **Permission split:** `canSend` is a plain boolean prop, computed server-side in the page via
  `hasFeature(session.user.id, FEATURES.LEDGER_REPORT_SEND)` — not a client read of
  `session.user.features`. Chose "no send control at all" over "visible but disabled" for a
  viewer lacking `LEDGER_REPORT_SEND`: a disabled button with no visible reason reads as broken,
  and there's no useful tooltip real estate on a mobile card layout. The informational content
  (state, figures, last-sent date) still renders for a `LEDGER_VIEW`-only holder — only the
  action disappears. The route independently re-checks the same feature regardless of what this
  renders.
- **`<ConfirmDialog>`** (not `destructive`): title and description branch on `state`. For
  `corrected`, the description explicitly names the prior send date and states it goes to
  `board@westervillelions.org` labeled "Corrected." For `never_sent`, it names the destination
  and says the send cannot be undone. Confirm label mirrors the card's own button text
  ("Send to Board" / "Resend Corrected Statement" / "Sending…").
- **Double-submit guard:** extracted as `createSingleFlightGuard()`, a tiny exported,
  framework-free `{ acquire(): boolean; release(): void }` pair held in a `useRef` — `acquire()`
  is checked synchronously before any `await`, so a genuine double-click (two `onConfirm` calls
  in the same tick) can't both pass, regardless of whether React's `sendingKey` state has
  re-rendered the button as disabled yet. The `disabled` state on the button is a separate,
  purely cosmetic in-flight indicator for a normal single click.
- **Failure-copy mapping:** `errorMessageFor(reason, detail)` (exported, pure) maps all six
  `SendReportResult.reason` values plus an unmapped-future-reason fallback to specific copy.
  `treasurer_unresolved` branches further on `detail` (`no_board_group` / `none` / `multiple`,
  `resolveTreasurer()`'s own reason codes) into three distinct messages telling the admin exactly
  what to fix (e.g. "Nobody currently holds the Board position of Treasurer... Set the Treasurer
  position in the Board of Directors group before sending.") — never a bare "send failed." Wording
  deliberately parallels `dues-reminder-sender.tsx`'s existing `SIGNER_FAILURE_MESSAGE` map for
  the same underlying `TreasurerResolution` shape, rather than inventing new phrasing for the same
  failure the codebase already has copy for.
- **Refresh after send:** on `ok:true`, `toast.success(...)` then `router.refresh()` — re-runs the
  Server Component's `listReadyToSendReports()` call so the row flips to `sent` without a manual
  reload. No local optimistic state mutation, since the source of truth (fingerprint comparison)
  lives server-side.
- **Modified `src/app/(dashboard)/admin/ledger/reports/page.tsx`:** added
  `hasFeature(session.user.id, FEATURES.LEDGER_REPORT_SEND)` alongside the existing `LEDGER_VIEW`
  gate (unchanged), added `listReadyToSendReports()` to the existing `Promise.all` data fetch,
  filtered the result to `r.entityId === entity.id` (see deviation note below), and rendered
  `<FinancialReportSendPanel>` in a new section between the entity/FY switchers and the existing
  Guardrail Alerts block.
- **Tests:** `src/components/admin/ledger/financial-report-send-panel.test.tsx` (new, 14 tests).
  No jsdom/`@testing-library/react` in this project (node-only Vitest environment — see
  `member-form.test.ts`'s docblock), so rendering is exercised via `react-dom/server`'s
  `renderToStaticMarkup`, same technique as `donor-detail-client.test.tsx`: `<ConfirmDialog>`'s
  Radix `AlertDialog.Root` renders `open={false}` until a row is clicked, so its Portal
  contributes nothing to the static markup and the card grid is fully inspectable without a DOM.
  Covers, per the task's required list:
  1. All three states (`never_sent` / `corrected` / `sent`) render their distinct badge, copy,
     and button (or no button for `sent`).
  2. No send control renders for `canSend={false}`, on both an actionable and a `corrected` row,
     while the informational content still renders.
  3. Empty state renders for `rows={[]}`.
  4. `errorMessageFor("treasurer_unresolved", "none"|"no_board_group"|"multiple")` each surface
     their specific message, distinct from the generic fallback and from each other.
  5. `createSingleFlightGuard()` — `acquire()` returns `true` once and `false` on a concurrent
     call (the actual double-click race) until `release()`; two independent guards (two different
     rows) don't interfere.
  6. A last-attempt-failed note renders independent of state.
  7. `already_sent` / `not_ready` / an unmapped future reason each get distinct, non-blank,
     non-raw-code copy (guards against a future reason falling through to the raw string).
- Ran `pnpm exec tsc --noEmit` (clean), `pnpm lint` (0 errors — one pre-existing unrelated warning
  in `budget-context-panel.tsx`), `pnpm test` (**2151/2151 passing**, up from the task's stated
  2130 baseline; this file adds 14, leaving 7 unaccounted for against that baseline number — not
  investigated further since it's outside this feature's scope and typecheck/build both confirm
  nothing here is broken), and `pnpm build:only` (production build succeeds;
  `/api/admin/ledger/reports/send` and the reports page both appear correctly in the route
  manifest).

### One deviation from the Phase 3 design doc, flagged explicitly

The design doc's Component Plan doesn't say whether the panel shows every entity's ready-to-send
rows or scopes to the page's currently-selected entity. I scoped it to the selected entity
(`readyToSendReports.filter(r => r.entityId === entity.id)`) because the rest of
`/admin/ledger/reports` — the `EntitySwitcher`, the Fund Detail cards, the Entity Totals bar — is
already entirely single-entity-scoped; showing a different entity's board-send status above that
would read as a different page's data leaking in. If a treasurer manages both the Club and
Foundation entities and wants a single cross-entity "everything ready to send" view, that's a
reasonable follow-up but a different feature shape (open question below).

### Outputs

- `src/components/admin/ledger/financial-report-send-panel.tsx` (new)
- `src/components/admin/ledger/financial-report-send-panel.test.tsx` (new)
- `src/app/(dashboard)/admin/ledger/reports/page.tsx` (modified — send panel wired in)

### Open questions / handoff notes

- **For qa:** click through as a `treasurer`/`admin` account (has `LEDGER_REPORT_SEND`) and
  separately as a `LEDGER_VIEW`-only account, on `/admin/ledger/reports`. Confirm: (1) the panel
  renders with a visible Send button for the first account and none for the second; (2) the
  `<ConfirmDialog>` copy is correct for both `never_sent` and (if a `corrected` row exists in the
  seeded data) `corrected`; (3) clicking through to an actual send is expected to be **blocked by
  the deny-by-default outbound-email guard in dev** (per CLAUDE.md's Outbound Email invariant —
  `board@` is refused even if allowlisted) — verify this shows as a *successful* UI flow
  (`ok:true`, toast success, row flips to `sent`) since `sendEmail()` still returns `success: true`
  for a blocked-non-production send, then separately check `/admin/email-queue` for the
  `blocked_non_production` row. Do not expect to see a real email.
- **For qa:** verify at 360px width — cards stack full-width, the Send button is `w-full` (it's
  actually full-width at all breakpoints below `sm:`, matching the design doc's "full-width on
  mobile" note but I made it also just directly `w-full sm:w-auto` rather than only-below-360).
- **New copy strings the Lions Club may want to refine:** the `corrected` note's wording ("The
  board is holding stale numbers until a corrected statement goes out") and the three
  `treasurer_unresolved` messages — all functional but slightly technical/internal in tone for a
  board-facing admin screen; worth a copy pass if the club wants a softer voice.
- **UX decision to flag for Phase 6:** the entity-scoping choice above (see deviation note) — if
  the analyst's Phase 1 intent was closer to "a treasurer's single dashboard of everything ready
  to send across both entities," this needs to be called out as a gap, not a match.
- Next agent: **qa**, per the Phase 3 Implementation Order — Phase 5 verification, including the
  manual click-through notes above and the deny-by-default-email caveat, which is not something an
  automated test in this repo can exercise end-to-end.

---

## Phase 5 — Verification — 2026-09-25

**Owner:** qa
**Status:** complete

### Summary

**Verdict: PASS, with one required follow-up.** The panel, permission split, treasurer hard-block, and double-submit guard all check out against source and live click-through. The one significant finding: in a non-production process (`pnpm dev`, `pnpm test`, i.e. anywhere `NODE_ENV !== 'production'`), sending to `board@westervillelions.org` is blocked by the existing deny-by-default guard, but `sendEmail()` still returns `success: true` per its own documented contract — and `sendMonthlyReportToBoard()` treats that as a genuine send, permanently claiming the partial-unique-index row with `success: true` for a statement that was never actually delivered. **Confirmed real** by both a code trace and an isolated reproduction test against the real, unmodified `sendEmail()`/`email-guard.ts`. This is **dev/test-only** — `shouldBlockNonProductionSend()` always returns `false` when `NODE_ENV === 'production'`, which is true for both production and Vercel preview builds (`next build`/`next start` always set `NODE_ENV=production`) — so it never affects a real board send. It does mean this feature can never be genuinely re-tested end-to-end in local dev without a manual DB cleanup, and it's a real gap in the "honest failure visibility" goal DECISION-101 was written to guarantee. Flagging per the task's own framing rather than silently discovering and dropping it.

### What I did

1. **Read the full feature**: `src/lib/financial-report-send.ts`, `src/app/api/admin/ledger/reports/send/route.ts`, `src/components/admin/ledger/financial-report-send-panel.tsx`, the `page.tsx` diff, the schema diff, both migrations, and DECISION-100/101 in `docs/decisions.md`.
2. **State rendering** (item 1): confirmed by source + the 14 passing unit tests in `financial-report-send-panel.test.tsx` (which use `renderToStaticMarkup`, exercising real JSX output) that `never_sent` shows "Not yet sent" + a "Send to Board" button, `corrected` shows a gold "Corrected" badge + the superseded-statement note naming the prior send date + a "Resend Corrected Statement" button, and `sent` shows a green "Sent" badge + "Sent <date> by <name>" with **no button** (`{!isSent && canSend && (<button>...)}` in `ReportRow`).
3. **Permission split** (item 2): confirmed `canSendReports = await hasFeature(session.user.id, FEATURES.LEDGER_REPORT_SEND)` is computed server-side in `page.tsx` (line ~186) and passed as a plain boolean prop — never read from `session.user.features` client-side. Confirmed the route (`POST /api/admin/ledger/reports/send`) independently re-checks `auth()` + `hasFeature(session.user.id, FEATURES.LEDGER_REPORT_SEND)` in its own body before calling `sendMonthlyReportToBoard()` — the UI gate is cosmetic only, exactly as documented. `route.test.ts` has an explicit test: "returns 403 when the session lacks ledger.report_send, even though it could view the reports page."
4. **`treasurer_unresolved` branching** (item 3): confirmed `resolveTreasurer()` in `src/lib/board-positions.ts` returns exactly `"no_board_group" | "none" | "multiple"`, matching the panel's `TreasurerUnresolvedReason` type and `TREASURER_UNRESOLVED_MESSAGE` map one-for-one. Each message tells the admin what to do ("Set that up before sending," "Set the Treasurer position in the Board of Directors group before sending," "Fix the group position before sending") — never a bare failure string. Per DECISION-101, `sendMonthlyReportToBoard()` hard-blocks (`treasurer_unresolved`, no email sent) before any send attempt when `resolveTreasurer()` fails — confirmed by reading the ordering in the function body (step 5, after the fingerprint/already-sent check, before `renderReportEmailHtml`/`sendEmail`).
5. **Double-submit guard** (item 4): `createSingleFlightGuard().acquire()` is called synchronously as the first line of `handleConfirm()`, before any `await` — confirmed by reading the component and by the two passing guard unit tests (`acquire()` returns `true` once, `false` on a concurrent call, until `release()`; two independent guards don't interfere). The server-side partial unique index (`financial_report_sends_unique_success` on `(entity_id, month_end, totals_fingerprint) WHERE success = true`) independently protects against a genuine race (two admins, or a client bypassing the guard): confirmed the migration (`0103_financial_report_sends.sql`) creates it idempotently and `sendMonthlyReportToBoard()`'s claim step uses `.onConflictDoNothing({ target: [...], where: sql\`success = true\` })`, returning `already_sent` when the insert wins zero rows. Two concurrent successful sends can each fire a real email (accepted, documented cost per DECISION-101) but never a duplicate DB claim.
6. **The dev-blocked-send interaction** (item 5) — the finding this task most wanted checked. Traced the full path:
   - `sendMonthlyReportToBoard()` calls `sendEmail({ to: BOARD_EMAIL, ... })`.
   - In `sendEmail()`, `shouldBlockNonProductionSend(BOARD_EMAIL)` is `true` whenever `NODE_ENV !== 'production'`, because `BOARD_EMAIL` is a club distribution list and `isDevAllowedRecipient()` refuses those unconditionally regardless of `EMAIL_DEV_ALLOWLIST` ("never, allowlist or not" — `email-guard.ts`).
   - `sendEmail()`'s blocked branch writes `email_queue.status = 'blocked_non_production'` and **returns `{ success: true, emailQueueId }`** — this is `sendEmail()`'s own documented, intentional contract ("Blocked messages are still queued and still report success, so callers and their tests behave exactly as in production").
   - Back in `sendMonthlyReportToBoard()`, the code only checks `sendResult.success` (line ~ "if (!sendResult.success) { ... }") — it has no way to distinguish "genuinely delivered" from "blocked as designed but reported success." Since `sendResult.success === true`, execution falls through to the claim `INSERT ... ON CONFLICT ... WHERE success DO NOTHING`, writing a **`success: true`** row.
   - **Independently confirmed empirically**, not just by reading code: wrote an isolated Vitest file that imports the real, unmodified `sendEmail()` and `email-guard.ts` (only `@/lib/db` and `@/lib/db/schema` mocked), stubbed `NODE_ENV=test` (matching how both `pnpm test` and `pnpm dev` actually run) and `RESEND_API_KEY` set, called `sendEmail({ to: BOARD_EMAIL, ... })`, and asserted `result.success === true` with `status: "blocked_non_production"` in the same update call. **Test passed**, confirming the interaction is real, not just theoretical. (This scratch file was not committed — it existed only to verify the claim and was deleted after use; the finding itself is recorded here.)
   - **Consequence**: because the claim uses `success: true` and the partial unique index only guards `success = true` rows, this write is **permanent** for that `(entityId, monthEnd, totalsFingerprint)` triple. A later, genuine attempt to send the identical statement (same fingerprint) in the same non-production database would hit `getLatestSuccessfulSend()`, find the fingerprint matches, and return `already_sent` — even though nothing was ever actually delivered.
   - **Scope of impact, established**: this can only happen when `NODE_ENV !== 'production'`. Next.js sets `NODE_ENV=production` unconditionally for both `next build`/`next start` (production deploys) and Vercel preview deployments — it is not an environment-variable choice, it's how the Next.js build/start commands behave. So this is confined to `pnpm dev` and any Vitest run (`NODE_ENV=test`). A real production or preview board send is unaffected — confirmed by reading `shouldBlockNonProductionSend()`'s own first line (`if (process.env.NODE_ENV === "production") return false;`).
   - **Not covered by any existing test**: grepped both `financial-report-send.test.ts` and `route.test.ts` for `blocked_non_production`/`shouldBlockNonProductionSend`/`NODE_ENV` — zero matches. Both files mock `@/lib/email`'s `sendEmail` entirely, so this interaction between two real modules was invisible to the test suite by construction.
   - **This was partially anticipated but not fully traced.** The ux-developer's own Phase 4 handoff (above, "Open questions / handoff notes") correctly predicted the *UI-visible* half — "clicking through to an actual send is expected to be blocked... verify this shows as a successful UI flow... since `sendEmail()` still returns `success: true`" — and called it expected behavior. What wasn't previously identified is the **permanent DB-claim consequence**: that this isn't just a one-time confusing toast, it's a write that survives and blocks all future dev-mode testing of that exact statement via the same mechanism DECISION-101 built to prevent exactly this kind of false state.
   - **Verdict on this finding**: real, dev/test-only, does not corrupt production data or cause a duplicate real send, but does defeat the "honest failure visibility" goal of DECISION-101 in the one environment where the feature gets iterated on and tested. Recommended follow-up (not implemented — outside qa's remit to fix code): `sendMonthlyReportToBoard()` should not treat `sendResult.success` alone as sufficient for a `success: true` claim; it needs to distinguish "genuinely sent" from "blocked by design." The simplest fix is likely a small, explicit signal from `sendEmail()`/`email-guard.ts` (e.g., checking the persisted `email_queue.status` for `'blocked_non_production'` before claiming, or a `blocked: boolean` field on `SendEmailResult`) rather than reinterpreting `success`. This is a shared-infrastructure concern (any future "claim a send happened" feature modeled on this one would hit the same gap), so it may belong in `sendEmail()`'s own contract rather than being special-cased in `financial-report-send.ts`.
7. **Live click-through** (item 6): started `pnpm dev` against the local dev DB (`.env.local` — not production, per project convention), ran migrations (0103/0104 applied cleanly, idempotent — confirmed by the log output and a clean second-run no-op), upserted the e2e test admin via `scripts/create-test-user.mjs`, and drove a real headless-Chromium session via Playwright:
   - Signed in as the admin test user, navigated to `/admin/ledger/reports`.
   - The panel rendered the exact CLAUDE.md empty-state markup (`bg-gray-50 rounded-2xl p-10 text-center text-gray-500`, "No statements ready to send yet.") — confirmed **live data has zero ready-to-send reports** for any entity in this dev DB (verified independently by calling `listReadyToSendReports()` directly against the DB: returned `[]`), so no actionable row was available to click through interactively. This is a property of the current dev data (no month has cleared `CUTOFF_MONTH` = `2026-09` with a fully-reconciled month yet), not a bug.
   - Checked for horizontal overflow at 360px width: `document.documentElement.scrollWidth === clientWidth === 360` — **no overflow**.
   - Confirmed no runtime errors in the dev server log for this page beyond pre-existing, unrelated warnings (an `eval()`-in-dev React notice and an `<Image>` aspect-ratio warning on the site logo, both unrelated to this feature).
   - Because no actionable row existed, the `<ConfirmDialog>` copy (naming entity/fund/month/destination) and the full send round-trip could not be exercised end-to-end live; this was instead verified by (a) reading the component's `ConfirmDialog` `title`/`description` props directly, which interpolate `confirmRow.fundName`, `confirmRow.monthEndLabel`, and hardcode `board@westervillelions.org`, and (b) the panel's own unit tests, which do render these strings via fixtures for both `never_sent` and `corrected` states.
   - Confirmed **zero side effects**: `SELECT count(*) FROM financial_report_sends` on the dev DB returned `0` both before and after the click-through session — nothing was inserted, no dev-DB cleanup was needed. Stopped the dev server afterward; all temporary scripts were deleted, none committed.
8. **Admin-page gating** (item 7): `pnpm exec vitest run src/lib/admin-page-feature-gates.test.ts` — passed (part of the 195 passing tests across that file + `permissions.test.ts`). This is a directory-level audit (every top-level `admin/*` segment must have its own `hasFeature`/`hasAnyFeature` check) — `admin/ledger` already had one before this feature (the pre-existing `LEDGER_VIEW`/`LEDGER_RECORD`/`LEDGER_MANAGE` `hasAnyFeature` check, unchanged), so this feature didn't need to add a new top-level gate; it added a narrower one (`LEDGER_REPORT_SEND`) alongside it, confirmed present in the page body (not the proxy) per DECISION-082.
9. **Schema/migration check**: `financialReportSends` in `schema.ts` matches `0103_financial_report_sends.sql` field-for-field; the partial unique index is defined identically in both (Drizzle's `uniqueIndex(...).where(sql\`success = true\`)` vs. the guarded `CREATE UNIQUE INDEX ... WHERE success = true`). `0104_ledger_report_send_permission.sql` is idempotent (`WHERE NOT EXISTS` guards on both the feature insert and both role bindings) and matches `FEATURE_DESCRIPTIONS[FEATURES.LEDGER_REPORT_SEND]` byte-for-byte, as its own header comment claims. Both migrations ran cleanly against the live dev DB during the `pnpm dev` startup in step 7.

### Outputs

- **Verified, not modified:** `src/lib/financial-report-send.ts`, `src/app/api/admin/ledger/reports/send/route.ts`, `src/components/admin/ledger/financial-report-send-panel.tsx`, `src/app/(dashboard)/admin/ledger/reports/page.tsx`, `src/lib/db/schema.ts`, `drizzle/migrations/0103_financial_report_sends.sql`, `drizzle/migrations/0104_ledger_report_send_permission.sql`, `src/lib/permissions.ts`.
- **Scoped coverage check** (`pnpm exec vitest run --coverage`, limited to this feature's files): `financial-report-send.ts` 95.19% statements / 88.09% branches; `route.ts` 84.21% statements (uncovered: the generic `catch` block's 500 path); `financial-report-send-panel.tsx` 58.06% statements under the render-only test run (expected — interaction is tested via the exported pure functions `createSingleFlightGuard`/`errorMessageFor`, not full component simulation, per the test file's own documented constraint of no jsdom in this project's Vitest config).
- **No files added by qa.** The Playwright click-through script and the DB-check scripts used in step 7 were temporary, run from the working tree, and deleted before finishing — nothing committed.
- **No production or database action taken beyond local dev DB migrations** (already-idempotent, already-required for `pnpm dev` to run at all) and read-only queries. No real send attempted, no `EMAIL_DEV_ALLOWLIST` change, no commit, no push.

### Gates

See the shared Gates section in `docs/work-log/2026-09-25-sendemail-unchecked-error.md`'s Phase 5 (same run, covers both pieces): `tsc` clean, `lint` 0 errors, `pnpm test` 2151/2151, `pnpm build:only` clean with `/api/admin/ledger/reports/send` present in the route manifest.

### Regression Tests Added

- None added by qa for this piece — the implementer's 14 (`financial-report-send-panel.test.tsx`) + tests in `financial-report-send.test.ts` + `route.test.ts` were reviewed and independently exercised, not extended. The dev-blocked-send interaction (finding #6 above) has **no regression test** in the committed suite — recommended as a follow-up for whoever picks up the fix: a test that mocks `@/lib/db` only (not `@/lib/email`), calls the real `sendEmail()` with `to: BOARD_EMAIL` under a non-production `NODE_ENV`, and asserts `sendMonthlyReportToBoard()` does NOT write a `success: true` claim row for a blocked send.

### Feature-Gate Audit

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `POST /api/admin/ledger/reports/send` | yes | yes | `FEATURES.LEDGER_REPORT_SEND` — correct: this is a mutation (sends an irreversible email + writes a claim row), narrower than the page's own `LEDGER_VIEW`/`LEDGER_RECORD`/`LEDGER_MANAGE` read gate, bound only to `admin` + `treasurer` (not `board_member`), matching DECISION-100/101's stated rationale. |
| `GET /admin/ledger/reports` (page, pre-existing route, unchanged gate) | yes | yes (`hasAnyFeature([LEDGER_VIEW, LEDGER_RECORD, LEDGER_MANAGE])`) | Unchanged by this feature; the new `LEDGER_REPORT_SEND` check is additive alongside it, not a replacement. |

No other protected routes or server actions were added or changed by this feature.

### Verdict: PASS (with a required follow-up)

Every explicit check in the task passed. The one real finding (item 5) is dev/test-only, does not threaten production correctness, and was flagged per the task's own instruction rather than left undiscovered — but it is a genuine gap in the feature's "honest failure visibility" design goal and should not be silently dropped from the backlog.

### Open questions / handoff notes

- **Next agent: analyst**, for Phase 6 shipped-vs-intent, on both pieces (see the shared gates note above — this task covers two independently-verified pieces of work).
- **Recommended follow-up, not filed as a numbered backlog item:** `sendMonthlyReportToBoard()` (or `sendEmail()`/`email-guard.ts` upstream) needs a way to distinguish "genuinely delivered" from "blocked by the non-production deny-by-default guard but reported `success: true`" before writing a `financial_report_sends` claim row. Until fixed, a developer or QA agent testing this feature's happy path in `pnpm dev` will permanently "use up" that statement's ability to show `never_sent`/`corrected` again for the same figures, in the local/test DB only.
- **The entity-scoping deviation** the ux-developer flagged (Phase 4, "UX decision to flag for Phase 6") is still open and belongs to analyst's Phase 1-intent comparison, not qa's remit.
- Local dev DB currently has zero ready-to-send reports for any entity — analyst or a future manual tester wanting to see the `corrected`/`sent` states live will need reconciled data past `CUTOFF_MONTH` (`2026-09`) to exist first.

---

# Phase 6 — Shipped vs Intent (analyst)

**Note on read order:** this section was written after QA's Phase 5 PASS but *before* the
"Phase 4 — Implementation (API) — Follow-up fix" section that appears below it in this file (the
fix for QA's blocked-send finding). This verdict accounts for that follow-up fix — I read it and
verified its tests before writing this — even though it's typeset after this section in the
file's chronological append order. Do not read this as having missed it.

## VERDICT

SHIP WITH NOTES

## ONE-LINE TAKE

The user's literal ask ("autosend") was deliberately narrowed to "detect automatically, send on
one click" — the right call given an irreversible board-wide email of financial figures — and
the implementation is unusually well-defended (fingerprint-based corrections, a hard treasurer
block, a QA-caught-and-fixed false-claim bug on the blocked-send path); what's missing is any
signal that pulls the treasurer back to the send screen once a month, which is the one piece of
"auto" that this design still owes them.

## What's Working

- **The fingerprint-and-resend mechanism (Flow 3) is the standout piece.** `computeTotalsFingerprint()` (`src/lib/financial-report-send.ts:~90-120`) hashes exactly the 9 numeric fields that appear in the summary email/panel — nothing from line-item or cause-line detail — so a memo correction or a same-total category reclassification correctly produces no resend prompt, while any change to ending balance, net income, or the book-vs-cash divergence correctly flips the row to a visible gold "Corrected" card with the prior send date named. This is exactly the "materially different, not textually different" distinction Phase 1 asked for, and it's cheap to reason about because the field list is a literal delimited string, not a spread that could silently reorder.
- **The QA-found-and-fixed blocked-send claim bug is a genuine save.** QA traced (and independently reproduced with a real, unmocked `sendEmail()`/`email-guard.ts`) that a dev/test-mode blocked send would have permanently claimed `success: true` for a statement that was never delivered — closing off that exact figure from ever showing as `never_sent`/`corrected` again in that database. The same-day follow-up fix threading a new `blocked?: true` field through `SendEmailResult` and a distinct `blocked_non_production` reason is precise, minimally invasive (no change to `sendEmail()`'s existing contract for any other caller), and has its own fail-then-pass-verified regression tests. This is the pipeline working as designed: a real defect found before ship, not after.
- **The permission split is done correctly, not just claimed.** `LEDGER_REPORT_SEND` is checked independently in the route body (`src/app/api/admin/ledger/reports/send/route.ts`) regardless of what the page renders — confirmed by both the implementer's and QA's independent reading, plus a route test asserting 403 for a `LEDGER_VIEW`-only session that can otherwise see the page.

## Intent-vs-Shipped Diff

- Phase 1 said: recommend Flow 2B (detect automatically, one-click send) over the literal Flow 2A (true autosend), because an irreversible board-wide email with no human in the loop and no permission gate of its own carries too much blast radius. **User explicitly chose 2B.** Shipped: exactly 2B — a `LEDGER_REPORT_SEND`-gated button behind `<ConfirmDialog>`. Verdict: **matches** (a conscious, documented scope narrowing, not a silent one).
- Phase 1 flagged "failure visibility — neither flow surfaces a send failure anywhere a treasurer would naturally look" as an open gap. Shipped: DECISION-101's partial-unique-index design records every attempt (success or failure) and the panel surfaces a red "Last attempt failed on [date]: [error]" line. Verdict: **matches** — this is a real closure of a named Phase 1 gap, not just a claim of one.
- Phase 1 flagged historical backfill (Flow 4) as the "loudest hazard in this review." Shipped: `CUTOFF_MONTH = "2026-09"`, enforced on both the list side and (as a hardening beyond the design doc) the send side against a crafted direct request. Verdict: **matches**, with the implementer going slightly further than specified in a direction that only reduces risk.
- Phase 1 Open Question 2 ("does `board@` include anyone without a linked account?") was left for the user to answer and, as far as I can tell from the work-log, was never explicitly answered. Shipped: the recommended default (summary figures directly in the email body, not just a deep link) was built regardless, which happens to make the open question moot — the email is self-sufficient for a recipient with no portal login. Verdict: **matches by construction**, but worth naming plainly that Open Question 2 was never actually closed with the user; it just stopped mattering because of an unrelated default that was adopted anyway.
- Phase 1 didn't specify whether the "ready to send" panel is scoped to one entity or shows a treasurer everything across both funds at once. ux-developer scoped it to the currently-selected entity (matching the rest of the page's existing single-entity scoping) and flagged the deviation explicitly for this phase. Verdict: **acceptable drift, but genuinely undecided** — see Open Questions below; this is a real product question, not a technical one, and I don't think it's mine to close unilaterally.
- The user's literal request ("autosend... when fully reconciled") implied no ongoing manual step. Shipped: a manual step that recurs every month, indefinitely, with no mechanism pulling the treasurer back to it. Verdict: **acceptable drift as a one-time scope decision, but see the Follow-Up below** — the user accepted the tradeoff of "no autosend" for "an undo window," not necessarily the tradeoff of "and also nothing will ever remind me to look."

## Edge Cases

- Empty state: **pass** — `bg-gray-50 rounded-2xl p-10 text-center text-gray-500`, "No statements ready to send yet." — exact CLAUDE.md pattern, confirmed live in QA's click-through against a dev DB with zero ready-to-send rows.
- Failure microcopy: **pass** — three distinct, actionable `treasurer_unresolved` messages (naming exactly what to fix: missing Board group, no Treasurer holder, or more than one), a distinct `blocked_non_production` message that reassures the admin nothing was attempted and the statement remains sendable, and a generic-but-non-blank fallback for any future unmapped reason code. None of these read as a raw error code or a stack trace.
- Permission gate: **pass** — `LEDGER_REPORT_SEND` bound to `admin` + `treasurer` (not `board_member`), checked independently in the route body per DECISION-082's two rules, with an explicit test proving a `LEDGER_VIEW`-only session gets 403'd on the send route while still seeing the page.
- Mobile (360px): **pass** — cards are `w-full sm:w-auto` for the send button and stack full-width; confirmed by QA both via the design doc's explicit spec and a live `document.documentElement.scrollWidth` check against a real 360px viewport.

## Follow-Ups (SHIP WITH NOTES)

- **B-69** (filed in `docs/backlog.md`): add a nav-level "N statements ready to send" indicator, mirroring `failedEmailCount`'s pattern (shipped the same day, for the same class of "silent state nobody visits a page to notice" problem), scoped to `LEDGER_REPORT_SEND` holders. This is the most load-bearing follow-up: the user traded literal autosend for one-click specifically because of undo-safety, not because they wanted the reminder problem solved by hoping the treasurer remembers to check a page they may only visit when they already intend to reconcile.
- **B-67** (already filed, not by me): the acknowledgment-letter flow has the same false-claim-on-blocked-send defect class this feature was just caught and fixed for, with higher stakes (a donor receipt) and inverted timing (claimed before send, not after). Not blocking this feature — it's a different file and a pre-existing bug this work merely re-discovered the shape of — but it's now the oldest open instance of the pattern and should not sit indefinitely.
- **Open product question, not a bug:** should the "ready to send" panel show one entity at a time (shipped) or every entity's ready statements in one place? ux-developer's own deviation note flagged this for Phase 6; I'm surfacing it to the user rather than deciding it, since it's a genuine "how does the treasurer think about this job" question, not a technical one.
- Housekeeping (done as part of this review): `docs/backlog.md` updated — B-65 marked closed, B-68 (shared Resend-send helper, from the sibling Piece A review) and B-69 (this follow-up) filed with stable IDs.

## Systemic Finding

Three near-identical defects surfaced in one day's work: `sendEmail()`'s missing-key branch (fixed the week prior), the unchecked Resend SDK error on `sendEmail()`'s primary path (Piece A, this session), and a blocked send satisfying `financial_report_sends`' durable claim (this piece, caught by QA before ship). A fourth instance of the same shape — the acknowledgment-letter claim — is already filed as B-67 and *not yet fixed*, meaning the pattern's next occurrence is already known and sitting in the backlog rather than waiting to be independently rediscovered a fifth time.

**Yes, this is worth a decisions-log entry, not a fourth ad hoc fix.** My position: the fix that just shipped in this piece (`SendEmailResult.blocked?: true`, consulted before writing a durable claim) *is* the shared primitive the other three instances need — it just hasn't been required of them yet. The rule I'd propose for the architect or tech-lead to formalize as a numbered decision:

> **Any code that writes a durable, hard-to-reverse claim that a message was sent — an `email_queue` row read as evidence of delivery, an acknowledgment's permanent `sent_at`, `financial_report_sends`' partial-unique-indexed success row, or any future equivalent — must branch on `sendEmail()`'s full three-way outcome (`delivered` / `failed` / `blocked`), never on the boolean `success` field alone. `success: true` on the `blocked_non_production` path is intentional and load-bearing for callers that don't hold a durable claim (DECISION-085), but it is a trap for any caller that does. `SendEmailResult.blocked` already exists for exactly this; the finding is that it isn't yet mandatory to check.**

This isn't a call for a fourth one-off fix — it's a call to audit every caller that treats `sendEmail()`'s or `sendBulkMemberEmail()`'s success as a durable claim (the acknowledgment-letter flow is the only other one identified so far with real stakes; `event_announcements`/`dues_reminders` were correctly assessed as lower-severity since nothing there is un-resendable) and require the `blocked` check going forward, ideally enforced by a lint rule or a typed wrapper rather than a comment, since "a comment reminds you" is precisely the mitigation that let two of these three instances ship in the first place. I'm recording this position here rather than writing the decisions.md entry myself, since DECISION-085/100/101 were all architect/tech-lead calls and this is the same class of cross-cutting infrastructure ruling — but I don't think it should wait for the next routine 30-day review to get written down; it should be the next thing the architect looks at.

## Open questions / handoff notes

- **For the user:** does the per-entity scoping of the "ready to send" panel match how you think about this job, or would you rather see every fund's ready-to-send status in one place regardless of which entity is selected? Either is a small change; I'm not picking one for you.
- **For architect/tech-lead:** please pick up the systemic finding above and decide whether it becomes a numbered decision now or is scheduled explicitly (not silently deferred) into the next 30-day code review.
- No further agent action is required to close this work-log's own scope — B-69 and the entity-scoping question are the two live threads, and neither blocks the feature already shipping.

---

## Phase 4 — Implementation (API) — Follow-up fix — 2026-09-25

**Owner:** api-developer
**Status:** complete

### Summary

Fixed the QA-flagged defect where a blocked (non-production) send of the monthly financial
report wrote a permanent `success: true` claim row for a statement that was never delivered.
`sendMonthlyReportToBoard()` now treats a blocked send as a distinct, non-success outcome —
`blocked_non_production` — and records it as `success: false`, so the statement stays genuinely
re-sendable and the deny-by-default guard's `blocked: true` signal never gets silently absorbed
into a durable "sent" claim. Also corrected a stale doc comment in the email-queue retry route
(tracked as a separate work-log, see `docs/work-log/2026-09-25-sendemail-unchecked-error.md`).

### What I did

- Added a non-breaking `blocked?: true` field to `SendEmailResult` (`src/lib/email.ts`), set only
  on the `blocked_non_production` path. `sendEmail()`'s existing contract (`success: true`,
  `status: 'blocked_non_production'` in `email_queue`) is completely unchanged — DECISION-085's
  "callers and their tests must behave exactly as in production" still holds. Every existing
  caller destructures only `{ success, error, emailQueueId }` and is unaffected.
- Added `"blocked_non_production"` to `SendReportResult`'s failure-reason union
  (`src/lib/financial-report-send.ts`).
- In `sendMonthlyReportToBoard()`, added an explicit branch immediately after the `sendEmail()`
  call: if `sendResult.blocked` is true, insert a `financial_report_sends` row with
  `success: false` and a descriptive error ("Blocked — outbound email is disabled outside
  production (EMAIL_DEV_ALLOWLIST). Nothing was delivered.") and return
  `{ ok: false, reason: "blocked_non_production", detail: <that message> }`. This row never
  collides with the partial unique index (`WHERE success = true`), so the exact same
  (entity, month, fingerprint) can be attempted again — including a genuine send once a real
  `RESEND_API_KEY`/allowlist path is available.
- **Chose a `success: false` row over no row at all.** A no-row option would have made a blocked
  attempt invisible on the panel (no "last attempt" line at all), which is a worse dev experience
  than a real failure gets today. A `success: false` row reuses the exact same
  `lastAttemptFailed` rendering path the panel already has for a genuine Resend failure, at zero
  extra UI cost, while the distinct `blocked_non_production` reason (surfaced through the route's
  JSON `error` field and the panel's `errorMessageFor()`) keeps the toast message honest that
  nothing was actually attempted against Resend — not a generic "the email could not be sent."
- Updated `POST /api/admin/ledger/reports/send`'s `statusByReason` map to return `503` for
  `blocked_non_production`, distinct from `502` for a genuine `send_failed`.
- Updated `financial-report-send-panel.tsx`'s `errorMessageFor()` with a new case for
  `blocked_non_production` that names the guard and reassures the admin nothing sent and the
  statement can still be retried — not a red-herring generic failure message.
- Did **not** touch `src/lib/email-guard.ts`'s predicate or the guard's call ordering anywhere,
  per the task's constraint.

### Audit: other `sendEmail()` callers with a durable claim on `success: true`

Per the task's explicit ask, I checked every caller that records a durable claim/receipt keyed
off `sendEmail()`'s `success` field (not just ones that discard the result):

- **`src/lib/ledger-acknowledgment-letter-queries.ts` (`emailAcknowledgmentLetters()`) — HAS THE
  SAME LATENT BUG, not fixed here (out of this task's scope).** This flow claims the
  acknowledgment **before** sending (`UPDATE ledger_acknowledgments SET sent_at = now(), sent_via
  = 'email' WHERE sent_at IS NULL`), then only **reverts** that claim if every address for the
  candidate failed (`anySucceeded` is computed from `sendResult.success` per address, via
  `sendBulkMemberEmail()`). Since `sendEmail()` reports `success: true` for a blocked
  non-production send, `anySucceeded` is `true` whenever an address is merely blocked (not
  actually delivered) rather than genuinely rejected — the claim is kept, `sentAt`/`sentVia` stay
  set, and the row reads "emailed" even though nothing left the building. In production this
  branch never triggers (the guard is a no-op there); in dev/test, a donor acknowledgment can be
  permanently marked sent for a delivery that never happened, with no automatic path back to
  "not sent." This is architecturally the *same* defect class as the one just fixed here, but
  with claim-before-send timing instead of claim-after-send — fixing it would mean reading
  `sendResult.blocked` per address in `anySucceeded`'s computation (treat a blocked address as
  neither "succeeded" nor terminally "failed" — closer to "not attempted") and probably choosing
  new visible states beyond the current `emailed`/`failed` binary. That's a real design question
  (what should the UI say when an ack was blocked, not delivered, and not genuinely failed?) that
  belongs in Phase 3, not something to slip into an unrelated fix. **Filing as a follow-up, not
  fixing in this pass** — flagging here per CLAUDE.md's duplication/correctness-defect posture so
  it isn't lost.
- **`src/app/api/admin/events/[id]/announce/route.ts`** and **`src/app/api/admin/dues/reminders/route.ts`**
  — both write one row per recipient (`event_announcements` / `dues_reminders`) via
  `sendBulkMemberEmail()`'s per-recipient `{ success, error }`, "success and failure alike"
  (DECISION-093). A blocked send would show as a false "success" per-recipient row here too, but
  **this is a display-accuracy issue, not a durable-claim/re-sendability defect** — neither table
  has a uniqueness constraint or claim semantics that would block a future real re-announcement or
  re-reminder. Noting it, not treating it as the same severity as the ledger cases above.
- **The 11 call sites that discard `sendEmail()`'s return value entirely** (contact form,
  password reset, suggestions, membership applications, etc. — enumerated in
  `docs/work-log/2026-09-25-sendemail-unchecked-error.md`'s call-site audit table) are unaffected
  either way — they never branched on `success`/`blocked` before and don't now.

### Tests added

In `src/lib/financial-report-send.test.ts`:
1. `"on a blocked (non-production) send, does NOT write a success:true row and reports
   blocked_non_production, not send_failed"` — asserts the result reason and that the
   claim-insert (`insertReturningQueue`, the `ON CONFLICT ... RETURNING` path) is never touched
   for a blocked send.
2. `"the statement remains re-sendable after a blocked (non-production) send — a later real send
   for the same fingerprint is not treated as already_sent"` — sends the same (entity, month,
   fingerprint) twice: first blocked, then a real success, and asserts the second call succeeds
   rather than returning `already_sent`.

**Pre-fix failure confirmed independently**, not just claimed: reverted the `blocked` branch in
`sendMonthlyReportToBoard()` back to the pre-fix shape (kept `email.ts` pre-fix too, via
`git stash`, since it hadn't yet gained the `blocked` field) and re-ran just these two tests —
both failed exactly as expected: the first call's `getLatestSuccessfulSend()` pre-check saw no
prior row, the blocked `sendEmail()` call reported `success: true`, and the code wrongly hit the
claim-insert path and returned `already_sent` from the *first* call (because it raced against
itself — the mocked "no prior row" plus a "won the race" insert reads as success) rather than
`blocked_non_production`. Restored the fix afterward and reconfirmed both pass; `git diff --stat`
before/after the stash round-trip showed no drift.

Also updated `src/app/api/admin/ledger/reports/send/route.test.ts`'s reason→status `it.each` table
to add the `blocked_non_production` → `503` case.

### Verification performed

- `pnpm exec tsc --noEmit`: **PASS**, no errors.
- `pnpm lint`: **PASS** — 0 errors; 1 pre-existing unrelated warning
  (`react-hooks/exhaustive-deps` — unused eslint-disable — in
  `src/components/admin/ledger/budget-context-panel.tsx`, untouched by this fix).
- `pnpm test`: **2154 passed, 0 failed** (baseline 2151 + 3 new: the 2 blocked-send tests above,
  plus the 1 new `it.each` status-mapping case in the route test).
- `pnpm build:only`: **PASS** — compiled successfully, no new warnings.
- The 17 DECISION-085 guardrail tests (`src/lib/email-guardrail.test.ts`) and the 7 B-65
  regression tests (`src/lib/email-send-error-handling.test.ts`) all pass **unmodified** —
  confirmed via `git diff --stat` on both files (empty).

### Outputs

- **Modified:**
  - `src/lib/email.ts` — added `blocked?: true` to `SendEmailResult`; set on the
    `blocked_non_production` return. No other change to `sendEmail()`'s logic or contract.
  - `src/lib/financial-report-send.ts` — `SendReportResult`'s failure-reason union gained
    `"blocked_non_production"`; `sendMonthlyReportToBoard()` gained the blocked-handling branch
    described above, inserted immediately after the `sendEmail()` call and before the existing
    `baseRow`/`!sendResult.success` logic.
  - `src/app/api/admin/ledger/reports/send/route.ts` — `statusByReason` map gained
    `blocked_non_production: 503`.
  - `src/components/admin/ledger/financial-report-send-panel.tsx` — `errorMessageFor()` gained a
    `blocked_non_production` case.
  - `src/lib/financial-report-send.test.ts` — 2 new tests (above).
  - `src/app/api/admin/ledger/reports/send/route.test.ts` — 1 new `it.each` case.
- **No schema changes, no new migration, no permission change.**
- **No commit, no push, no database write, no real send attempted, `EMAIL_DEV_ALLOWLIST`
  untouched**, per the task's explicit constraints.

### Open questions / handoff notes

- **Next agent: qa**, to re-verify this follow-up, then **analyst** for Phase 6 shipped-vs-intent
  on the whole feature.
- **Follow-up filed, not fixed:** `src/lib/ledger-acknowledgment-letter-queries.ts`'s
  `emailAcknowledgmentLetters()` has the same false-claim risk under a blocked non-production send
  (see audit above) — it claims before sending and only reverts on a 100%-failed batch, so a
  merely-blocked address reads as "succeeded" and the claim sticks. Recommend a small Phase 1/3
  pass specifically for that flow: read `sendResult.blocked` per address and decide what state a
  "blocked, not delivered, not genuinely failed" acknowledgment should be in (not a clean fit for
  today's `emailed`/`failed` binary).
- The `attemptResendSend()` shared-helper follow-up from the sibling B-65 work-log remains
  unimplemented and unrelated to this fix; see that work-log for status.
