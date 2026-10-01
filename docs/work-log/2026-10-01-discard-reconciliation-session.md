# Discard an Open Reconciliation Session — Work Log

> **Slug:** `2026-10-01-discard-reconciliation-session`
> **Surface:** (dashboard) admin — The Ledger, `/admin/ledger/reconciliation/[sessionId]`
> **Permission(s):** existing `FEATURES.LEDGER_RECORD` covers this (plus existing `FEATURES.LEDGER_MANAGE` only for a session that was previously reopened); no new key
> **Estimated complexity:** small
> **Pipeline mode:** Accelerated — Phase 2 **skipped** (proposed by analyst, confirmed by orchestrator 2026-10-01; rationale in Phase 1 "Phase 2 recommendation" and restated in Phase 3).

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-10-01 |
| 2 — Architectural review | architect | **Skipped** (orchestrator-confirmed). Analyst rationale: no new directory, dependency, primitive, `FEATURES` key, schema change or email; the single risk (hard delete vs. the `reconciled_session_id ON DELETE SET NULL` provenance pointer, DECISION-036) is one specified invariant pinned in Phase 3 and tested in Phase 5. Re-open if a soft status, any schema change, direct closed-session discard, or a new audit FK/table is needed. | Skipped | 2026-10-01 |
| 3 — Technical design | tech-lead | Complete | Design complete; implementer named (full-stack-developer) | 2026-10-01 |
| 4 — Implementation | **full-stack-developer** (one route method, one query function, one small client component, one copy edit) | Complete | Gates green; live dev-DB check passed | 2026-10-01 |
| 5 — Verification | qa | Complete | **PASS** | 2026-10-01 |
| 6 — Shipped vs intent | analyst | Complete | **SHIP WITH NOTES** (2 follow-ups proposed as B-next; B-86 already filed) | 2026-10-01 |

---

## Request (from the treasurer, 2026-10-01)

> "Is there a way to cancel reconciliation?" → "queue up the discard session feature"

Background: the treasurer opened a reconciliation session against the wrong bank account. There was no way to cancel it in the product, and the overlap rule (409 on any overlapping period for the same account, any status) meant the wrong session also blocked creating the right one if the periods collided. It was removed by hand in SQL. This was already anticipated as **B-06** ("No repair path for a mis-uploaded reconciliation-session CSV", `docs/backlog.md`), which was deferred "pending real-world pain". The pain has now arrived.

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> Give the treasurer a "Discard session" button on the open-session page that hard-deletes the session, its imported statement lines and its match links in one atomic, status-pinned transaction, writes one audit row, and touches no ledger transaction.

## Facts verified in code (so Phase 3 does not have to re-derive them)

- **What an open session has written.** `ledger_reconciliation_sessions` row; `ledger_bank_lines` (FK `ON DELETE CASCADE` to the session); `ledger_reconciliation_matches` (FK `ON DELETE CASCADE` to the session, bank line and transaction). The `match` route documents "Does NOT touch `reconciled`/`reconciledAt`" and `close` is the only writer of `reconciled`/`reconciledAt`/`reconciledSessionId` (DECISION-036). So an open session has written nothing onto `ledger_transactions`. Confirmed by reading `close/route.ts`, `match/route.ts`, and `reopen/route.ts` (reopen clears `reconciledSessionId`, `reconciled`, `reconciledAt` and leaves match links in place, so a *reopened* session is also clean).
- **The one thing an open session can leave behind that is real:** `create-from-bank-line` inserts a genuine `status = 'posted'` row into `ledger_transactions` (on **the session's own bank account**, date and amount copied from the bank line) plus a match link, in one transaction. Nothing on that transaction records that it came from a bank line, so discard cannot enumerate or count them (same class of gap as B-85 for reimbursement-created transactions). These rows must survive. They do, automatically: the only FK between them and the session is the match row, and deleting a match deletes nothing on the transaction side.
- **The FK that makes the "open only" pin load-bearing.** `ledger_transactions.reconciled_session_id` references the session with `ON DELETE SET NULL` (schema.ts ~line 976; migration `0059` line 104). If a **closed** session were ever hard-deleted, every transaction it cleared would keep `reconciled = true` / `reconciled_at` but silently lose its provenance pointer, so a later reopen could no longer find and revert them. Nothing would error. That is precisely why the DELETE must pin `status = 'open'` inside the statement, not in a check-then-delete.
- **Overlap rule.** `getSessionPeriodsForAccount()` filters only on `bankAccountId`, no status filter, and the schema also has `UNIQUE (bank_account_id, statement_period_start, statement_period_end)`. A hard DELETE frees both automatically. A soft `'discarded'` status would need the overlap query and the unique constraint to learn about it, which is a schema change for no user benefit.
- **Precedent for exactly this action at single-match scale:** `DELETE .../sessions/[sessionId]/match/[matchId]` ("Unmatch") is `LEDGER_RECORD`-gated, open-only, deletes only the match row, and answers 409 "This session is closed — reopen it before changing matches". Discard is the bulk version of it, so copy its gate and its 409 phrasing.
- **Precedent for `LEDGER_RECORD` being allowed to destroy ledger rows:** the permission is described as "Record, edit, and delete ledger transactions", and `DELETE /api/admin/ledger/transactions/[id]` hard-deletes posted transactions under it. Discarding a draft reconciliation session is strictly less destructive than that.
- **Audit table exists, but is shaped for categories/transactions.** `ledger_audit_log` (schema.ts ~line 817) has nullable `targetCategoryId` / `targetTransactionId` plus free-text `before` / `after` / `details`. The `ack_letter_template_updated` action already writes a row with **both targets null** (`ledger-acknowledgment-letter-queries.ts` ~line 269), so a session-discard row can follow that precedent with **no schema change** (a new `target_session_id` FK would be pointless: the session row is being deleted, so an `ON DELETE SET NULL` pointer would be null the moment it was written).
- **UI.** `reconciliation-reopen-button.tsx` is the pattern: a client component, `ConfirmDialog` with `destructive`, sonner toasts, `router.refresh()`, `min-h-[44px]`, `rounded-lg`. No `window.confirm` anywhere in the reconciliation components. `reconciliation-session-list.tsx` is a **server component** table whose rows do not carry bank-line or match counts. The detail page already has `canRecord`, `canManage`, `isOpen`, the bank lines and the matched transactions in hand.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Admin (treasurer, `ledger.record`) | **Discard** an open reconciliation session (hard delete: statement lines + match links go with it) | Rare, on demand; a mistake-recovery action |
| Admin | Confirm the discard in a dialog that says what is and is not removed | Every time |
| Admin | Land back on the session list and **start a new session** for the right account/period | Immediately after (existing flow, unchanged) |
| Admin (`ledger.manage`) | Discard a session that was previously closed-then-reopened | Very rare |

No anonymous-visitor, `/access-pending`, or member-portal surface is involved. This is `/admin/ledger/**` only.

## Flows

**Flow 1 — Discard an open session (the treasurer's case):** `/admin/ledger/reconciliation` list → click the wrong session's chevron → `/admin/ledger/reconciliation/[sessionId]` → header shows `Open` badge and a **Discard session** button beside it → click → ConfirmDialog → **Discard session** → toast "Session discarded. N statement lines and M matches removed. Nothing in the ledger was changed." → redirect to `/admin/ledger/reconciliation` (the session is gone from the list) → "New session" for the right account.
- Failure (server error): toast "Could not discard the session. Try again." Dialog closes, user stays on the detail page, session is intact (single transaction, all-or-nothing).
- Failure (session was closed in another tab/by another user): server answers 409; toast shows "This session is closed — reopen it before discarding it." and the page refreshes so the closed state and Reopen button appear.
- Failure (session already gone, e.g. double-click or second tab): 404; treat as success-equivalent: toast "That session no longer exists." and redirect to the list. Button is disabled while the request is pending to prevent the double-click in the first place.

**Flow 2 — Discard a reopened session:** same as Flow 1, but the button is only shown to a `ledger.manage` holder, because the session was once closed and had been trusted as a reconciled period. A `ledger.record`-only user sees an open-and-reopened session with no Discard button; the server also rejects them with 403 "Only a ledger manager can discard a session that was reopened."
- Failure: as Flow 1.

**Flow 3 — Closed session (blocked by design):** `/admin/ledger/reconciliation/[sessionId]` for a closed session → no Discard button; the existing Reopen button (`ledger.manage`) is the only affordance. To remove a closed session: Reopen (confirm, un-reconciles its transactions) → then Discard. Two deliberate steps, the first behind the stricter gate.
- Failure (direct API call against a closed session): 409 "This session is closed — reopen it before discarding it." and nothing is deleted.

**Flow 4 — Wrong-account recovery end to end:** Flow 1, then "New session" with the correct account and period. The previous session's period no longer trips the overlap 409 because the row is truly gone.

## Decisions (analyst's recommended defaults; adopted, not blocking)

1. **Who:** `FEATURES.LEDGER_RECORD`, same as create, upload, match, unmatch and close. Plus `LEDGER_MANAGE` required **only** when `reopenedAt` is non-null (the session was once a closed, settled period). Rationale: reopen is deliberately `LEDGER_MANAGE`; letting a record-only user reopen-then-delete-around-it would be a back door, but the common case (a never-closed session) should not need the stricter key. Simpler alternative if tech-lead prefers: `LEDGER_RECORD` for all open sessions; acceptable, but then the audit row's `reopened: true` flag is the only trace of the extra weight.
2. **Which sessions:** `status = 'open'` only. Closed sessions are **never directly discardable**; they go Reopen → Discard. Closed means the books were stated reconciled against it and DECISION-036's provenance pointer is live. Direct deletion is where the `ON DELETE SET NULL` trap above lives.
3. **Matches present or created-from-bank-line transactions present:** **allowed, not blocked.** Discard removes the session, its bank lines and its match links; it writes nothing to `ledger_transactions`. The original B-06 sketch said "blocked once any match exists". Rejected: the treasurer's actual situation (wrong account, found after upload, possibly after some matching) is exactly when matches exist, and forcing a line-by-line unmatch first recreates the pain this feature removes. A match is only a link. The one real consequence (transactions created from bank lines stay in the books, on the discarded session's bank account) is disclosed in the dialog, not blocked on, because it cannot be detected (see Facts).
4. **Hard DELETE, not a soft `'discarded'` status.** Matches what was just done by hand; the overlap check and the unique constraint then need no change; a soft status would add a third state to a two-state column, a schema comment, a filter on every reader (`getReconciliationSessions`, `getSessionPeriodsForAccount`, `getLaterClosedSessionForAccount`, the status tabs), and would leave imported statement lines (raw bank descriptions) sitting in the DB for no purpose. The audit row below is the record that the session existed.
5. **Audit:** yes, one `ledger_audit_log` row, written **in the same transaction** as the delete: `action = 'reconciliation_session_discarded'`, `actorUserId`, both target FKs null (per the `ack_letter_template_updated` precedent), `before` = JSON of `{ bankAccountId, statementPeriodStart, statementPeriodEnd, openingBalanceCents, closingBalanceCents, status, csvFilename, csvRowCount, bankLineCount, matchCount, reopened }`, `details` = a one-line human sentence ("Discarded open session for <account name> <period>: 42 statement lines, 17 matches removed"). **Counts only. Never copy bank-line descriptions** (raw Chase text) into the audit table. Wiping financial working papers with no trace of who did it and when is the exact thing the SQL cleanup this week did. There is no session-specific audit table and none is needed; no schema change. (Note: the `ledgerAuditLog` comment saying exactly one target is non-null "or, for the one pre-existing case, both null" will need a one-line update to name this second both-null action.)
6. **API shape:** `DELETE /api/admin/ledger/reconciliation/sessions/[sessionId]` in the existing `[sessionId]/route.ts` (currently GET only).
   - Gate: 401 unauthenticated; 403 without `LEDGER_RECORD`; 403 without `LEDGER_MANAGE` when `reopenedAt` is set.
   - Malformed `sessionId` (not a UUID) answers 404, not a 500 from Postgres `22P02`.
   - One `db.transaction`: count bank lines and matches for the audit/response → `DELETE FROM ledger_reconciliation_sessions WHERE id = $id AND status = 'open' RETURNING ...` → if zero rows, distinguish 404 (no such id) from 409 (exists but not open) with a follow-up lookup, **and roll back without writing audit** → insert audit row → commit. Cascades remove bank lines and matches.
   - Response 200: `{ sessionId, discarded: true, bankLineCount, matchCount }`. 404 "Session not found". 409 "This session is closed — reopen it before discarding it."
   - Must not write to `ledger_transactions` under any path. A test should assert this (see Edge Cases).
7. **Where the button lives:** **session detail page header only**, in the action cluster beside the `Open` badge, mirroring where `ReconciliationReopenButton` sits for closed sessions. Not on the list row: the row has no counts to put in the dialog, a destructive icon next to the "View" chevron on a table that scrolls sideways at 360px is a mis-tap hazard, and the treasurer's natural moment is "I opened this and it's wrong". Visual: secondary-destructive outline button (`border-2 border-red-300 text-red-700 hover:bg-red-50 rounded-lg px-4 py-2 text-sm font-semibold min-h-[44px]` with the standard focus ring), not `lions-red` (undefined).
8. **Dialog copy (`<ConfirmDialog destructive>`, never `window.confirm`):**
   - Title: **Discard this session?**
   - Description: "This permanently deletes the {periodLabel} session for {accountName}, including its {N} uploaded statement lines and {M} matches. Nothing in the ledger is changed: no transaction is edited, un-reconciled or deleted. Any transaction you created from a bank line during this session stays in your books. This can't be undone, but you can start a new session for the same period right away."
   - Confirm label: **Discard session**. (Use "Discard", the treasurer's word, throughout. Not "Delete", not "Cancel", which would read as "close this dialog".)
   - When N = 0 (no statement uploaded yet, the cheapest case), drop the counts clause: "...including nothing uploaded yet." Do not render "0 uploaded statement lines and 0 matches".
   - Counts come from the page render, so they may be slightly stale; the post-discard toast uses the server's authoritative counts.
9. **After success:** `router.push("/admin/ledger/reconciliation")` then toast "Session discarded. N statement lines and M matches removed." (Push, not refresh: the current page's record no longer exists and `notFound()` would otherwise flash.)

## Permissions

- **Permission(s):** existing `FEATURES.LEDGER_RECORD` covers this. `FEATURES.LEDGER_MANAGE` is additionally required only for a previously reopened session. **No new `FEATURES` key, no migration for role bindings.**
- **Default roles:** whatever roles are already bound to `ledger.record` (and `ledger.manage` for the reopened case). Nothing to bind.
- **Gate placement:** the route enforces (`auth()` + `hasFeature(userId, ...)`, the file's existing style). The detail page hides the button when `!canRecord` (or when `reopenedAt` and `!canManage`), but the route is the gate, not the button. The proxy derives admin rules from `ADMIN_NAVIGATION`; this adds no new admin page, so nothing changes there.

## Gaps the Request Didn't Address

- **Transactions created from a bank line survive on the discarded session's bank account.** In the treasurer's own scenario (wrong account) any "Create transaction from bank line" clicks produced posted rows on the **wrong** account. Discard leaves them in the books and unmatched. They are not auto-deleted because they are real posted rows and may be legitimate (a bank fee is a bank fee) and because they cannot be told apart from ordinary rows (no marker). Resolution: the dialog sentence above; the treasurer fixes any mis-accounted row via the existing transaction delete (a transaction's bank account is not editable after creation: "corrected by delete+recreate" per `transactions/[id]/route.ts`). Suggested follow-up (separate backlog item, not this PR): a created-from-bank-line marker so a future discard dialog can say "3 transactions you created will stay" and link them. Same family as B-85.
- **Race with `close`.** `close` does not pin `status='open'` on its final session UPDATE. Delete-then-close: if the session had matched transactions, close's `UPDATE ledger_transactions SET reconciled_session_id = <deleted id>` hits an FK violation and rolls back (a 500, no corruption). Close-then-delete: the delete's `status='open'` predicate matches zero rows and answers 409. Neither loses or corrupts data, so no change to `close` is requested; QA should exercise the 409 leg (it is the dangerous one if the pin is missing).
- **Concurrent matching.** Another user matching or uploading while a discard commits: they get a 404 on their next request. Acceptable; the existing routes already 404 on a missing session.
- **Reopened sessions lose the evidence that a period was ever reconciled.** Covered by the `LEDGER_MANAGE` rule + audit row `reopened: true`.
- **CSV already parsed-and-discarded.** The uploaded file is never stored (`csvFilename` is display-only), so after discard, getting the data back means re-uploading the same CSV into a new session. Mention in the dialog? Not needed; the new-session flow already requires the upload. No gap, noted for completeness.
- **Treasury User's Guide is silent.** `src/components/admin/ledger/guide/reconciliation-section.tsx` documents Reopen but has nothing on discard, and nothing on "I picked the wrong account". Phase 4 should add two sentences there (the guide is the treasurer's own handbook, and this was the treasurer's question). Flagged, not designed: that file was not read for edits and is outside this analyst's remit; **two other live pipelines have uncommitted changes under `guide/`** (`guardrails-section.tsx`, `settings-section.tsx`), so the implementer must not clobber them: `reconciliation-section.tsx` is a different file and currently clean.
- **Backlog hygiene.** B-06's text prescribes "blocked once any match exists". This feature deliberately does not. When shipped, mark B-06 resolved with a pointer here and note the changed rule. (Not edited now: `docs/backlog.md` has another pipeline's uncommitted changes.)
- **Mobile (360px).** Header action cluster is `flex flex-wrap`, so the button wraps rather than overflows; ConfirmDialog is already mobile-safe (reopen uses it). 44px tap height required.
- **OAuth vs password / access-pending / email queue / Google Group sync:** not applicable. Admin-only, no email, no group sync, identity-agnostic (`session.user.id` only).
- **Failure microcopy when the DB is down:** generic "Could not discard the session. Try again." toast, no stack trace; the route already returns `{ error: "Failed to ..." }` on 500, so follow that shape ("Failed to discard reconciliation session").
- **Empty state:** after discarding the last session the list shows its existing empty state ("No reconciliation sessions yet for this account — start one."). Nothing new needed. Brand check: the existing badge classes (`rounded-lg` pills) and the button class above comply.

## Adversarial Pass (Pass 5)

- **Redirect targets:** none. The post-success redirect is a hard-coded path, not a user-supplied parameter.
- **State-machine shortcuts:** hitting `DELETE` directly against a closed session or a session for another entity. Closed: blocked by the pinned `status='open'` predicate (the critical one). Another entity: the ledger has no per-entity permission scoping (`ledger.record` is global), so there is no cross-entity boundary to bypass; confirm if that ever changes.
- **Enumeration leaks:** 404 vs 409 reveals that a session id exists and is closed. Admin-only, authenticated, UUID ids: not a meaningful leak. Unauthenticated callers get 401 before any lookup.
- **Input boundaries:** the only input is the path `sessionId`. Non-UUID must be a 404, not a 500 (flagged in the API shape).
- **Self-targeting:** discarding one's own work is the point. No privilege is granted or removed.
- **Mass-delete:** the route deletes exactly one session per call; no bulk or "discard all" variant is in scope.

## Out of Scope (confirm with user)

- Editing a session's account or period instead of discarding it (the "wrong account" mistake could also be fixed by an Edit action; discard-and-recreate is what was asked for, and the CSV is already staged against the wrong lines anyway).
- A "Replace statement" / re-upload action (that is the other half of B-06; remains open, deferred).
- Direct discard of a **closed** session in one step.
- Bulk discard, or an undo / trash bin / restore.
- Auto-deleting transactions created from bank lines, or detecting them.
- A viewer UI for `ledger_audit_log`. (Today there is no UI that reads it; the row is for the books-of-record trail and for support queries. Confirm that is acceptable.)
- Making `close` pin `status='open'` (harmless today per the race analysis above).

## Open Questions

None blocking; each has an adopted default above. For the user to veto if they disagree:

1. Is it acceptable that the dialog **warns** about, but does not detect or delete, transactions created from bank lines in the discarded session? (Alternative: block discard if any such transaction exists. Rejected as undetectable without a new marker column.)
2. Is the two-key split (record for never-closed, manage for reopened) worth its small extra branch, or should every open session just be `ledger.record`?
3. Are you comfortable with an audit row that no screen reads yet?

## Phase 2 recommendation (analyst's view; the architect agent is not invoked unless you disagree)

**Skip Phase 2, with the skip noted here.** Nothing structural changes: no new directory (the handler goes in the existing `[sessionId]/route.ts`, the button in `src/components/admin/ledger/`, next to `reconciliation-reopen-button.tsx`), no new dependency, no new primitive, no new `FEATURES` key, no schema change, and no email (so the DECISION-102/103 durable-claim exception does not apply). It **is** a new hard-delete route over ledger data, and that is the one thing that gives pause, but the entire risk is a single, fully specified invariant (DECISION-036 provenance pointer + `ON DELETE SET NULL`), captured above as "open only, pinned atomically in the DELETE statement". That is a Phase 3 design obligation and a Phase 5 test, not an open architectural question. The shape is a direct generalisation of the existing single-match `DELETE`.

**Conditions that would bring the architect back in:** (a) tech-lead proposes a soft `'discarded'` status or any schema change; (b) tech-lead proposes allowing discard of **closed** sessions directly; (c) the audit write needs a new FK column or table instead of the both-null row. Any of those changes the invariant, so it goes to Phase 2.

**Phase 3 must name:** the atomic status pin (one `DELETE ... WHERE id AND status='open' RETURNING`, never read-then-delete), the transaction boundary (count → delete → audit, audit skipped on zero rows), the 404-vs-409 split, and the no-write-to-`ledger_transactions` guarantee.

**Phase 5 / unit tests the design should name** (implementer delivers these, per the pipeline gate):
1. Open session with bank lines + matches: 200, session/lines/matches gone, returned counts correct, one audit row with counts and no bank-line text.
2. **Closed session: 409, session, lines, matches and every cleared transaction's `reconciled`/`reconciledAt`/`reconciledSessionId` all unchanged.** (The test that the whole pin exists for.)
3. A transaction created via `create-from-bank-line` still exists after discard, unmatched, `reconciled = false`, same bank account.
4. No `ledger_transactions` write happens during a discard (spy/assert on the transaction's update/delete calls).
5. Gates: 401, 403 without `ledger.record`; reopened session + record-only user: 403; reopened + manage: 200.
6. Unknown id and non-UUID id: 404.
7. Creating a session for the same account/period right after discard succeeds (overlap 409 no longer fires).
8. Dialog component: renders counts, zero-count wording, uses `ConfirmDialog` with `destructive`, no `window.confirm`.

---

# Phase 2 — Architectural Review (architect)

_**Skipped** — proposed by the analyst (Phase 1, "Phase 2 recommendation") and confirmed by the orchestrator on 2026-10-01. Rationale and the conditions that would re-open it are in the status table and in Phase 3. Not a silent skip._

---

# Phase 3 — Technical Design (tech-lead)

## Technical Design: Discard an open reconciliation session

### Summary
Add `DELETE /api/admin/ledger/reconciliation/sessions/[sessionId]` and a "Discard session" button on the session detail page. The delete is one transaction in `src/lib/reconciliation-queries.ts` (`discardOpenSession()`): count bank lines and matches, run a single `DELETE ... WHERE id = $id AND status = 'open' [AND reopened_at IS NULL] RETURNING *`, and write one `ledger_audit_log` row. FK cascades remove the bank lines and match rows; nothing is written to `ledger_transactions`. No schema change, no migration, no new `FEATURES` key, no email. Every analyst default is adopted unchanged; the only deviations are two refinements below (the reopened-session gate is pinned inside the DELETE instead of a pre-read, and the 404/409/403 split comes from one discriminated result).

### Phase 2 skip (recorded here, not silent)
Phase 2 is **skipped** by orchestrator decision, on the analyst's rationale: no new directory (handler goes in the existing `[sessionId]/route.ts`, button beside `reconciliation-reopen-button.tsx`), no new dependency or primitive, no new `FEATURES` key, no schema change, no email (the DECISION-102/103 durable-claim exception does not apply: nothing here writes a "sent" claim). The one risk, hard-deleting ledger-adjacent rows, is a single fully specified invariant (DECISION-036 provenance pointer plus `ledger_transactions.reconciled_session_id ON DELETE SET NULL`) that Phase 3 pins and Phase 5 tests. **Re-open Phase 2 if the implementer finds any of these are needed:** a soft `'discarded'` status or any schema change; direct discard of a closed session; a new FK column or table for the audit write.

### Permissions
- No new key. `FEATURES.LEDGER_RECORD` for every open session. `FEATURES.LEDGER_MANAGE` additionally required only when the session's `reopened_at` is non-null (it was once a closed, trusted period).
- Default roles: whatever is already bound to those two keys. No role-binding migration.
- Gate order in the route: `auth()` (401) -> `hasFeature(LEDGER_RECORD)` (403) -> `hasFeature(LEDGER_MANAGE)` evaluated into a `canManage` boolean -> await `params` -> UUID check (404) -> `discardOpenSession()`. **Both feature checks run before any row is read.** The route is the gate; the hidden button is convenience only.
- The reopened-session rule is enforced inside the DELETE's WHERE (below), not by a pre-read, so there is no window between "check reopened_at" and "delete".

### API Contract
`DELETE /api/admin/ledger/reconciliation/sessions/[sessionId]` (added to the existing `[sessionId]/route.ts`, next to `GET`; update the file's header comment to document it). No request body.

| Status | Body | When |
|---|---|---|
| 200 | `{ sessionId, discarded: true, bankLineCount, matchCount }` | Deleted. Counts are authoritative (taken in the same transaction). |
| 401 | `{ error: "Unauthorized" }` | No session |
| 403 | `{ error: "Forbidden" }` | Lacks `ledger.record` |
| 403 | `{ error: "Only a ledger manager can discard a session that was reopened." }` | Session open, `reopened_at` set, caller lacks `ledger.manage` |
| 404 | `{ error: "Session not found" }` | Unknown id, or `sessionId` is not a UUID (no Postgres `22P02` 500) |
| 409 | `{ error: "This session is closed — reopen it before discarding it." }` | Session exists, `status <> 'open'` (same phrasing family as unmatch's 409) |
| 500 | `{ error: "Failed to discard reconciliation session" }` | Anything else; `console.error` as siblings do |

Route body (shape only):
```ts
const result = await discardOpenSession({ sessionId, actorUserId: authSession.user.id, canManage });
switch (result.outcome) { // exhaustive, `never`-checked
  case "discarded": return 200 {...};
  case "not_found": return 404; case "not_open": return 409; case "requires_manage": return 403;
}
```

### Query layer: `discardOpenSession()` in `src/lib/reconciliation-queries.ts`
```ts
export type DiscardSessionResult =
  | { outcome: "discarded"; sessionId: string; bankLineCount: number; matchCount: number }
  | { outcome: "not_found" }
  | { outcome: "not_open" }
  | { outcome: "requires_manage" };

export async function discardOpenSession(input: {
  sessionId: string; actorUserId: string; canManage: boolean;
}): Promise<DiscardSessionResult>
```
Everything inside one `db.transaction(async (tx) => { ... })` (same driver call the reopen route already uses):

1. **Count first.** `count(*)::int` of `ledger_bank_lines WHERE session_id = $id` and of `ledger_reconciliation_matches WHERE session_id = $id` (two cheap selects, `Promise.all` is fine inside a tx only if the driver allows it; sequential is acceptable).
2. **The pinned delete, one statement, never read-then-delete:**
   ```ts
   const conds = [eq(S.id, sessionId), eq(S.status, "open")];
   if (!canManage) conds.push(isNull(S.reopenedAt));
   const deleted = await tx.delete(S).where(and(...conds)).returning();
   ```
   The `status = 'open'` predicate is **the** invariant. Reason it is load-bearing: `ledger_transactions.reconciled_session_id` is `ON DELETE SET NULL` (schema.ts; migration 0059). Hard-deleting a *closed* session would leave every transaction it cleared with `reconciled = true` and a nulled provenance pointer, so a later reopen could never find or revert them, and nothing would error. A check-then-delete leaves a window for a concurrent `close` to flip the row in between; the predicate inside the DELETE closes it atomically. The `isNull(reopenedAt)` clause for non-managers gets the same atomicity for the two-key rule.
3. **Zero rows -> diagnose, write nothing, return.** One `select {status, reopenedAt} from sessions where id = $id limit 1`: no row -> `not_found`; `status !== 'open'` -> `not_open`; otherwise (open, reopened, caller not manager) -> `requires_manage`. No audit row, nothing to roll back (the only statement that ran was a zero-row delete).
4. **Audit row, same transaction**, only on a deleted row. Look up the bank account name (`ledger_bank_accounts.name` by `deleted.bankAccountId`; fall back to `"unknown account"` if somehow absent), then insert. Reuse the exact shape of `ack_letter_template_updated` in `src/lib/ledger-acknowledgment-letter-queries.ts` (`tx.insert(ledgerAuditLog).values({...})`, JSON-stringified text columns, both target FKs null):
   ```ts
   await tx.insert(ledgerAuditLog).values({
     actorUserId,
     action: "reconciliation_session_discarded",
     targetCategoryId: null,
     targetTransactionId: null,
     before: JSON.stringify({
       bankAccountId, statementPeriodStart, statementPeriodEnd, openingBalanceCents, closingBalanceCents,
       status: "open", csvFilename, csvRowCount, bankLineCount, matchCount,
       reopened: deleted.reopenedAt !== null,
     }),
     after: null,
     details: `Discarded open session for ${accountName} ${start} to ${end}: ${bankLineCount} statement lines, ${matchCount} matches removed`,
   });
   ```
   **Counts only. Never read or copy bank-line descriptions into the audit row.** The details sentence uses ISO dates on purpose: `formatPeriodLabel()` already exists twice (the detail page and the reopen route); a third copy would breach the duplication rule, and the audit trail should not depend on a display formatter anyway.
5. Return `{ outcome: "discarded", sessionId, bankLineCount, matchCount }`. If the audit insert throws, the whole transaction rolls back (session, lines, matches all restored) and the route answers 500; the discard is all-or-nothing, including its audit row.

Never written under any path: `ledger_transactions` (no update, no delete, no insert). The cascade removes only `ledger_bank_lines` and `ledger_reconciliation_matches`. Transactions created via `create-from-bank-line` survive, unmatched, `reconciled = false`, on the session's own bank account.

Also add `isUuid(value: string): boolean` to `src/lib/utils.ts` (the same regex that already lives, copy-pasted, in `src/lib/ledger-queries.ts` and `src/app/api/admin/ledger/budget-context/route.ts`). A third inline copy would be a duplication finding; do not migrate the two existing copies in this PR (out of scope; see handoff).

### Data Model
No schema changes required. **Comment-only edit** to `src/lib/db/schema.ts` at `ledgerAuditLog`: add `'reconciliation_session_discarded'` to the action-list comment and extend the "both null" note ("or, for the pre-existing cases `ack_letter_template_updated` and `reconciliation_session_discarded`, both are null"). That file carries other pipelines' uncommitted edits today: use a minimal `Edit` of those comment lines only; do not rewrite or reformat. A comment cannot change `drizzle-kit push`; no migration.

### Component/Page Plan
**New: `src/components/admin/ledger/reconciliation-discard-button.tsx`** (client; pattern: `reconciliation-reopen-button.tsx`).
- Props: `{ sessionId, periodLabel, accountName, bankLineCount, matchCount }`.
- State `open`, `pending`. Trigger button, secondary-destructive outline: `border-2 border-red-300 text-red-700 hover:bg-red-50 px-4 py-2 rounded-lg text-sm font-semibold transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]` (no `lions-red`, no `rounded-full`). Label "Discard session". Disabled while `pending`.
- `<ConfirmDialog destructive title="Discard this session?" confirmLabel="Discard session" description={buildDiscardDescription(...)} onConfirm={handleDiscard} />`. No `window.confirm`.
- `handleDiscard` calls `fetch(DELETE ...)`, then maps the response via an exported pure function `discardResponseAction(status, body)` so it is unit-testable in the node-only Vitest env (same technique as `errorMessageFor` in `financial-report-send-panel.tsx`):
  - 200: `toast.success("Session discarded. N statement lines and M matches removed.")` using the **server's** counts (drop the clause when both are 0: "Session discarded."), then `router.push("/admin/ledger/reconciliation")`. Push, not refresh: the current record no longer exists and a refresh would flash `notFound()`.
  - 404: `toast.info("That session no longer exists.")`, then push to the list (success-equivalent).
  - 409: `toast.error(body.error)`, then `router.refresh()` so the closed state and the Reopen button appear.
  - 403 / 500 / network: `toast.error(body.error || "Could not discard the session. Try again.")`, stay on the page.
  - `finally`: `setPending(false)` (the dialog closes itself via `AlertDialog.Action`).
- Exported pure `buildDiscardDescription({ periodLabel, accountName, bankLineCount, matchCount })`:
  - Base: `This permanently deletes the {periodLabel} session for {accountName}`
  - `bankLineCount === 0`: `. Nothing has been uploaded to it yet.` (the analyst's "including nothing uploaded yet", reworded to read naturally; never "0 uploaded statement lines and 0 matches").
  - `bankLineCount > 0`: `, including its {N} uploaded statement line(s) and {M} match(es).` with correct singular/plural; `matchCount === 0` reads `... and no matches.`
  - Then always: ` Nothing in the ledger is changed: no transaction is edited, un-reconciled or deleted.`
  - **Created-transactions warning**, shown only when `bankLineCount > 0` (a session with nothing uploaded cannot have created a transaction from a bank line, and showing the warning there would be noise): ` Any transaction you created from a bank line during this session stays in your books, on {accountName}.` Naming the account matters: the treasurer's own case was the wrong account.
  - Then always: ` This can't be undone, but you can start a new session for the same period right away.`
  - Counts come from the page render and may be slightly stale; the toast uses the server's counts.

**Modify: `src/app/(dashboard)/admin/ledger/reconciliation/[sessionId]/page.tsx`** (clean in git today). Header action cluster only (the `flex flex-wrap items-center gap-3` div that holds the Open/Closed badge and the Reopen button), directly after the badge/Reopen block:
```tsx
{isOpen && canRecord && (!reconSession.reopenedAt || canManage) && (
  <ReconciliationDiscardButton
    sessionId={sessionId} periodLabel={periodLabel}
    accountName={reconSession.bankAccountName}
    bankLineCount={bankLines.length} matchCount={matchedTransactions.length}
  />
)}
```
`bankLines` and `matchedTransactions` are already fetched on this page, and `getMatchedTransactionsForSession()` returns exactly one row per match, so no new query. The cluster is already `flex-wrap`, so the button wraps at 360px. Not on the list rows (analyst decision 7).

**Modify: `src/components/admin/ledger/guide/reconciliation-section.tsx`** (clean in git; do not touch `guardrails-section.tsx` / `settings-section.tsx`, which other pipelines have open). After the Reopen `<li>` add one `<li>` (or a paragraph below the list), exactly two sentences:
> **Discard** — opened a session for the wrong account or period? Use **Discard session** on its page to permanently remove it along with its uploaded statement lines and matches and start a fresh one right away; no ledger transaction is changed, though any transaction you created from a bank line stays in your books and has to be deleted from the transaction list if it landed on the wrong account. Only an open session can be discarded: a closed one must be reopened first, and a session that has ever been reopened can be discarded only by someone who can manage the Ledger.

**Modify: `src/lib/utils.ts`** (`isUuid`), **`src/lib/reconciliation-queries.ts`** (`discardOpenSession` + imports `ledgerAuditLog`, `sql`), **`[sessionId]/route.ts`** (`DELETE` + header comment), **`src/lib/db/schema.ts`** (comment only).
Pages created: none. Migrations: none.

### Implementation Order
1. `isUuid` in `src/lib/utils.ts` + test.
2. `discardOpenSession()` in `reconciliation-queries.ts` + query-layer tests.
3. `DELETE` handler in `[sessionId]/route.ts` + route tests.
4. Comment-only edit in `schema.ts`.
5. `reconciliation-discard-button.tsx` + component tests.
6. Detail page placement.
7. Guide copy.
8. Gate: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm build:only`. Read the relevant guide under `node_modules/next/dist/docs/` for the route-handler `params` shape before writing the handler (CLAUDE.md "not the Next.js you know"); mirror the sibling routes, which already use `params: Promise<{...}>`.

### Unit tests (named; the implementer delivers these, the Phase 4 gate)
Vitest runs in `environment: "node"` with no jsdom: component tests use `renderToStaticMarkup` plus exported pure functions, as `financial-report-send-panel.test.tsx` does.

**`src/app/api/admin/ledger/reconciliation/sessions/[sessionId]/route.test.ts`** (mocks `@/lib/auth`, `@/lib/permissions-server`, and `discardOpenSession`; mirror `match/route.test.ts`):
- R1 no session: 401, `discardOpenSession` not called.
- R2 no `ledger.record`: 403, `discardOpenSession` not called, and `hasFeature` was checked before the discard call.
- R3 non-UUID `sessionId`: 404, `discardOpenSession` not called.
- R4 `not_found` outcome: 404 "Session not found".
- R5 `not_open` outcome: 409 with the exact message.
- R6 two-key rule: record-only caller -> route passes `canManage: false`; `requires_manage` outcome -> 403 with the exact message; manage holder -> `canManage: true` and a `discarded` outcome -> 200.
- R7 200 body is exactly `{ sessionId, discarded: true, bankLineCount, matchCount }`.
- R8 thrown error -> 500 "Failed to discard reconciliation session".

**`src/lib/reconciliation-discard.test.ts`** (new file; mocks `@/lib/db` with a recording `tx` whose `select/delete/insert/update` calls are captured in order; this is a different db-mock shape from the FIFO `reconciliation-queries.test.ts`, hence a new file):
- Q1 happy path: both counts are read **before** the delete; the delete runs once and returns the row; exactly one audit insert; result carries the counts.
- Q2 **audit-row shape**: `action = "reconciliation_session_discarded"`, `actorUserId` set, `targetCategoryId` and `targetTransactionId` both null, `after` null, `before` parses to **exactly** this key set `{bankAccountId, statementPeriodStart, statementPeriodEnd, openingBalanceCents, closingBalanceCents, status, csvFilename, csvRowCount, bankLineCount, matchCount, reopened}` (assert key equality, so a stray description field fails), `reopened` reflects `reopenedAt`, `details` contains the account name, ISO period and both counts, and no bank-line text appears anywhere in the row.
- Q3 **close-then-discard race (mandatory)**: the pinned DELETE returns `[]` and the diagnosis select returns `{status: "closed"}` -> `not_open`; `tx.insert` (audit) never called; the only write issued is that one zero-row delete. Also render the captured delete `where` with `new PgDialect().sqlToQuery(...)` and assert the SQL contains the status predicate and that the bound params include `"open"`: this is the test that fails if someone "simplifies" the pin away.
- Q4 unknown id: delete `[]`, diagnosis `[]` -> `not_found`, no audit.
- Q5 two-key rule at the statement level: `canManage: false` -> the rendered WHERE includes the `reopened_at is null` predicate; `canManage: true` -> it does not. Delete `[]` plus diagnosis `{status:"open", reopenedAt: <date>}` -> `requires_manage`, no audit.
- Q6 **no ledger_transactions write**: across every scenario, no `tx.update` call, and no `tx.delete`/`tx.insert` whose table argument is `ledgerTransactions`; deletes target only `ledgerReconciliationSessions`, inserts only `ledgerAuditLog`.
- Q7 atomicity: audit insert rejects -> `discardOpenSession` rejects (the callback's rejection is what rolls the real transaction back); the route test R8 covers the 500.
- Q8 zero-count session (nothing uploaded): 200-shape result with `bankLineCount: 0, matchCount: 0`, audit still written.

**`src/lib/utils.test.ts`** (extend or add): `isUuid` accepts a v4 UUID (either case), rejects `""`, `"abc"`, `"1"`, a UUID with a trailing character, and a SQL-looking string.

**`src/components/admin/ledger/reconciliation-discard-button.test.tsx`** (node env; mocks `next/navigation` and `sonner`):
- C1 `buildDiscardDescription`: includes period, account, counts; singular/plural ("1 uploaded statement line", "1 match"); `matchCount 0` wording ("and no matches"); `bankLineCount 0` wording ("Nothing has been uploaded to it yet") with no "0 uploaded statement lines" string; the created-transactions warning present when lines > 0 and absent when 0; "can't be undone" present.
- C2 `discardResponseAction`: 200 -> success toast with the server's counts then push `/admin/ledger/reconciliation`; 404 -> info toast then push; 409 -> error toast with the server message then refresh; 403/500 -> error toast, no navigation.
- C3 `renderToStaticMarkup` of the button: shows "Discard session", `min-h-[44px]`, `rounded-lg`, no `rounded-full`, no `lions-red`; dialog content absent while closed. Read the component source in the test and assert it contains `ConfirmDialog` with `destructive` and no `window.confirm`.

### Checks that unit tests cannot prove (Phase 5, qa, against the dev database)
A mocked `db` cannot prove cascade behavior or "rows unchanged". qa must run these live (dev DB is the user's local Neon DB; no email is involved):
- **Analyst test 2, live leg (the one the pin exists for):** seed a closed session with reconciled transactions; `DELETE` it through the route; expect 409 and diff the session row, its bank lines, its matches and every cleared transaction's `reconciled` / `reconciled_at` / `reconciled_session_id`: all unchanged.
- **Analyst test 3 + 7, live:** an open session with a transaction made via `create-from-bank-line`: after discard that transaction exists, unmatched, `reconciled = false`, same bank account; and creating a session for the same account and period immediately afterward succeeds (no overlap 409, no unique-constraint error).
- Reopened session: record-only user 403, manage user 200.
- Click-through at 360px and desktop: button wraps, dialog copy reads correctly for 0 lines, N lines with 0 matches, and N lines with M matches; list no longer shows the session after the push.

Mapping of the analyst's eight tests: 1 -> Q1/Q2/R7; 2 -> Q3 + live leg; 3 -> Q6 + live leg; 4 -> Q6; 5 -> R2/R6/Q5; 6 -> R3/R4; 7 -> live leg only (it is a property of the hard delete plus the unique constraint, not of any code that can be unit-tested hermetically); 8 -> C1/C2/C3.

### Edge Cases & Risks
- **Counts are exact enough, not perfect.** They are taken in the same transaction but under READ COMMITTED, so a match inserted by another user between the count and the delete is cascade-deleted yet missing from the audit count and toast. Fine for now because the audit row is a "what happened" trail rather than a ledger, and the window is milliseconds on a one-treasurer workflow; if exactness ever matters, take `SELECT ... FOR UPDATE` on the session row first (match inserts hold a key-share lock on it, so this serializes them). Do not add it now.
- **Close vs discard** (analyst): close-then-discard -> the pin matches zero rows -> 409, no data touched (test Q3). Discard-then-close -> if the session had matches, close's `UPDATE ledger_transactions SET reconciled_session_id = <deleted id>` hits an FK violation and rolls back (a 500, no corruption); if it had none, close's unpinned final UPDATE matches zero rows and may report success for a session that is gone, and the refresh then 404s. Harmless, not changed here; `close` pinning `status = 'open'` stays out of scope.
- **Created-from-bank-line transactions survive**, possibly on the wrong account. Warned in the dialog, not detected, not deleted. Follow-up B-86 (marker).
- **`ON DELETE SET NULL` trap.** Any future change that widens this DELETE to closed sessions silently corrupts provenance. DECISION-108 and a code comment at the DELETE state this; the status pin must not be "simplified" into the route's own check.
- **Audit row has no reader today.** Accepted by the user. The row is for the books-of-record trail and support queries.
- **Router cache after `router.push`.** QA confirms the list does not show the discarded session; if the client cache shows it stale, add `router.refresh()` after the push. Check Next's behavior in the local docs before assuming either way.
- `UUID_RE` now exists in two files; `isUuid` makes it three call sites over one definition. Migrating the two existing copies is a separate cleanup.

### Out of Scope (unchanged from Phase 1)
Edit-account/period instead of discard; replace-statement/re-upload; direct discard of a closed session; bulk discard, undo, trash bin; detecting or auto-deleting created-from-bank-line transactions (B-86); a viewer UI for `ledger_audit_log`; making `close` pin `status = 'open'`; migrating the two existing `UUID_RE` copies.

### Release-notes text (draft, no version assigned: four pipelines are in flight; assign at release time via `/release-notes`)
> ### Feature: Discard a reconciliation session you started by mistake
>
> **Value:** Starting a reconciliation session against the wrong bank account used to leave no way out in the product. The mistaken session also blocked starting the right one whenever their statement periods overlapped, and the only fix was a hand edit to the database. The treasurer can now discard it and start over.
>
> #### What's New
> - An open session now has a **Discard session** button at the top of its page, beside the Open badge.
> - A confirmation says exactly what will be removed: the session, the statement lines uploaded to it and the matches made against them.
> - Nothing in the ledger changes. No transaction is edited, un-reconciled or deleted. Any transaction you created from a bank line while working in the session stays in your books; the confirmation says so, and if one landed on the wrong account, delete it from the transaction list.
> - Right after discarding, you can start a new session for the same account and period.
> - A closed session cannot be discarded directly. Reopen it first (which requires permission to manage the Ledger), then discard it. A session that has ever been reopened can only be discarded by someone who can manage the Ledger.
> - Every discard is recorded in the Ledger's audit trail with who did it, when, and how many lines and matches were removed. The bank's own statement text is not copied into that record.
> - The Treasury User's Guide's Bank Reconciliation section now explains how to discard a session.
>
> #### Permissions
> | Feature key | Required for |
> |-------------|--------------|
> | `ledger.record` | Discarding an open session |
> | `ledger.manage` | Additionally, discarding a session that was previously reopened |
>
> No new permission was added.

### Decisions to log (Phase 3 closeout)
`DECISION-108` (hard delete over soft status; status pin inside the DELETE and why; matches and created-from-bank-line transactions do not block) above DECISION-107 in `docs/decisions.md`. `docs/backlog.md`: B-06 closed out with the changed rule, new B-86 (created-from-bank-line marker).


---

# Phase 4 — Implementation

## Phase 4 — Implementation (full-stack) — 2026-10-01

**Owner:** full-stack-developer
**Status:** complete

### Summary
Implemented the Phase 3 design as written: `discardOpenSession()` (one transaction; status pin and the reopened-by-non-manager pin both inside the DELETE), a `DELETE` handler on the session route, a client discard button on the detail-page header, the guide copy, and a comment-only schema edit. No schema change, migration, permission or email. All named tests written and passing; live dev-DB check confirmed the discard path and the closed-session 409.

### What I did
- `isUuid()` added to `src/lib/utils.ts` (the two existing `UUID_RE` copies left alone).
- `discardOpenSession()` in `src/lib/reconciliation-queries.ts`: count lines, count matches, `DELETE ... WHERE id AND status='open' [AND reopened_at IS NULL] RETURNING`; zero rows -> diagnosis select -> `not_found` / `not_open` / `requires_manage` with nothing written; otherwise account-name lookup + one `reconciliation_session_discarded` audit row (both targets null, counts-only `before`, ISO dates in `details`).
- `DELETE` handler in `[sessionId]/route.ts` with gate order 401 -> LEDGER_RECORD 403 -> `canManage` boolean -> params -> `isUuid` 404 -> query -> exhaustive `never`-checked switch. Header comment updated.
- `reconciliation-discard-button.tsx` (client; pure exported `buildDiscardDescription` and `discardResponseAction`; destructive `ConfirmDialog`, confirm label "Discard session"; push to list on 200/404, refresh on 409).
- Detail page header: button shown when `isOpen && canRecord && (!reopenedAt || canManage)`.
- Guide: one `<li>` (two sentences) in `reconciliation-section.tsx`.
- `schema.ts`: two comment-only edits at `ledgerAuditLog` (action list, both-null note), applied by exact-string replace after a fresh read.

### Outputs
- Created: `src/components/admin/ledger/reconciliation-discard-button.tsx`, `src/components/admin/ledger/reconciliation-discard-button.test.tsx` (C1-C3), `src/lib/reconciliation-discard.test.ts` (Q1-Q8), `src/app/api/admin/ledger/reconciliation/sessions/[sessionId]/route.test.ts` (R1-R8), `src/lib/utils.test.ts` (isUuid).
- Modified: `src/lib/utils.ts`, `src/lib/reconciliation-queries.ts`, `src/app/api/admin/ledger/reconciliation/sessions/[sessionId]/route.ts`, `src/app/(dashboard)/admin/ledger/reconciliation/[sessionId]/page.tsx`, `src/components/admin/ledger/guide/reconciliation-section.tsx`, `src/lib/db/schema.ts` (comments only).
- Endpoint: `DELETE /api/admin/ledger/reconciliation/sessions/[sessionId]`, gate `ledger.record` (+ `ledger.manage` for a previously reopened session). No server action.
- Schema change / migration: none. New env var / `FEATURES` key: none.
- Gates: `tsc --noEmit` clean; `pnpm test` 144 files / 2441 tests passed; `pnpm build:only` passed; `pnpm lint` 0 errors, 1 warning in `budget-context-panel.tsx` (not my file).

### Live check (dev DB, UI + API as e2e admin)
- Created an open session (Administrative Checking, 2031-01-01..31). Detail page showed the button; dialog copy read correctly for the zero-line case; confirming returned 200, toast "Session discarded.", redirect to `/admin/ledger/reconciliation`; GET of the id then 404.
- Audit row present: action `reconciliation_session_discarded`, actor set, both targets null, `after` null, counts-only `before`, ISO-date `details`.
- Re-creating the same account+period succeeded (201). Closed it (200, 0 cleared); `DELETE` returned 409 with the exact message and the session row remained closed. Non-UUID id returned 404.
- Cleanup: deleted the test session and the audit row by SQL; dev DB back to 0 sessions / 0 discard audit rows (as found).
- Not exercised live (needs data the dev DB lacks: uploaded lines, matches, reconciled transactions, a second user): the 409 leg with cleared transactions and their reconciled columns, the created-from-bank-line survival, reopened-session 403/200. These remain for qa; the unit tests cover them at the statement level.

### Open questions / handoff notes
- Deviations: none from the design. Test file for the route sits at `[sessionId]/route.test.ts` as named.
- `UUID_RE` still duplicated in `ledger-queries.ts` and `budget-context/route.ts`; migrating them to `isUuid` is a separate cleanup.
- `router.push` cache behavior: the list was fetched fresh after redirect in the live run (session absent); qa should still confirm with an existing list visit beforehand.
- qa (Phase 5): run the live legs listed in Phase 3 "Checks that unit tests cannot prove", at 360px and desktop; click-through the N-lines/M-matches dialog copy.

---

# Phase 5 — Verification (qa)

## Phase 5 — Verification — 2026-10-01

**Owner:** qa
**Status:** complete

### Summary
**Verdict: PASS.** All four static gates are green, every Phase 3 diff-review item checks out, and every live leg the unit tests cannot prove was exercised against the dev database (DATABASE_URL only) and held: open discard returns 200 with the right counts and leaves every ledger transaction alone, a closed session answers 409 with every row byte-for-byte unchanged, the reopened-session two-key rule holds (403 record-only, 200 manage), and the dialog reads correctly at 360px and desktop. 37 of 38 scripted live checks passed on the first full run; the one failure is a pre-existing page-layout condition outside this diff (see Observations) and one check was a weak assertion that I re-measured by hand and it passes. No defect found in this feature. Hand to **analyst** for Phase 6.

### What I did

**1. Static gates (run on the shared tree; no gate failed, so no "concurrent pipeline" re-run was needed)**

| Gate | Result | Summary line (verbatim) |
|------|--------|-------------------------|
| `pnpm exec tsc --noEmit` | PASS | no output, exit 0 (tsc prints no summary on success). Re-run after my one test-title edit: exit 0 |
| `pnpm test` | PASS | `Test Files  144 passed (144)` / `Tests  2441 passed (2441)` / `Duration  3.99s (transform 7.36s, setup 0ms, import 16.23s, tests 7.28s, environment 7ms)` |
| `pnpm build:only` | PASS | `✓ Compiled successfully in 837ms`, `✓ Generating static pages using 15 workers (125/125) in 3.5s`, exit 0. Route table lists `ƒ /api/admin/ledger/reconciliation/sessions/[sessionId]` (dynamic) |
| `pnpm lint` | PASS (0 errors) | `✖ 1 problem (0 errors, 1 warning)`: the warning is `budget-context-panel.tsx:114` "Unused eslint-disable directive", a file not in this diff and not modified in the working tree |

Playwright e2e suite (`pnpm test:e2e`): **not run**. It is serial, ~12 minutes, shares one database with another pipeline that is verifying reimbursements concurrently, and Phase 3 named no e2e spec for this feature. The live legs below were driven by a scripted headless-chromium run against the already-running dev server (port 3000), not by the committed suite.

**2. Diff review against Phase 3** (read `git diff` of utils.ts, reconciliation-queries.ts, `[sessionId]/route.ts`, detail page.tsx, guide section, plus the new button and the four new test files)
- Feature gates run before any param or row read: route order is `auth()` (401) -> `hasFeature(LEDGER_RECORD)` (403) -> `hasFeature(LEDGER_MANAGE)` into `canManage` -> `await params` -> `isUuid` (404) -> `discardOpenSession()`. Route test R2 asserts the feature check precedes the discard call. Confirmed.
- DELETE pinned in one statement: `tx.delete(S).where(and(eq(S.id), eq(S.status,"open"), [isNull(S.reopenedAt) unless canManage])).returning()`. No read-then-delete. Invariant comment sits on the function. Confirmed.
- Zero-row path: one diagnosis `select`, returns `not_found` / `not_open` / `requires_manage`, issues no insert and no further write. Confirmed in code and by Q3/Q4/Q5 and live.
- Audit row: `tx.insert(ledgerAuditLog)` with `actorUserId`, `action = "reconciliation_session_discarded"`, `targetCategoryId: null`, `targetTransactionId: null`, JSON-stringified `before`, `after: null`, `details`. Same shape as `ack_letter_template_updated` (both targets null, JSON text columns). Counts only; no bank-line text read. Schema diff is comment-only for this feature (the other `schema.ts` hunk near `financialReportSends` belongs to another pipeline). Confirmed.
- `ConfirmDialog` with `destructive`, confirm label "Discard session"; `grep` for `console.log`, `window.confirm|alert|prompt` and bare `confirm(`/`alert(`/`prompt(` across the button, route, queries and page: no matches. Confirmed.
- Tap target and focus ring: classes include `min-h-[44px]` and `focus:outline-none focus:ring-2 focus:ring-lions-blue`; live-measured 44px tall at desktop and at 360px, and on focus the computed box-shadow is a 2px `rgb(0, 63, 135)` ring. Confirmed.
- Guide copy: one `<li>` added to `reconciliation-section.tsx`, nothing else touched there.

**3. Live legs** (dev DB `ep-orange-sunset...` via DATABASE_URL; `PROD_DATABASE_URL` is set in `.env.local` and was deliberately never read. I compared hosts: they differ). Fixtures: open sessions on Administrative Checking for 2031-02..2031-06 (non-cash, far-future), a 3-line Chase-format CSV uploaded through the real upload route, one line matched to a freshly created posted transaction through the real match route, one line turned into a transaction through the real `create-from-bank-line` route, one line left unmatched. The dev DB had no unreconciled posted transactions to match against, so the "existing posted transaction" is a fixture I created through `POST /api/admin/ledger/transactions` (income, $12.34, so no disbursement-approval email path). Second actor: a temporary user holding only the `treasurer` role (`ledger.record` + `ledger.view`, no `ledger.manage`), created and deleted by me, so the e2e admin's roles were never touched.

| Leg | Observed | Result |
|-----|----------|--------|
| (a) discard open session, 3 lines / 2 matches (1 matched to a posted txn, 1 created from a bank line) | 200 `{sessionId, discarded:true, bankLineCount:3, matchCount:2}`; session, bank lines, matches gone; both transactions still in `ledger_transactions`, `status=posted`, `reconciled=false`, `reconciled_at` null, `reconciled_session_id` null, same bank account; exactly 1 audit row, actor set, both targets null, `after` null, `before` has exactly the 11 designed keys (counts 3/2, `reopened:false`), no bank-line text anywhere in the row | PASS |
| (a) overlap freed | same account + same period (2031-02) created again immediately: 201 | PASS |
| (a) misc status | unauthenticated DELETE 401; already-discarded id 404; non-UUID `not-a-uuid` 404 (not a Postgres 500) | PASS |
| (b) closed session | built a balanced session (both lines matched, opening 100000, closing 100000+1984), closed it: 200 `clearedCount 2`, both txns reconciled with the session pointer. DELETE as manage holder: **409** `"This session is closed — reopen it before discarding it."`. Snapshot of the session row + bank lines + matches + both full `ledger_transactions` rows (JSON, 4211 chars) before vs after: **identical**. Same with the record-only user: 409, still identical. No discard audit row written by either 409 | PASS |
| (c) reopened session | reopen as manage holder 200 (`revertedTxnCount 2`, flags cleared). Page as record-only user: no Discard button; as manage holder: button present. DELETE as record-only: **403** `"Only a ledger manager can discard a session that was reopened."`, snapshot unchanged. DELETE as manage holder: **200** (2 lines, 2 matches); txns survive unreconciled; audit `before.reopened === true` | PASS |
| (e) record-only, never-reopened open session | 200 (0/0). Confirms the common case does not need `ledger.manage` | PASS |
| (d) UI, desktop 1280x900 | button wraps nowhere, 44px tall; dialog copy: "This permanently deletes the Mar 1, 2031 – Mar 31, 2031 session for Administrative Checking, including its 3 uploaded statement lines and 2 matches. Nothing in the ledger is changed: no transaction is edited, un-reconciled or deleted. Any transaction you created from a bank line during this session stays in your books, on Administrative Checking. This can't be undone, but you can start a new session for the same period right away." Confirm -> toast "Session discarded. 3 statement lines and 2 matches removed." -> redirected to `/admin/ledger/reconciliation` | PASS |
| (d) router cache | list visited first (session listed), then detail, then discard + `router.push`: the list shown after the push no longer contains the session, no hard reload and no extra `router.refresh()` needed | PASS |
| (d) 360x800 | header button sits under the title (x 98.7 to 239, 44px tall, inside the viewport); dialog is 360px wide edge to edge and fully readable; Cancel / Discard session buttons side by side | PASS (see Observation 1 for the page-level scroll) |
| (d) zero-line copy | "...session for Administrative Checking. Nothing has been uploaded to it yet. Nothing in the ledger is changed ... " with no "0 uploaded" string and no created-transaction warning | PASS |

Screenshots (scratchpad): `shots/desktop-header.png`, `shots/desktop-dialog.png`, `shots/desktop-dialog-zero.png`, `shots/desktop-focus-ring.png`, `shots/mobile-header.png`, `shots/mobile-dialog.png`, `shots/after-redirect-360.png` under `/private/tmp/claude-501/-Users-cshenso-git-westervillelions/905042bc-d0ca-4613-a7e1-15298879f5cb/scratchpad/`.

**Cleanup, verified.** Deleted: 6 fixture sessions (cascade removed lines and matches), 6 fixture transactions, 5 `reconciliation_session_discarded` audit rows, the temporary user and its role rows, and 1 `email_queue` row ("New portal user needs member record review", `blocked_non_production`) that the temporary user's first sign-in enqueued (see Observation 4). Final check: 0 sessions, 0 bank lines, 0 matches, 0 discard audit rows, 0 `qa-discard%` users, 0 fixture transactions; `ledger_audit_log` back to its baseline of 735; the e2e admin still has its 10 `user_roles` rows (baseline 10). Whole-table counts for `users`, `user_roles`, `ledger_transactions` and `email_queue` ended one to two rows *below* my baseline: I only ever deleted rows by my own fixture ids and the single temp-user email, so those deltas are the concurrent reimbursements pipeline cleaning up its own `QA-FIXTURE-D106` / `qa-viewonly-d106` rows (I saw them appear in `email_queue` and `ledger_transactions` during the run). I did not capture a per-id baseline for `users`, so I cannot prove that attribution row by row; it is the straightforward reading, not an established fact.

**4. Mutation proof that the unit tests actually bite** (temporary edit to `reconciliation-queries.ts`, restored byte-identical, verified by checksum)
- Remove `eq(S.status, "open")` from the DELETE conditions: Q3 fails (7 pass / 1 fail). 
- Remove the `if (!canManage) conds.push(isNull(S.reopenedAt))` line: Q5 fails (7 pass / 1 fail).

### Regression Tests Added / Named
- `src/lib/reconciliation-discard.test.ts:171` Q3 "close-then-discard race -> not_open, no audit, status predicate pinned in the DELETE — regression for hard-deleting a closed session orphaning reconciled_session_id (ON DELETE SET NULL, DECISION-036)". **This is the test that guards "deleting a closed session would orphan reconciled transactions."** It renders the DELETE's WHERE through `PgDialect` and asserts the `status` predicate and the bound `"open"` param, and that no audit insert and no second write is issued. The mutation above shows it fails the moment the pin is removed. Live corroboration: leg (b). I appended the required `— regression for ...` suffix to its title (title-only edit, no logic change; file re-run 8/8, `tsc` clean).
- `src/lib/reconciliation-discard.test.ts:194` Q5: guards the reopened-session two-key pin inside the DELETE (mutation-verified).
- `src/lib/reconciliation-discard.test.ts:212` Q6: no write to `ledger_transactions` under any scenario.
- Route tests R1 to R8 at `src/app/api/admin/ledger/reconciliation/sessions/[sessionId]/route.test.ts`: gate order, UUID 404, exhaustive outcome mapping, 500 shape.

### Coverage on Critical Modules
Not run: this change touches none of `src/lib/events.ts`, `permissions.ts` (the working-tree edit to `permissions.ts` belongs to another pipeline) or `members.ts`. The new code has direct tests (`discardOpenSession` Q1 to Q8, route R1 to R8, `isUuid`, button C1 to C3).

### Feature-Gate Audit

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `DELETE /api/admin/ledger/reconciliation/sessions/[sessionId]` | yes, first statement, 401 | yes, before params/row read | `FEATURES.LEDGER_RECORD` (403), plus `FEATURES.LEDGER_MANAGE` evaluated up front and enforced inside the DELETE's WHERE for a previously reopened session. Mutation key, matches the sibling unmatch/close routes; reopen stays `LEDGER_MANAGE` |
| `/admin/ledger/reconciliation/[sessionId]` page (existing, one JSX block added) | yes, `redirect("/signin")` | yes, `LEDGER_VIEW` -> `/access-pending`; button additionally shown only when `isOpen && canRecord && (!reopenedAt \|\| canManage)` | unchanged; the button is convenience, the route is the gate (proven live: record-only user gets 403 on a reopened session) |
| Server actions | none added | n/a | n/a |

No new page, no new proxy rule, no new `FEATURES` key, no migration.

### Observations (none block PASS; none caused by this diff)
1. **360px horizontal scroll on the session detail page is pre-existing.** `document.documentElement.scrollWidth` is 848 at a 360px viewport with the Discard button present, and still 848 with the button hidden; the overflow is the bank-lines `<table class="min-w-full ...">` (839px wide) in the matching grid, a component this diff does not modify. The header button itself fits. If the club wants it fixed, it is a separate small item (wrap the table in `overflow-x-auto`); I have not added it to the backlog (told not to touch it).
2. The red "1 Issue" badge visible in dev screenshots is React's dev-mode "eval() is not supported ... Content-Security-Policy" console error, plus an unrelated logo aspect-ratio warning; neither involves this feature, and no Radix/dialog warnings were logged with the dialog open.
3. One scripted assertion of mine ("focus ring present") compared the computed box-shadow to the string `none` and passed on a transparent shadow. I re-measured separately: unfocused is `none`, programmatically focused is `rgb(0, 63, 135) 0px 0px 0px 2px`. Genuine PASS. Keyboard Tab did not reach the button within 40 presses because the admin sidebar sits first in tab order; not a defect.
4. **Test-hygiene note for other QA runs:** signing in any user with no linked member enqueues an "Unlinked User Alert" to `info@westervillelions.org`. In dev it is `blocked_non_production` and never left the machine, and I removed my row, but a temporary-user fixture is not email-free.
5. Not exercised live: a truly concurrent close-vs-discard race (only sequential close-then-discard). That race is covered at the statement level by Q3 and by the analyst's/tech-lead's race analysis; sequentially, the pin returned 409 live.
6. No failures, so there is no root-cause theory to separate from established fact.

### Verdict: PASS

### Outputs
- Work-log: this section; status table row 5 set to Complete / PASS.
- Test edit: title-only change to `src/lib/reconciliation-discard.test.ts` (Q3 regression suffix). No source or feature code touched; no commit; `docs/decisions.md` and `docs/backlog.md` untouched.
- Scratch (not in repo): fixture/driver scripts and screenshots under the scratchpad directory above.

### Open questions / handoff notes
- Next agent: **analyst** (Phase 6, shipped vs intent).
- For the analyst: dialog copy shipped exactly as Phase 1/3 specified, including the zero-line variant and the created-transaction warning naming the account. The treasurer's real flow (wrong account, then new session for the right one) works end to end, including re-creating the same period immediately.
- Follow-ups, none blocking: (a) B-86 marker for created-from-bank-line transactions is still the only way the dialog could ever say how many will stay; (b) the 360px matching-grid overflow (Observation 1); (c) optional committed Playwright spec for the discard flow if the club wants a permanent e2e guard, since today only unit tests plus this scripted run cover the live behavior.


---

# Phase 6 — Shipped vs Intent (analyst)

## Phase 6 — Shipped vs Intent — 2026-10-01

**Owner:** analyst
**Status:** complete

### VERDICT: SHIP WITH NOTES

### One-line take
The treasurer can now discard a wrongly opened reconciliation session from its own page, with an honest confirmation, an atomic status-pinned hard delete, an audit row and no ledger transaction touched; two small follow-ups are tracked, neither a defect in this feature.

### What's working
- **The pin is where it has to be.** `discardOpenSession()` runs one `DELETE ... WHERE id AND status = 'open' [AND reopened_at IS NULL] RETURNING`, with the `ON DELETE SET NULL` / DECISION-036 reason in a comment on the function and in the route header. QA mutation-tested it: removing either predicate fails Q3 or Q5. Live, a closed session answered 409 with the session, lines, matches and both cleared transactions byte-identical afterwards.
- **The treasurer's real flow works end to end.** Wrong session -> Discard session -> dialog -> toast -> list without the session -> same account and period re-created immediately (201). That is the hand-SQL cleanup, productised.
- **Dialog copy matches what was agreed, including the part that matters most.** It names the account in the created-transactions warning (the treasurer's own case was the wrong account), drops the warning and the counts for an empty session, and never prints "0 uploaded statement lines". Button vocabulary is "Discard" throughout.
- **Failure paths are human.** 403/409/404/500 each map to a plain sentence; 409 refreshes the page so the closed state and Reopen appear; 404 is treated as success-equivalent. No stack trace reaches the user.
- **Audit row is exactly the shape specified.** Counts only, both targets null, same transaction as the delete, no bank-line text. `schema.ts` change is comment-only.

### Intent-vs-shipped diff

| # | Phase 1 said | Shipped | Verdict |
|---|---|---|---|
| 1 | Open sessions only; status pin inside the DELETE, never read-then-delete | Pin inside the statement; zero-row path diagnoses 404/409/403 and writes nothing | matches |
| 2 | `LEDGER_RECORD`; `LEDGER_MANAGE` additionally only when previously reopened | Same. Refinement from Phase 3: the reopened rule is also pinned inside the DELETE (`reopened_at IS NULL` unless manager), so no read-then-delete window. Proven live: record-only 403, manager 200, record-only on a never-reopened session 200 | matches (improves on Phase 1) |
| 3 | Hard delete, no soft status | Hard delete; no schema change or migration; overlap rule and unique constraint need no change | matches |
| 4 | Matches and created-from-bank-line transactions allowed; transactions survive | Allowed. Live: 3 lines / 2 matches (one a created-from-bank-line transaction) discarded; both transactions remained posted, unreconciled, same account, pointer null | matches |
| 5 | Audit row counts-only, both targets null, same transaction | Exactly the 11-key `before`, `after` null, ISO-date `details`; Q2 asserts key equality | matches |
| 6 | Detail-page header button only, not on list rows | Header cluster only; shown when `isOpen && canRecord && (!reopenedAt \|\| canManage)`; route is the real gate (proven live) | matches |
| 7 | ConfirmDialog, destructive, created-transactions warning | `<ConfirmDialog destructive>`, title "Discard this session?", confirm "Discard session"; warning shown only when lines > 0 (Phase 3 refinement I endorse: a session with nothing uploaded cannot have created anything) | acceptable drift (intended) |
| 8 | Toast with server counts, `router.push` to list | Success toast uses the server's counts; push, not refresh; list shown fresh after the push, confirmed by QA | matches |
| 9 | Treasury User's Guide addition (two sentences) | One `<li>` after Reopen: what Discard does, the surviving-transactions caveat, open-only, the manager rule. It is two long sentences, so on spec, though dense; the guide is the treasurer's handbook and the content is correct | matches |
| 10 | DECISION-108 filed | Filed above DECISION-107 with all five points and the ON DELETE SET NULL rationale | matches |
| 11 | B-06 closed out noting the changed rule | `[x]`, with an explicit note that "blocked once any match exists" was deliberately not adopted and that replace/re-upload stays unbuilt | matches |
| 12 | B-86 filed (created-from-bank-line marker) | Filed, framed as the same family as B-85 and to be decided alongside it | matches |
| 13 | Unit tests named in Phase 3 | Q1-Q8, R1-R8, C1-C3, `isUuid`, all present; QA added the regression suffix to Q3 and proved Q3/Q5 bite | matches |

### Rulings on QA's observations
1. **Horizontal scroll at 360px on the session detail page: pre-existing, not this diff, does not gate.** QA measured scrollWidth 848 with the button present and 848 with it hidden; the overflow is the 839px bank-lines table in the matching grid, which this change does not touch. The new header button itself sits inside the viewport at 44px tall and the dialog is fully readable at 360px. It is, however, a real violation of the project's mobile-first rule on a page the treasurer uses, so it gets a follow-up (B-next, below) rather than being dropped.
2. **"Unlinked User Alert" email on temporary-user sign-in: pre-existing behaviour, not a finding against this feature.** It is the intended onboarding alert for a user with no linked member, it was `blocked_non_production` by the deny-by-default rule and never left the machine, and QA removed the row. Nothing in this diff sends or changes email. It is a test-hygiene fact for future QA runs that create temporary users, not a product issue. No backlog item.
3. Not exercised live: a truly concurrent close-vs-discard race (QA ran it sequentially). Accepted: the statement-level pin is test-proven (Q3, mutation-checked), the sequential case answered 409 live, and the Phase 1 race analysis shows the worst concurrent outcomes are a 409 or a rolled-back 500, never corruption.

### Edge cases

| Edge case | Result |
|---|---|
| Empty state (no session left after discarding the last one; session with nothing uploaded) | pass: list falls back to its existing empty state; zero-line dialog copy verified live |
| Failure microcopy (500, network, 403, 409, 404) | pass: all mapped to plain sentences; `discardResponseAction` unit-tested |
| Permission gate (401, 403 without record, 403 reopened without manage, 409 closed, 404 unknown/non-UUID) | pass: proven live with a record-only second actor, and unit-tested; proxy unchanged because no new admin page |
| Mobile 360px (the new control) | pass: button 44px, wraps under the title, dialog edge to edge |
| Mobile 360px (the page it lives on) | not applicable to this diff: pre-existing grid overflow, tracked below |
| Brand (`rounded-lg`, no `rounded-full`, no `lions-red`, focus ring, `ConfirmDialog`, no native dialogs) | pass: C3 asserts it, QA measured 44px and the 2px `lions-blue` ring |
| OAuth vs password, access-pending, email queue, Google Group sync | not applicable (admin-only, no email, no group sync); confirmed no email path touched |
| Adversarial: redirect targets, state-machine shortcut (closed session), enumeration, input boundaries, self-targeting | pass: no user-controlled redirect; the closed-session shortcut is blocked in the statement; non-UUID is a 404 not a 500; 404-vs-409 existence leak accepted (authenticated admin, UUID ids) |

### Follow-ups (each becomes its own work-log entry)
1. **B-86 (already filed): created-from-bank-line marker.** Still the only way the dialog could say "3 transactions you created will stay" and link them. Decide alongside B-85. No action needed in this pipeline.
2. **B-next (new): consolidate the UUID check into `isUuid()`.** This change had to add `UUID_PATTERN` / `isUuid()` to `src/lib/utils.ts` to avoid a third inline copy, but the two older copies (`UUID_RE` in `src/lib/ledger-queries.ts` and `src/app/api/admin/ledger/budget-context/route.ts`) were deliberately left alone, so the same regex now lives in three files. The Phase 3 note called this "three call sites over one definition"; it is three definitions until the two copies migrate. Under the project's duplication rule this is a backlog item with a count and a home, so the proposed wording is:
   > **B-next — The UUID-shape check is defined three times.** (added 2026-10-01 from Phase 6 of `docs/work-log/2026-10-01-discard-reconciliation-session.md`) `isUuid()` in `src/lib/utils.ts` (added for the discard route) duplicates `UUID_RE` in `src/lib/ledger-queries.ts` and in `src/app/api/admin/ledger/budget-context/route.ts`. Migrate the two older copies to `isUuid()` and delete them; then grep `src/` for any other inline `[0-9a-f]{8}-[0-9a-f]{4}` pattern. Pure refactor, no behaviour change. Priority: low; take it with the next Ledger touch.
3. **B-next (new): reconciliation session detail page overflows horizontally at 360px.** Proposed wording:
   > **B-next — The reconciliation session detail page scrolls sideways on a phone.** (added 2026-10-01 from Phase 5/6 of `docs/work-log/2026-10-01-discard-reconciliation-session.md`; pre-existing, found by QA) At a 360px viewport `/admin/ledger/reconciliation/[sessionId]` has a document width of 848px. The cause is the bank-lines `<table class="min-w-full">` (839px) in the matching grid (`reconciliation-matching-grid.tsx`), which sits in no horizontally scrolling container, so the whole page scrolls instead of just the table. Idea: wrap the table in `overflow-x-auto` (or move to a stacked card layout per row on small screens), then re-measure the page at 360px with an open session that has bank lines. Priority: low-to-medium (the treasurer reconciles on whatever device is nearest); check the unmatched-transactions list on the same page while there.
4. **Release notes (pre-push housekeeping, not a defect):** no release-notes entry for this feature exists yet (the Phase 3 draft is deliberately unversioned because four pipelines are in flight). It must be written through `/release-notes` before the push; user-facing value only, no file lists.
5. **Optional, only if the club wants a permanent guard:** a committed Playwright spec for the discard flow. Today the live behaviour is covered by QA's scripted run plus unit tests; no backlog item filed.

### Red flags
None.

### Outputs
- This section; status table row 6 set to Complete / SHIP WITH NOTES.
- No code, `docs/backlog.md` or `docs/decisions.md` edits (per instruction); proposed backlog wording for the two "B-next" items is above for the orchestrator to assign IDs.

### Open questions / handoff notes
- Orchestrator: assign IDs to the two B-next items, and note that `docs/backlog.md`, `docs/decisions.md`, `schema.ts` and `release-notes/v1.84.md` all carry other pipelines' uncommitted edits, so the commit for this feature needs hunk-level staging, not `git add -A`.
- Pipeline for this feature closes with this verdict; the SHIP WITH NOTES items above are the tracked follow-ups.

---

## Phase 1 — Functional Refinement — 2026-10-01

**Owner:** analyst
**Status:** complete

### Summary
The treasurer's request is real, small and safe if one rule holds: only an open session is deleted, and the "open" check lives inside the DELETE statement. An open session has written nothing to ledger transactions, so discard removes the session, its imported statement lines and its match links and leaves every ledger row alone. Phase 1 verdict is READY WITH NOTES; the notes are the transactions-created-from-bank-lines disclosure and the closed-session pin.

### What I did
- Read the schema (sessions, bank lines, matches, the `reconciled_session_id` FK), the session/close/reopen/match/unmatch/create-from-bank-line routes, the session list, the reopen button and the detail page.
- Confirmed the FK cascade behaviour and the `ON DELETE SET NULL` trap that makes the status pin load-bearing.
- Confirmed `ledger_audit_log` can carry a session-discard row without a schema change (both-target-null precedent).
- Confirmed the existing unmatch route as the permission/phrasing precedent.
- Did not touch the other three live work-logs or any ledger/reimbursement/email-queue source file.

### Outputs
- `docs/work-log/2026-10-01-discard-reconciliation-session.md` (this file)
- No decisions logged yet. Phase 3 should add a `docs/decisions.md` entry for "discard is hard delete, open-only, status pinned in the DELETE, audited via both-null `ledger_audit_log` row". (Not written here: `docs/decisions.md` has another pipeline's uncommitted edits.)

### Open questions / handoff notes
- Orchestrator: confirm the proposed Phase 2 skip (or invoke the architect if any listed trigger applies).
- Tech-lead: honour the five Phase 3 musts and the eight tests in the Phase 2 recommendation block above.
- Implementer: `full-stack-developer` fits (one route handler addition, one client button component, one page edit, one guide paragraph, tests). Touch `src/app/api/admin/ledger/reconciliation/sessions/[sessionId]/route.ts`, `src/lib/reconciliation-queries.ts` (a `discardOpenSession()` helper), a new `reconciliation-discard-button.tsx`, the detail `page.tsx`, and `guide/reconciliation-section.tsx`. Do not edit `src/lib/db/schema.ts` except the one-line audit-log comment (that file has other pipelines' uncommitted changes, so coordinate or batch).
- Close out: mark B-06 resolved (and note the rule change) when shipped; consider a new backlog item for a created-from-bank-line marker (family of B-85).

## Phase 3 — Technical Design — 2026-10-01

**Owner:** tech-lead
**Status:** complete

### Summary
One `DELETE` method on the existing `[sessionId]/route.ts`, backed by `discardOpenSession()` in `reconciliation-queries.ts`: count lines and matches, a single `DELETE ... WHERE id AND status = 'open' [AND reopened_at IS NULL] RETURNING`, then one both-targets-null `ledger_audit_log` row, all in one transaction; zero rows is diagnosed into 404 / 409 / 403 with nothing written. A small client button follows the reopen-button pattern and sits in the detail-page header only. No schema change, no migration, no new permission, no email. Phase 2 skip is recorded in the status table.

### What I did
- Read the work-log, the session route, the reopen route, the unmatch route, the `ack_letter_template_updated` audit write, the detail page, the guide section, the `ConfirmDialog`, and the existing test patterns (route tests, db-mock tests, node-env component tests).
- Adopted every analyst default; two refinements: the reopened-session gate is pinned inside the DELETE's WHERE rather than pre-read, and the dialog drops the created-transactions warning when nothing was uploaded.
- Named 8 route tests, 8 query-layer tests (including the mandatory close-then-discard race and the audit-row shape), `isUuid` tests, and 3 component tests; named the live-database checks for qa that a mocked `db` cannot prove.
- Drafted release-notes text (no version, no file lists) for release time.

### Outputs
- This file (Phase 3 section).
- `docs/decisions.md`: DECISION-108.
- `docs/backlog.md`: B-06 closed out; B-86 added.
- No code written.

### Open questions / handoff notes
- Use the **full-stack-developer** agent for the whole thing (small and tightly coupled: one route method, one query function, one small client component, one copy edit, plus tests).
- Do not clobber other pipelines' uncommitted work: `src/lib/db/schema.ts` (comment-only edit, minimal `Edit`), `docs/*`, and the `guide/guardrails-section.tsx` / `guide/settings-section.tsx` files are in use elsewhere. Do not commit or push.
- Optional follow-up for the orchestrator: `UUID_RE` is copy-pasted in `ledger-queries.ts` and `budget-context/route.ts`; once `isUuid` exists in `utils.ts`, a small cleanup can migrate both.
- qa: run the live-database checks listed in Phase 3, especially the closed-session 409 leaving every row unchanged.
