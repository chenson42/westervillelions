# Transaction Receipt Upload — Work Log

> **Slug:** `2026-07-21-transaction-receipts`
> **Surface:** (dashboard) admin — The Ledger (transaction form + transaction views)
> **Permission(s):** likely existing `LEDGER_RECORD` (same gate as the form fields) — Phase 1/3 to confirm
> **Estimated complexity:** medium
> **Pipeline mode:** Full — upload flow + image processing + storage reuse; no new table expected (`receipt_url` column already exists)

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-07-21 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-07-21 |
| 3 — Technical design | tech-lead | Complete | Design complete, implementer named | 2026-07-21 |
| 4 — Implementation | database-admin → api-developer → ux-developer → api-developer (loop-back fix) | Complete | Loop-back fix applied (small-file receipt-view corruption) | 2026-07-21 |
| 5 — Verification | qa | Complete | PASS | 2026-07-21 |
| 6 — Shipped vs intent | analyst | Complete | SHIP IT | 2026-07-21 |

---

## Intent (user request, 2026-07-21)

"I am getting a compliance warning that an expense transaction is missing a
receipt url but I see no place to add a receipt. 1. Where do you enter the
receipt url? 2. We are going to have to store the receipts in the database —
let's add that feature. When uploading pictures we should scale them down to
make them small but still legible."

**Root gap (verified):** `ledger_transactions.receipt_url` exists
(schema.ts:645, comment "upload UX deferred to inc2") and the compliance
overview counts `flow='expense' AND receipt_url IS NULL` as a warning input
(`ledger-queries.ts` ~685), but the transaction form has **zero** receipt
fields — the guardrail flags a field no UI can populate.

**Existing infrastructure to reuse (verified):**
- `src/lib/receipt-storage/` — adapter with `vercel-blob.ts` (production,
  `BLOB_READ_WRITE_TOKEN`) and `local.ts` (dev, `.receipt-store/`), built for
  member reimbursements per DECISION-020.
- `src/lib/receipt-magic-bytes.ts` — server-side file-type validation.

**Requirements from the user:**
1. Ability to attach a receipt to a ledger expense transaction (create + edit),
   clearing the compliance warning for that row.
2. Image uploads are scaled down before storage — "small but still legible."
3. Note on "store in the database": the recommended implementation is the
   established DECISION-020 pattern — file bytes in blob storage, URL in the
   `receipt_url` column — NOT raw bytes in Postgres. Architect to confirm in
   Phase 2; user informed of this recommendation at kickoff.

---

# Phase 1 — Functional Refinement (analyst)

**Owner:** analyst
**Status:** complete

### Summary

The ask is real and the guardrail-vs-form gap is confirmed: `ledger_transactions.receiptUrl`
exists and is already wired through both API routes (`route.ts:132/252`,
`[id]/route.ts:145/283-284`) as a free-text, paste-a-URL field, but zero components in
`src/components/admin/ledger/` or `src/app/(dashboard)/admin/ledger/` render or read it — it's a
dead field. The compliance guardrail (`src/lib/ledger.ts` Check 11, fed by
`txnsWithoutReceipt` in `src/lib/ledger-queries.ts:684`) counts every `flow='expense'` row with a
null `receiptUrl`, at INFO severity, with no link from the count to the offending rows. The
member-reimbursement flow (`src/lib/receipt-storage/`, `receipt-magic-bytes.ts`, upload +
proxy-view routes, DECISION-020) is the right precedent to copy — but copying it exposes a
column-shape problem the work-log's framing doesn't fully capture (see Gap 1 below). Verdict:
**READY WITH NOTES** — the shape of the feature is clear, but two decisions (historical-row
backlog handling, and the `receiptUrl` column's security model) should be locked before Phase 3
design, not discovered mid-build.

### User verbs (surface: Admin — `(dashboard)/admin/ledger`)

- Admin (LEDGER_RECORD): attach a receipt while **creating** a new expense transaction.
- Admin (LEDGER_RECORD): attach a receipt to an **existing** expense transaction with none —
  this is the primary flow; it's the one that clears the compliance warning and is what the user
  hit the wall on.
- Admin (LEDGER_RECORD): **replace** an existing receipt.
- Admin (LEDGER_RECORD): **remove** an existing receipt (via `<ConfirmDialog>`, not
  `window.confirm`).
- Admin (LEDGER_VIEW — broader than LEDGER_RECORD, per the reimbursement precedent): **view** an
  attached receipt from the transaction row/detail.

No verb here belongs to a signed-in member or anonymous visitor — this is 100% an admin/Ledger
surface. Good: the request never says "the user" ambiguously: it's scoped to the transaction form
throughout.

### Flows

**Flow A — Attach on create**
Entry: Admin with `LEDGER_RECORD` opens "Record Transaction" (`TransactionFormDialog` →
`TransactionForm`) → selects Type = Expense → fills amount/date/category/party/memo as today →
**new step:** picks a receipt file (image or PDF) → if image, client downscales before upload →
submits.
Success: toast "Transaction recorded (FY…)"; the new row carries a receipt indicator.
Failure (unaddressed by the request): upload fails (network blip, oversized file, blob token
issue). Recommend the same two-step pattern reimbursements use — `POST .../upload` returns an
opaque key *before* the transaction is submitted — so a failed upload never blocks or corrupts
the transaction save. The user should be able to save the transaction without a receipt and
attach one later via Flow B. This needs to be an explicit design choice, not an accident of
whichever field happens to submit first.

**Flow B — Attach later on edit (primary flow; clears the warning)**
Entry: Admin opens the edit dialog on an expense row with `receiptUrl` null (this is every one of
the ~147 seeded historical rows) → sees "No receipt attached" + an upload control → picks a file
→ downscale if image → submits PATCH.
Success: row's indicator becomes "View receipt"; the guardrail count decrements by one on next
load.
Failure: upload fails → human-readable toast, row unchanged, count does not decrement (stays
honest — good, as long as the error path is actually wired, which today's reimbursement upload
route already models well: 400 for bad type/size, 401/403 for auth).

**Flow C — Replace**
Entry: edit dialog on a row with an existing receipt → sees current filename + "Replace" → picks
new file → old row value is overwritten. Reimbursements' precedent (per code comment in
`[id]/route.ts:227`) does **not** delete the old blob — "orphan cleanup deferred." Recommend
matching that precedent here for consistency unless tech-lead wants to fix storage hygiene in
this pass; flagging as a low-priority open item either way.

**Flow D — Remove**
Entry: edit dialog → "Remove receipt" → `<ConfirmDialog>` (never `window.confirm`) → confirm →
PATCH nulls the key → guardrail count increments back for that row (correct — it should, the row
genuinely has no receipt again).

**Flow E — View**
Entry: transaction row/detail → "View receipt" link, for rows that have one → opens through a new
server-side proxy route (mirroring `GET /api/admin/ledger/reimbursements/[id]/receipt`) →
success: PDF/image streams inline with `Content-Disposition: inline`.
Failure: 404 "Receipt file not found" if the underlying blob is missing — needs to render as
human copy in the viewer, not a raw JSON body, since this route will likely be opened directly in
a new tab.

### Permissions

- Attach / replace / remove: **existing `LEDGER_RECORD`** ("Record, edit, and delete ledger
  transactions") — no new `FEATURES` key. This is a field on the transaction, gated the same as
  every other field in the form.
- View: **existing `LEDGER_VIEW`**, not `LEDGER_RECORD` — matches the reimbursement precedent,
  where the admin receipt-proxy route gates on `LEDGER_VIEW` (`src/app/api/admin/ledger/
  reimbursements/[id]/receipt/route.ts`) so board members who can see the books but not edit them
  can still open a receipt. No new key needed here either.

### Gaps the request didn't address

1. **The `receiptUrl` column's security model doesn't match what "upload" implies.**
   `ledger_transactions.receiptUrl` (`schema.ts:645`) is a plain `text` column, explicitly
   designed as a paste-a-URL field per DECISION-018 ("remains a paste-URL text field for now — no
   file-upload UX ... in inc2"), and it's still wired that way in both transaction routes today.
   DECISION-020 solved exactly this problem for reimbursements by renaming their equivalent
   column to `receipt_storage_key`, storing an opaque key instead of a URL, and forcing all reads
   through an auth-gated proxy route rather than a client-visible URL. Building an upload UI on
   top of the *current* `receiptUrl` shape (as-is) would either (a) require inventing a second,
   inconsistent storage convention for transactions, or (b) tempt someone to store a raw Blob URL
   in a column that's rendered directly, reopening the exact URL-exposure window DECISION-020
   closed. **Recommendation:** treat this as a required part of the design, not an optional
   cleanup — rename the column to `receipt_storage_key`, add an upload route
   (`POST /api/admin/ledger/transactions/upload`, gated `LEDGER_RECORD`) and a proxy view route
   (`GET /api/admin/ledger/transactions/[id]/receipt`, gated `LEDGER_VIEW`), and drop the free-text
   `receiptUrl` request field from the transaction API. Flagging explicitly for architect/
   tech-lead confirmation since the work-log's "no new table expected" framing is correct but
   undersells that the *existing* column needs to change shape.

2. **The 147 historical expense rows have no receipt and, per the user, mostly never will.** The
   guardrail (`ledger.ts` Check 11) is a flat count with no per-row acknowledge/waive mechanism —
   it will report roughly the same number indefinitely no matter how good this feature is, because
   the backlog is not obtainable. This is a real product question, not just an edge case:
   - Option A: ship upload capability only; the INFO count stays elevated forever for genuinely
     unrecoverable historical rows. Honest but not actionable — the treasurer can never drive the
     number toward zero.
   - Option B: add a lightweight per-row "receipt not available (historical)" flag that excludes
     the row from the count, with an audit trail (who waived it, when, why) so it doesn't become a
     silent escape hatch for new transactions going forward.
   - **Recommendation:** default to Option A for this increment (ship upload only; treat the
     backlog as a separately-scoped decision) unless the user wants Option B now — Option B adds a
     column, a permission question (who can waive?), and audit-log surface that's a meaningfully
     bigger ticket. Flagging as the top open question below rather than assuming.

3. **No link from the guardrail count to the flagged transactions.** Today the compliance panel
   (`ledger-entity-detail.tsx`) renders "`N` expense transactions ... have no receipt URL
   attached" as a bare count with no way to jump to those rows. Without a filter/link, the
   treasurer has to hunt across the transaction list to find which rows the warning refers to,
   which undermines the whole point of adding upload capability. Recommend adding a "view flagged
   transactions" affordance (filter param on the transaction list) alongside this feature — small
   addition, large day-to-day usability gain.

4. **Non-expense receipts.** The guardrail only ever counts `flow='expense'` rows, so attaching a
   receipt to an income or transfer row clears no warning. Recommend allowing the field to render
   for any flow (some treasurers like keeping deposit slips too) but scoping the *warning-clearing*
   logic to expense only, matching current behavior — unless the user wants expense-only visibility
   for v1, which is also fine, just needs to be a stated choice.

5. **Client-side image downscaling is genuinely new code** — grepped the repo; there's no
   existing canvas-resize or image-compression logic anywhere, including in the reimbursement
   upload flow (which accepts full-size images as-is up to 10 MB). "Small but still legible" is a
   real tension the request names but doesn't quantify — concrete target (max dimension / quality
   / KB target) is tech-lead's call per the user's own framing, but this is not a trivial reuse of
   existing code the way the storage adapter is.

6. **Mobile camera capture.** The reimbursement file input (`reimbursement-form.tsx:208-218`) uses
   `accept=".pdf,.jpg,.jpeg,.png"` with no `capture` attribute. Most mobile browsers still offer
   "Take Photo" in the picker without it, but adding `capture="environment"` would default straight
   to the camera for the "treasurer snaps a photo at the store" case the user's phrasing implies.
   Minor, worth doing, not blocking.

7. **Failure microcopy / blob-token-missing-in-prod.** Per DECISION-020 and the CLAUDE.md note on
   `BLOB_READ_WRITE_TOKEN`, if that token is absent in production the storage adapter silently
   falls back to the ephemeral local-filesystem adapter and receipts are lost on redeploy. This
   feature inherits that risk from the existing reimbursement infrastructure rather than
   introducing a new one, but it doubles the surface depending on it. Not a Phase 1 blocker;
   flagging for deployment-engineer to confirm the token is actually set in production before this
   ships (pre-push checklist item, not new work).

### Adversarial pass

- **Upload route must gate `LEDGER_RECORD` server-side**, not just hide the control in the UI —
  mirrors the reimbursement upload route's `session.user.memberId` check, adapted to
  `hasFeature(session.user.id, FEATURES.LEDGER_RECORD)`.
- **View/proxy route must gate `LEDGER_VIEW` server-side** and, per the reimbursement precedent's
  own documented policy (404 not 403 for missing/mismatched IDs), return 404 rather than
  distinguishing "doesn't exist" from "no permission." Transaction IDs are an internal admin-only
  surface (no member-facing equivalent), so enumeration risk is lower than reimbursements, but
  consistency argues for the same 404 behavior.
- **Server-side magic-byte validation is required regardless of client-side downscaling** — the
  client resize is a UX nicety, never a trust boundary. Reuse `validateMagicBytes()` directly; do
  not skip it because "the client already resized it into a real image."
- **Storage-key format validation on the transaction PATCH/POST body** must mirror reimbursements'
  `RECEIPT_KEY_REGEX` (`^receipts\/[0-9a-f-]{36}\/[a-zA-Z0-9._-]{1,150}$`) — never accept an
  arbitrary client-supplied string into what becomes `receipt_storage_key`.
- **No redirect targets** (`callbackUrl`/`next`) are in play on this surface — not applicable.
- **Self-targeting**: not applicable — admin-only internal financial data, no member-facing
  equivalent to escalate through.
- **Input boundaries**: oversized/corrupt file and the 10 MB cap are already proven at the
  reimbursement upload route; reuse directly rather than re-deriving.

### Out of scope (confirm with user)

- Bulk/batch backfill tooling for the historical 147 rows (as opposed to one-at-a-time via edit).
- OCR or auto-extraction of amount/date from the receipt image.
- A per-row "waive/no-receipt-available" flag and its audit trail (see Gap 2) — treating this as
  a separate decision, not assumed in scope.
- Attaching receipts to income/transfer rows (see Gap 4) — leaning toward "allow the field, but
  don't count it in the warning," but confirming.

### Open questions (for the user)

1. **Historical backlog (Gap 2):** ship upload capability only and let the compliance count sit
   near 147 indefinitely for genuinely unrecoverable old receipts, or do you want a "receipt not
   available (historical)" waiver mechanism now? Recommending the former for this increment unless
   you say otherwise — the latter is a bigger ticket (new column, permission question, audit log).
2. **Non-expense rows (Gap 4):** should the receipt field appear on income/transfer transactions
   too (for general record-keeping), or expense-only for v1, matching where the warning applies?
3. **Guardrail-to-list link (Gap 3):** want the "N transactions missing receipt" panel to link
   straight to a filtered transaction list in this same increment, or is that a fast follow?

### Outputs

- No files changed outside this work-log (Phase 1 is read-only).
- Reviewed: `src/lib/db/schema.ts:645`, `src/lib/ledger-queries.ts:650-690`, `src/lib/ledger.ts:719-800`,
  `src/app/api/admin/ledger/transactions/route.ts`, `src/app/api/admin/ledger/transactions/[id]/route.ts`,
  `src/components/admin/ledger/transaction-form.tsx`, `src/components/admin/ledger/transaction-actions.tsx`,
  `src/components/admin/ledger/ledger-entity-detail.tsx`,
  `src/app/api/members/reimbursements/upload/route.ts`, `src/app/api/admin/ledger/reimbursements/[id]/receipt/route.ts`,
  `src/lib/receipt-storage/`, `src/lib/receipt-magic-bytes.ts`, `src/components/members/reimbursement-form.tsx`,
  `docs/decisions.md` DECISION-018/019/020.

### Open questions / handoff notes for architect (Phase 2)

- Confirm the column-rename + opaque-key + proxy-route approach (Gap 1) rather than reusing
  `receiptUrl` as a paste-URL field — this is the single biggest structural decision in this
  ticket and should be locked before tech-lead writes the Phase 3 design.
- Confirm whether client-side image downscaling needs a new dependency (e.g., canvas-based
  hand-rolled resize vs. a small compression library) — no existing precedent in the codebase to
  copy, unlike the storage adapter.

---

## User decisions (2026-07-21, answered via AskUserQuestion — resolves Phase 1's open questions)

1. **Historical rows: WAIVER SHIPS IN THIS INCREMENT.** Each row can be marked
   "no receipt available" with a recorded reason; waived rows stop counting
   toward the compliance warning, so the count can genuinely reach zero.
   (Upload-only-defer-waiver and exclude-pre-app-rows were offered and
   declined.)
2. **Scope: EXPENSES ONLY.** No receipt field on income or transfer rows.
3. **Warning becomes actionable:** the missing-receipt compliance warning links
   to a filtered list of the offending expense rows in this same increment.

---

# Phase 2 — Architectural Review (architect)

**Owner:** architect
**Status:** complete

### Summary

**Verdict: Approved with suggestions.** Phase 1's structural read is correct on every count I could verify against the live schema and the reimbursement precedent it's copying: `receipt_url` is confirmed dead (0 of 147 expense rows have a non-null value — verified with a read-only query), the DECISION-020 opaque-key + proxy-route pattern is the right target shape, and client-side canvas resizing needs no new dependency. The one place Phase 1's framing needed correcting: the codebase's actual precedent for a permission-tier step-up on a transaction (`/approve`, `/reject`, `/reconcile`, `/acknowledge` are all separate sibling sub-routes off `[id]/route.ts`, never conditional fields folded into the shared PATCH) argues for a dedicated waiver route, not a field-conditional check inside the existing PATCH handler. Full rulings below.

### What I did

- Read `src/lib/db/schema.ts` (`ledgerTransactions`, `ledgerReimbursements`) and confirmed the exact DECISION-020 shape already in production for reimbursements: `receiptStorageKey: text("receipt_storage_key").notNull()`.
- Ran a read-only query against the local DB: `SELECT count(*), count(receipt_url) FROM ledger_transactions WHERE flow='expense'` → **147 total, 0 non-null**. The rename is a clean, data-free structural change — no backfill, no dual-write period, no "what happens to existing values" branch needed.
- Read both transaction route handlers (`transactions/route.ts:132/252`, `transactions/[id]/route.ts:145/283-284`) — confirmed `receiptUrl` is a free-text pass-through field in both POST and PATCH bodies today, exactly as Phase 1 described.
- Read `src/lib/receipt-storage/index.ts`, the reimbursement upload route (`src/app/api/members/reimbursements/upload/route.ts`), and both `RECEIPT_KEY_REGEX` definitions (`src/app/api/members/reimbursements/route.ts:42`, `[id]/route.ts:48`) to confirm the key format, the sanitize/UUID scheme, and the adapter's collision model.
- Read the admin reimbursement receipt proxy route (`src/app/api/admin/ledger/reimbursements/[id]/receipt/route.ts`) as the exact shape to mirror: `auth()` → `hasFeature(LEDGER_VIEW)` → 404 on missing row or missing blob → stream bytes with `Cache-Control: no-store`, never a redirect.
- Grepped `src/lib/permissions.ts` for the full `LEDGER_*` catalog (`LEDGER_VIEW`, `LEDGER_RECORD`, `LEDGER_MANAGE`, `LEDGER_APPROVE`) to ground the waiver-gating argument in the keys that actually exist, rather than assuming a new one is needed.
- Read `src/lib/ledger.ts` (Check 11) and `src/lib/ledger-queries.ts:685` (`txnsWithoutReceipt`) to confirm exactly where the guardrail input needs to change for both the column rename and the waiver exclusion.
- Checked `package.json` for any existing image-processing dependency (`sharp`, `pica`, `browser-image-compression`, etc.) — none present, confirming the canvas-resize approach is genuinely dependency-free.
- Found the existing sibling-route precedent for permission-tier separation on a transaction: `src/app/api/admin/ledger/transactions/[id]/{approve,reject,reconcile,acknowledge}/route.ts` all exist as standalone route files next to `[id]/route.ts`, each presumably with its own gate, rather than being conditional branches inside the shared PATCH handler (`[id]/route.ts:99` and `:376` both gate the whole handler on a single flat `LEDGER_RECORD` check — no field-conditional permission pattern exists in that file today).
- Read `src/app/(dashboard)/admin/ledger/[fundSlug]/page.tsx:64-83` and `.../compliance/page.tsx` to confirm the existing query-param filter convention (`?entity=&fy=`) and that `getOverview()` (hence `guardrailFlags`) is computed per-entity-per-fiscal-year across all of that entity's funds (`ledger-queries.ts` ~982), while the only filterable transaction list is fund-scoped.

### Rulings

**1. Column shape — RENAME, not add-new-and-drop.**
`receipt_url` → `receipt_storage_key text` (nullable — see note below), following DECISION-020 exactly. The zero-non-null read confirms there is no data-migration branch to design: this is a pure rename, no backfill logic, no dual-column transition period. Nullable (unlike reimbursements' `NOT NULL`) because unlike a reimbursement request — which cannot exist without a receipt — an expense transaction legitimately can (that's the whole reason the waiver mechanism exists). Migration must guard the rename for idempotency (a bare `RENAME COLUMN` fails on the second deploy once the new name already exists) — standard `DO $$ … IF EXISTS/IF NOT EXISTS … END $$` guard, per CLAUDE.md's migration rules; exact SQL is database-admin's to write in Phase 4. The free-text `receiptUrl` field must be dropped from both transaction route bodies (`route.ts:132/252`, `[id]/route.ts:145/283-284`) and replaced with a `receiptStorageKey` field accepted **only** as the opaque key returned by the new upload route, validated against the same `RECEIPT_KEY_REGEX` shape used by reimbursements before being written. The guardrail input at `ledger-queries.ts:685` changes from `!t.receiptUrl` to `!t.receiptStorageKey && !t.receiptWaivedAt` (waiver ruling below).

**2. Waiver mechanism — columns on `ledger_transactions`, not a side table; gated `LEDGER_MANAGE`.**
Data shape: three nullable columns directly on `ledger_transactions` — `receiptWaivedAt timestamp`, `receiptWaivedByUserId uuid references users(id) on delete set null`, `receiptWaiverReason text`. This is not a new pattern for this table: `approvedAt` / `approvedByUserId` / `rejectionReason` already live on this exact table for the approve/reject workflow, and this is the same shape — a 1:1, low-cardinality annotation with who/when/why, not a 1:many relationship that would justify a side table (contrast `ledgerDonors`/`ledgerAcknowledgments`, which model real 1:many joins). Reversibility matches the `sync_stale` (DECISION-025) precedent of "clear the fields to undo" rather than a append-only audit log — the user asked for a recorded reason, not a history of every waive/unwaive cycle, so a bare boolean (`sync_stale`'s shape) isn't quite enough but a full audit table is more than was asked for. Un-waiving = null out all three columns; guardrail exclusion becomes `!t.receiptStorageKey && !t.receiptWaivedAt`.

Gating — **`LEDGER_MANAGE`, argued, not defaulted:** waiving suppresses a compliance signal; it's a judgment call about whether a control requirement applies to a row, not an ordinary bookkeeping edit. The codebase already treats "authority over how a recorded transaction's compliance status is judged" as a step up from "recording" it — that's precisely why `LEDGER_APPROVE` exists as a key distinct from `LEDGER_RECORD` for approve/reject, even though both act on rows a recorder already touched. `LEDGER_RECORD` ("record, edit, and delete ledger transactions") is the widely-held, routine-bookkeeping permission; `LEDGER_MANAGE` ("manage funds, budgets, entities, and opening balances") is already the club's placeholder for structural/governance-level authority over the books. If waiving were gated on `LEDGER_RECORD`, anyone who can enter a transaction could also silently zero out the compliance count — reopening exactly the "silent escape hatch" risk Phase 1's Gap 2 named. Binding to `LEDGER_MANAGE` keeps that boundary real. No new `FEATURES` key needed. Attaching an actual receipt (which also clears the flag, via a real file rather than a waiver) remains gated `LEDGER_RECORD`, unchanged from Phase 1.

Route shape for the waiver action: the existing precedent for a permission-tier step-up on a transaction is a **dedicated sibling sub-route**, not a conditional branch inside the shared PATCH — `[id]/approve`, `[id]/reject`, `[id]/reconcile`, and `[id]/acknowledge` all exist as standalone files next to `[id]/route.ts`, and `[id]/route.ts` itself gates its *entire* handler on one flat `LEDGER_RECORD` check with no field-conditional logic today. Recommend `PATCH /api/admin/ledger/transactions/[id]/receipt/waive` (or `/waiver`), gated `LEDGER_MANAGE` on its own, rather than teaching the shared PATCH handler a new "if this field is present, also require a different permission" branch it has never needed before. Exact route name is Phase 3's to finalize.

**3. Client-side image downscaling — canvas API, no new dependency; confirmed.**
Checked `package.json`: no `sharp`, `pica`, `browser-image-compression`, or any image-processing package is present, and none is needed — `<canvas>`, `HTMLCanvasElement.toBlob()`, and `createImageBitmap()`/`FileReader` are standard browser APIs sufficient for "pick dimensions, draw scaled, re-encode as JPEG at a quality setting." This is genuinely new code with no repo precedent (confirmed — Phase 1's grep was right), so placement matters: put the pure, unit-testable part — a function like `computeResizeDimensions(width, height, maxDimension)` (and any quality/size-target math) — in a new `src/lib/image-resize.ts`, importable and testable without a DOM. Keep the actual canvas-drawing/`toBlob` glue thin and colocated in the client component that owns the file input (`src/components/admin/ledger/`). This mirrors the existing client-safe/server-only split already established between `permissions.ts` and `permissions-server.ts` — pure logic separated from the environment-bound shell around it. PDFs pass through unresized; only image MIME types get the downscale step. Non-negotiable regardless of what ships here: server-side `validateMagicBytes()` and the 10 MB cap remain authoritative in the upload route — client resize is a UX nicety, never a trust boundary, per Phase 1's adversarial pass. Tech-lead sets the concrete max-dimension/quality target.

**4. Storage adapter reuse — as-is, no new namespace/prefix.**
The reimbursement upload route mints keys as flat `receipts/<uuid>/<sanitized-name>` (`src/app/api/members/reimbursements/upload/route.ts:82-85`); collision-safety comes entirely from the random UUID segment, not from any semantic grouping. Ledger-transaction receipts can use the identical key shape in the identical bucket/adapter with zero collision risk and zero need for a `receipts/transactions/...`-style prefix — inventing one would fragment the key format for no operational benefit, especially since DECISION-020 already accepts "no orphan-cleanup tooling" as a known gap that a prefix wouldn't fix anyway. **Suggestion (non-blocking):** `RECEIPT_KEY_REGEX` (`^receipts\/[0-9a-f-]{36}\/[a-zA-Z0-9._-]{1,150}$`) is already duplicated verbatim across two reimbursement route files; this feature makes a third copy. Recommend the implementer hoist it into a single shared export (e.g., `src/lib/receipt-storage/index.ts`) and import it at all three call sites — pure DRY cleanup, not a gating or placement concern, and not a blocker for this review.

**5. Placement — confirmed, with one correction to the prompt's suggested shape.**
- `GET /api/admin/ledger/transactions/[id]/receipt/route.ts` (gate `LEDGER_VIEW`) — confirmed, mirrors the reimbursement proxy route exactly (stream bytes, 404 on missing row or missing blob, `Cache-Control: no-store`, never a redirect).
- Upload should **not** nest under `[id]` — the reimbursement precedent's upload route is deliberately flat (`POST /api/members/reimbursements/upload`, no `[id]` in the path) because the record doesn't exist yet at upload time; the key is minted first and attached afterward. Transactions have the identical ordering problem: Flow A (Phase 1) attaches a receipt *while creating* a new transaction, before any `id` exists. Recommend `POST /api/admin/ledger/transactions/upload/route.ts` (gate `LEDGER_RECORD`), flat like its precedent, used by both the create flow (Flow A) and the edit flow (Flow B — the id is irrelevant to the upload step either way; it's supplied afterward in the transaction POST/PATCH body).
- Waiver action: new dedicated route, not a field inside the shared PATCH — see Ruling 2's route-shape argument above.
- Client components stay in `src/components/admin/ledger/` (extending `transaction-form.tsx` for attach/replace, `transaction-actions.tsx` or a new small waiver-dialog component for the waiver flow) — confirmed, no new top-level directory needed. New pure helper module: `src/lib/image-resize.ts`.

**6. Invariants — all honorable within this shape; nothing here requires bending an existing rule.**
- Both new routes (and the waiver route) must independently re-check `auth()` + `hasFeature()` server-side — the UI hiding a control is not a security boundary, matching Phase 1's adversarial pass.
- Migration must be idempotent: the rename needs an existence-guard (see Ruling 1); the three new waiver columns use `ADD COLUMN IF NOT EXISTS`.
- `schema.ts` changes first, then the matching migration — standard order, no exception here.
- No native dialogs: "Remove receipt" and the waiver confirmation both use `<ConfirmDialog>`; the reason-entry field for a waiver is an ordinary form field inside a shadcn `Dialog` (or inline in the edit form), never a `prompt()`.
- `capture="environment"` on the file input is a plain HTML attribute, zero dependency, confirmed feasible — non-blocking per Phase 1 Gap 6.

**7. Filtered-list link — reuse the existing fund register surface; one scope wrinkle for tech-lead.**
`src/app/(dashboard)/admin/ledger/[fundSlug]/page.tsx` already accepts `entity` and `fy` query params (confirmed at lines 64-83) — this is the right place to add a new filter param (e.g., `?receipt=missing`) rather than a new page, consistent with instruction 7's preference and the existing convention. One real wrinkle: `getOverview()` (and therefore `guardrailFlags`) is computed **per-entity-per-fiscal-year across all of that entity's funds** (`ledger-queries.ts` ~982), but the only filterable transaction list today is **fund-scoped**, one fund at a time. Tech-lead needs to decide whether the guardrail link targets a specific fund's register (acceptable if flagged rows cluster there) or whether the fund-register page needs an "all funds for this entity" mode to honestly represent the full flagged set — either resolution stays inside the existing `[fundSlug]` route surface, so this does **not** require a new page or directory. Also worth noting for Phase 3/whichever implementer touches `src/lib/ledger.ts`: `GuardrailFlag` currently has no link/href field; recommend adding an optional `linkHref?: string` so both rendering call sites (`ledger-entity-detail.tsx`, `compliance/page.tsx`) can render any actionable flag generically instead of special-casing Check 11 in two components.

### Decision log

Per this repo's established precedent (and this review's instructions), a `docs/decisions.md` entry is warranted here — the column-shape migration (rename + nullable + waiver columns) and the storage-key reuse are exactly the kind of structural call this log exists for. **Deferring the write to Phase 3**, as tech-lead will be the one finalizing exact column names/route names/migration numbering; I'm flagging explicitly rather than writing a placeholder now so the numbering and final shape aren't duplicated or contradicted.

### Outputs

- No files changed outside this work-log — Phase 2 is read-only on source, per this review's scope.
- Verified via read-only query: `SELECT count(*), count(receipt_url) FROM ledger_transactions WHERE flow='expense'` → 147 / 0 (local DB).
- Reviewed: `src/lib/db/schema.ts` (`ledgerTransactions` ~623-679, `ledgerReimbursements` ~779-800), `src/lib/permissions.ts` (LEDGER_* keys), `src/lib/ledger.ts` (Check 11, ~776-782), `src/lib/ledger-queries.ts` (~685, ~982, ~1146, ~1251/1304), `src/app/api/admin/ledger/transactions/route.ts`, `src/app/api/admin/ledger/transactions/[id]/route.ts` (incl. `/approve`, `/reject`, `/reconcile`, `/acknowledge` sibling routes), `src/app/api/members/reimbursements/upload/route.ts`, `src/app/api/admin/ledger/reimbursements/[id]/receipt/route.ts`, `src/app/api/members/reimbursements/route.ts` + `[id]/route.ts` (`RECEIPT_KEY_REGEX`), `src/lib/receipt-storage/index.ts`, `src/app/(dashboard)/admin/ledger/[fundSlug]/page.tsx`, `src/app/(dashboard)/admin/ledger/compliance/page.tsx`, `src/components/admin/ledger/ledger-entity-detail.tsx`, `package.json`, `docs/decisions.md` DECISION-018/019/020/025.
- No `docs/decisions.md` entry written this phase — deferred to Phase 3 (see Decision log above).

### Open questions / handoff notes for tech-lead (Phase 3)

- Finalize exact route names for the new upload route (`.../transactions/upload`) and waiver route (`.../transactions/[id]/receipt/waive` or similar) and write the DECISION-0NN entry covering: the column rename shape, the three waiver columns, the `LEDGER_MANAGE` gating argument, and the storage-key reuse (no new namespace).
- Resolve the fund-scoped-vs-entity-scoped mismatch on the guardrail link (Ruling 7) before wiring the "view flagged transactions" affordance — decide fund-register link vs. an entity-wide filtered view.
- Decide whether `GuardrailFlag` gets a generic `linkHref?: string` field now (recommended) or whether Check 11's link is special-cased in the two rendering components for this increment.
- Set the concrete downscale target (max dimension / JPEG quality / KB ceiling) for `src/lib/image-resize.ts` — Phase 1 and this review both defer that number to tech-lead.
- Confirm with database-admin the idempotent-rename SQL shape (existence-guarded `DO $$ … END $$`) for `receipt_url` → `receipt_storage_key`, and `ADD COLUMN IF NOT EXISTS` for the three waiver columns, in the same migration file.
- Non-blocking cleanup suggestion carried forward: hoist `RECEIPT_KEY_REGEX` to a shared location before a third copy is pasted in.

---

# Phase 3 — Technical Design (tech-lead)

**Owner:** tech-lead
**Status:** complete
**Date:** 2026-07-21

## Technical Design: Transaction Receipt Upload + Waiver (The Ledger)

### Summary

Expense transactions currently have a dead `receiptUrl` free-text column with zero UI and a
compliance guardrail (Check 11) that flags 147 rows against a field no one can populate. This
increment: (1) renames the column to `receiptStorageKey` and wires it through the same
opaque-key + storage-adapter + proxy-route pattern DECISION-020 already established for member
reimbursements, giving admins real upload/replace/remove/view for expense receipts; (2) adds a
three-column waiver mechanism (`receiptWaivedAt`/`receiptWaivedByUserId`/`receiptWaiverReason`,
gated `LEDGER_MANAGE`) so the historical 147-row backlog can genuinely reach zero without becoming
a silent escape hatch for new transactions; (3) client-side downscales image receipts before
upload ("small but still legible" — concrete numbers below); and (4) makes the guardrail count
actionable by linking it to the actual flagged rows. No new `FEATURES` keys. One column rename
(data-free — 0/147 non-null, verified in Phase 2), three new nullable columns, no new tables.

### Permissions

No new `FEATURES` keys — reuses the existing `LEDGER_*` catalog exactly as Phase 1/2 concluded:

| Action | Gate | Notes |
|---|---|---|
| Attach / replace / remove a receipt (create + edit) | `LEDGER_RECORD` | Same gate as every other transaction field. |
| Upload a file (mint a storage key) | `LEDGER_RECORD` | New route, same gate. |
| View / stream a receipt | `LEDGER_VIEW` | Broader than `LEDGER_RECORD` — matches reimbursement precedent; board members who can see books but not edit them can still open a receipt. |
| Waive / un-waive "no receipt available" | `LEDGER_MANAGE` | Step-up from `LEDGER_RECORD` — waiving suppresses a compliance signal, which is a judgment call over how a transaction's compliance status is judged, the same tier distinction that already separates `LEDGER_APPROVE` from `LEDGER_RECORD` for approve/reject. Binding to `LEDGER_MANAGE` keeps "anyone who records a transaction can also silently zero out the compliance count" from becoming true. |

### API Contract

**1. `POST /api/admin/ledger/transactions/upload`** (new, flat — no `[id]`)
Gate: `LEDGER_RECORD`. Mirrors `POST /api/members/reimbursements/upload` exactly (multipart
`file` field, ≤10MB, magic-byte validation via `validateMagicBytes()`, opaque key
`receipts/<uuid>/<sanitized-name>`, persisted via `getReceiptStorage().save()`). Flat, not
`[id]`-scoped, because Flow A (attach while creating) has no transaction id yet — same ordering
problem the reimbursement precedent solved by minting the key before the record exists. Used by
both the create dialog (Flow A) and the edit dialog (Flow B/C).
- Response 200: `{ key: string }`
- Errors: 400 (no file / oversized / unsupported type), 401, 403

**2. `GET /api/admin/ledger/transactions/[id]/receipt`** (new)
Gate: `LEDGER_VIEW`. Mirrors `GET /api/admin/ledger/reimbursements/[id]/receipt` exactly: fetch
the transaction, 404 if not found or `receiptStorageKey` is null, read via
`getReceiptStorage().read()`, 404 if the blob is missing, stream bytes with
`Content-Disposition: inline` and `Cache-Control: no-store, no-cache, must-revalidate`. Never a
redirect; never returns the key/URL to the browser.
- Response 200: raw bytes, `Content-Type` set from storage
- Errors: 401, 403, 404 (row not found / no receipt attached / blob missing)

**3. `POST /api/admin/ledger/transactions/[id]/receipt/waive`** (new)
Gate: `LEDGER_MANAGE`.
Body: `{ reason: string }` — required, trimmed, capped at **500 chars** (shorter than
`rejectionReason`'s 1000-char cap; a waiver is a short administrative annotation — "predates
online records," "receipt lost, treasurer confirmed" — not a board-minute-grade narrative).
Validation / responses:
- 400 — `flow !== 'expense'` ("Only expense transactions can be waived") or missing/blank reason
- 403 — approved transactions are immutable (same guard `[id]/route.ts` already applies to PATCH — consistency, not a new invariant)
- 404 — transaction not found
- 409 — `receiptStorageKey` already set ("Transaction already has a receipt attached — remove it before waiving")
- 200 — `{ id }`; sets `receiptWaivedAt = now()`, `receiptWaivedByUserId = session.user.id`, `receiptWaiverReason = trimmed`

**`DELETE /api/admin/ledger/transactions/[id]/receipt/waive`** (same file, un-waive)
Gate: `LEDGER_MANAGE`. No body. Clears all three waiver columns to null. 404 if not found; 403 if
approved. 200 `{ id }`. (This restores the guardrail count for that row — correct, matching Flow D's remove-receipt behavior.)

**4. `POST /api/admin/ledger/transactions` — payload change**
Drop `receiptUrl`; add optional `receiptStorageKey?: string`.
- Validated against the shared `RECEIPT_KEY_REGEX` (hoisted — see Data Model).
- 400 if provided and `flow !== 'expense'` ("Receipts can only be attached to expense transactions").
- Stored as-is (already opaque; no further trust needed beyond regex + the fact that a bogus key just 404s on view).

**5. `PATCH /api/admin/ledger/transactions/[id]` — payload change**
Drop `receiptUrl`; add optional `receiptStorageKey?: string | null`.
- `null` → Flow D (remove). Non-null → Flow B/C (attach/replace), regex-validated, 400 if the
  *effective* flow (after applying any simultaneous `flow` change, using the existing `newFlow`
  pattern already in this handler for category validation) is not `'expense'`.
- **Setting a non-null `receiptStorageKey` clears any existing waiver** in the same `UPDATE`
  statement (`receiptWaivedAt`/`receiptWaivedByUserId`/`receiptWaiverReason` → null) — see Edge
  Cases for the ruling.
- Setting `null` (remove) does **not** touch waiver fields — removing a receipt is not the same
  as waiving it; the guardrail should re-flag the row, exactly as Phase 1's Flow D specified.

### Data Model

`src/lib/db/schema.ts` — `ledgerTransactions`:
```ts
// receiptUrl → receiptStorageKey: rename, still nullable (unlike reimbursements' NOT NULL —
// an expense transaction legitimately can lack a receipt; that's why waiver exists).
receiptStorageKey: text("receipt_storage_key"), // opaque key `receipts/<uuid>/<name>`; DECISION-035
// Waiver — mirrors approvedAt/approvedByUserId/rejectionReason's shape on this same table.
receiptWaivedAt: timestamp("receipt_waived_at"),
receiptWaivedByUserId: uuid("receipt_waived_by_user_id")
  .references(() => users.id, { onDelete: "set null" }),
receiptWaiverReason: text("receipt_waiver_reason"),
```
Update the field comment at the old `receiptUrl` line to reflect the rename and cite
DECISION-035. No new tables, no new indexes (low cardinality, point lookups only).

**Migration** `drizzle/migrations/0057_ledger_receipt_waiver.sql` (idempotent — guarded for both
"old name still present" and "already renamed" states, plus plain `ADD COLUMN IF NOT EXISTS` for
the three new columns):
```sql
-- Rename receipt_url -> receipt_storage_key (data-free: 0/147 non-null verified in Phase 2).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ledger_transactions' AND column_name = 'receipt_url'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ledger_transactions' AND column_name = 'receipt_storage_key'
  ) THEN
    ALTER TABLE ledger_transactions RENAME COLUMN receipt_url TO receipt_storage_key;
  END IF;
END $$;

ALTER TABLE ledger_transactions ADD COLUMN IF NOT EXISTS receipt_waived_at timestamp;
ALTER TABLE ledger_transactions ADD COLUMN IF NOT EXISTS receipt_waived_by_user_id uuid
  REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE ledger_transactions ADD COLUMN IF NOT EXISTS receipt_waiver_reason text;
```
(Exact final SQL — including any `IF NOT EXISTS` wrapping quirks Drizzle/Neon requires — is
database-admin's to verify against the live schema; this is the sketch.)

**`src/lib/receipt-storage/index.ts`** — hoist the regex (currently duplicated in
`src/app/api/members/reimbursements/route.ts:42` and `[id]/route.ts:48`, about to become a third
copy):
```ts
export const RECEIPT_KEY_REGEX = /^receipts\/[0-9a-f-]{36}\/[a-zA-Z0-9._-]{1,150}$/;
```
Both reimbursement route files switch to importing this instead of a local const; the two new
transaction routes import it too.

**`src/lib/ledger.ts`** — `GuardrailFlag` gains an optional `linkHref?: string` (architect's
recommendation, adopted — lets both rendering call sites handle any actionable flag generically).
`GuardrailsInput` gains `entitySlug: string` and `fiscalYear: number` (both already in scope at
the single call site in `getOverview()` — no new plumbing beyond that). Check 11 becomes:
```ts
if (state.txnsWithoutReceipt > 0) {
  flags.push({
    severity: "info",
    title: "Expenses missing receipt documentation",
    detail: `...` /* unchanged copy, still cites retentionYears */,
    policyCite: "Lions Financial Transparency Policy §11",
    linkHref: `/admin/ledger/all?entity=${state.entitySlug}&fy=${state.fiscalYear}&receipt=missing`,
  });
}
```
New pure exported predicate (so the "waived rows excluded" logic is unit-testable without a DB —
see Named Unit Tests):
```ts
export function isReceiptMissing(t: { flow: string; receiptStorageKey: string | null; receiptWaivedAt: Date | null }): boolean {
  return t.flow === "expense" && !t.receiptStorageKey && !t.receiptWaivedAt;
}
```

**`src/lib/ledger-queries.ts`** — `ledger-queries.ts:685` changes from
`t.flow === "expense" && !t.receiptUrl` to `isReceiptMissing(t)` (imported from `ledger.ts`). The
`guardrails({...})` call site (~line 866) adds `entitySlug: entity.slug, fiscalYear,` (both
already local variables in `getOverview()`). `listTransactions()` gains a new optional filter:
```ts
missingReceipt?: boolean; // flow='expense' AND receiptStorageKey IS NULL AND receiptWaivedAt IS NULL
```
implemented as an additional `conditions.push(...)` using the same `isReceiptMissing` predicate
expressed in Drizzle (`and(eq(flow,'expense'), isNull(receiptStorageKey), isNull(receiptWaivedAt))`),
so the SQL-side filter and the JS-side guardrail-counting filter can never drift apart in meaning
even though they're two different call sites (one is a DB `WHERE`, one is an in-memory `.filter`
over `allTxns` already fetched for the overview computation).

### Component/Page Plan

**New files:**
- `src/lib/image-resize.ts` — pure, unit-testable dimension math (no DOM).
- `src/components/admin/ledger/receipt-file-input.tsx` — client component: file input (`accept=".pdf,.jpg,.jpeg,.png" capture="environment"`), client-side 10MB check, canvas downscale for images, calls the upload route, reports back `{ key, displayName }` to the parent form. Thin DOM glue over `image-resize.ts`'s pure math, same split as `permissions.ts`/`permissions-server.ts`.
- `src/components/admin/ledger/receipt-waiver-control.tsx` — client component rendered per expense row when `canManage` (existing local var in `[fundSlug]/page.tsx`) is true and the row has no receipt: "Waive" button → small `Dialog` with a required reason textarea → POST waive route. If already waived: "Waived — <reason truncated>" badge + "Un-waive" button → `<ConfirmDialog>` (not destructive-styled, but still a confirm — un-waiving re-exposes the compliance flag, worth a confirm) → DELETE waive route.

**Files to modify:**
- `src/components/admin/ledger/transaction-form.tsx` — for `apiFlow === 'expense'` (create and edit, non-transfer): render `<ReceiptFileInput>`; on edit, show current state first ("Receipt attached — View" link / "No receipt" / "Waived: <reason>") with "Replace"/"Remove" affordances; include `receiptStorageKey` in the POST/PATCH body when changed. "Remove" clears it (sets to `null` in the PATCH body) via the existing pattern (no separate route needed — PATCH already accepts `null` to clear other nullable fields).
- `src/app/(dashboard)/admin/ledger/[fundSlug]/page.tsx`:
  - Per expense row: a small receipt-status badge (View link / "No receipt" / "Waived") next to the existing status badge, and `<ReceiptWaiverControl>` when applicable and `canManage`.
  - **`fundSlug === "all"` pseudo-mode** (resolves the architect's flagged fund-vs-entity scope mismatch — see Edge Cases): when the segment is the literal string `all`, skip the single-fund lookup/`notFound()` and the fund-specific balance/budget chrome (those require exactly one fund); render only the shared entity header + the transaction table, built from `listTransactions(entity.id, { fiscalYear, flow: 'expense', missingReceipt: true })` (no `fundId`). This is the only page the guardrail link ever targets; a normal fund slug can also accept `?receipt=missing` as a narrower drill-down, but `all` is the honest one because Check 11 is computed per-entity-across-all-funds.
  - New query param `receipt=missing` — extends the existing `entity=`/`fy=` convention on this same route (per instruction 7), threaded into the `listTransactions()` call.
- `src/components/admin/ledger/ledger-entity-detail.tsx` and `src/app/(dashboard)/admin/ledger/compliance/page.tsx` — inside the existing guardrail-flag `.map()` (both files render the identical block at `ledger-entity-detail.tsx:155-183` and `compliance/page.tsx:181-209`), add:
  ```tsx
  {flag.linkHref && (
    <Link href={flag.linkHref} className="text-xs font-semibold underline mt-1 inline-block">
      View flagged transactions →
    </Link>
  )}
  ```
  Both files already import `Link` — no new import.
- `src/app/api/members/reimbursements/route.ts`, `.../[id]/route.ts` — replace local `RECEIPT_KEY_REGEX` const with the shared import.

### Downscale Spec

- **Longest edge: 1600px. JPEG quality: 0.82.** Justification: a receipt photographed at 1600px
  on the long edge renders printed thermal/inkjet receipt text at roughly 150-200 DPI for a
  typical 3-4 inch receipt width — comfortably legible on zoom, without carrying a modern phone
  camera's native 3000-4000px dimension (which is the actual "too big" problem the user is
  naming). Quality 0.82 is the point above which JPEG block artifacts on small receipt-font text
  become visually noticeable at 1:1 zoom in informal testing conventions for this content type;
  below ~0.7 thermal-receipt text starts to smear. A typical resized receipt photo lands
  roughly 150-400KB at these settings — small enough that ~150 receipts/year adds a trivial
  amount to blob storage, legible enough to satisfy an auditor.
- **PNG → converted to JPEG.** Receipts are photographic/document content, not diagrams needing
  alpha transparency; JPEG compresses this content far better than PNG at any comparable quality,
  and converting means the storage/view layer only ever deals with one image `Content-Type`
  downstream of the resize step (simpler, and the existing `validateMagicBytes()` server check
  still runs against whatever bytes actually get uploaded, so this isn't a trust shortcut).
- **HEIC is out of scope, not a decision to make here** — `validateMagicBytes()` only recognizes
  PDF/JPEG/PNG signatures (confirmed, `src/lib/receipt-magic-bytes.ts`), and the file input's
  `accept` list never included `.heic`. This isn't new: the same boundary already exists for
  reimbursements. No special-case code needed.
- **PDFs pass through untouched** — `receipt-file-input.tsx` only runs the canvas-resize path
  when `validateMagicBytes`-equivalent client-side sniffing (or simply: file extension /
  `file.type` starts with `image/`) indicates an image; PDFs upload as-is, matching the
  reimbursement precedent's existing 10MB-cap-only handling of PDFs.
- **`image-resize.ts` contract** (pure, no DOM):
  ```ts
  export const RECEIPT_IMAGE_MAX_DIMENSION = 1600;
  export const RECEIPT_IMAGE_JPEG_QUALITY = 0.82;

  export function computeResizeDimensions(
    width: number,
    height: number,
    maxDimension: number = RECEIPT_IMAGE_MAX_DIMENSION,
  ): { width: number; height: number } {
    // Returns unchanged dims if both are already <= maxDimension.
    // Otherwise scales the longer edge down to maxDimension, preserving aspect
    // ratio, rounding both dims to the nearest integer.
  }
  ```
  The client component calls this to size a `<canvas>`, draws the source image scaled via
  `drawImage()`, and calls `canvas.toBlob(cb, 'image/jpeg', RECEIPT_IMAGE_JPEG_QUALITY)`.

### Implementation Order

1. **Schema** (database-admin) — `schema.ts` rename + 3 new columns; write & verify
   `0057_ledger_receipt_waiver.sql` against the local DB (idempotent, re-runnable).
2. **Permissions** — none; no `FEATURES` change, no migration needed for role bindings.
3. **API routes** (api-developer):
   - Hoist `RECEIPT_KEY_REGEX` to `src/lib/receipt-storage/index.ts`; update the two
     reimbursement route imports.
   - Add `isReceiptMissing()` to `ledger.ts`; wire into `ledger-queries.ts:685` and the new
     `listTransactions({ missingReceipt })` filter.
   - Update `GuardrailFlag`/`GuardrailsInput`/Check 11 (`linkHref`, `entitySlug`, `fiscalYear`).
   - `POST .../transactions/upload`, `GET .../transactions/[id]/receipt`,
     `POST`+`DELETE .../transactions/[id]/receipt/waive`.
   - Update `POST`/`PATCH .../transactions[/[id]]` bodies: drop `receiptUrl`, add
     `receiptStorageKey` with the flow-conditional 400 and the waiver-clear-on-attach behavior.
4. **UI** (ux-developer):
   - `image-resize.ts`, `receipt-file-input.tsx`, `receipt-waiver-control.tsx`.
   - `transaction-form.tsx` receipt field wiring.
   - `[fundSlug]/page.tsx`: receipt badge + waiver control per row, `all` pseudo-mode,
     `receipt=missing` param.
   - `ledger-entity-detail.tsx` + `compliance/page.tsx`: render `flag.linkHref`.
5. **Email notifications** — none needed; this is a synchronous admin action with immediate UI
   feedback, no new async workflow to notify anyone about (unlike disbursement approval).
6. **Release notes entry** — written via `/release-notes` when this ships to main (tech-lead, Phase 6/ship).

### Edge Cases & Risks

- **Upload-then-abandon orphan keys.** If an admin uploads a file but never submits the
  create/edit form, the blob is orphaned in storage with nothing referencing its key. **Decision:
  match the reimbursement precedent — defer cleanup, same accepted gap** (`[id]/route.ts:227`
  comment). Not fixing storage hygiene in this pass; consistent, not a regression.
- **Waive-then-upload interaction.** **Decision: uploading a real receipt onto a waived row
  clears the waiver.** An actual receipt supersedes an administrative excuse; the alternative
  (both `receiptStorageKey` and `receiptWaivedAt` set simultaneously) is a confusing dual state
  with no clear UI story and no reason a treasurer would want it. Implemented as part of the
  PATCH handler's `update` object whenever `receiptStorageKey` transitions to non-null — one
  `UPDATE` statement, no separate round trip.
- **Removing a receipt does NOT waive it.** Confirmed from Phase 1 Flow D: removing a receipt
  should re-flag the row (the row genuinely lacks documentation again). Waiver and receipt
  presence are independent axes; only "attach" clears "waive," never the reverse and never
  "remove" implying "waive."
- **Concurrent edit.** No new optimistic-concurrency token introduced — matches this table's
  existing last-write-wins behavior everywhere else (PATCH already re-fetches `existing` once,
  no version check). Not a new risk this feature introduces.
- **`BLOB_READ_WRITE_TOKEN` missing in production.** Inherited risk from the existing
  `receipt-storage` adapter (already logs a `console.warn` and silently falls back to the
  ephemeral local adapter — DECISION-020/FU-6). Not new work here; flagging as a pre-push /
  deployment-engineer checklist item before this ships, per Phase 1 Gap 7.
- **Waiving a transaction that already has a receipt.** Rejected with 409 (see API Contract #3)
  — waiving is only meaningful for rows genuinely missing documentation; allowing it against a
  row with a receipt would be a confusing no-op state.
- **`all` pseudo-fund-slug colliding with a real fund's slug.** Fund slugs are generated from
  fund names (existing slugify convention elsewhere in the codebase); "all" as an actual fund
  name is implausible for this club's fund set (Administrative/Activity/Charitable/Scholarship
  kinds) but database-admin/api-developer should confirm no existing fund resolves to slug `all`
  before this ships, since the `all` branch takes precedence over the fund lookup.

### Named Unit Tests

Extend `src/lib/image-resize.test.ts` (new file):
- `computeResizeDimensions` returns unchanged `{width, height}` when both are already ≤ max.
- Downscales a landscape image (`width > height`, `width > max`) to the max on the long edge,
  scaling height proportionally, rounded to an integer.
- Downscales a portrait image (`height > width`, `height > max`) symmetrically.
- Boundary case: `width === max` (or `height === max`) exactly → unchanged.
- Degenerate/defensive: 0 or negative input dimensions don't throw (documents the contract even
  if unreachable in practice, since a decoded image can't have 0 dimensions).

Extend `src/lib/ledger.test.ts`:
- `isReceiptMissing()`: true for an expense row with both `receiptStorageKey` and
  `receiptWaivedAt` null; false when either is set; false for a non-expense row regardless of
  the other two fields (only `flow === 'expense'` counts, matching the existing guardrail scope
  from Phase 1 Gap 4 — income/transfer rows never trigger this check).
- Check 11 (`guardrails()`) still fires at the correct count and now includes `linkHref` built
  from `entitySlug`/`fiscalYear`; absent (`undefined`) when `txnsWithoutReceipt === 0`.

Extend `src/lib/receipt-storage.test.ts` (existing file) or a small new test for the shared
export:
- `RECEIPT_KEY_REGEX` accepts a well-formed key and rejects a path-traversal-shaped or
  wrong-prefix string — same cases the reimbursement routes presumably already assert, now
  against the single shared export (guards the hoist didn't change behavior).

Per CLAUDE.md Phase 4 gate, these are written and passing by the implementer (api-developer for
`ledger.test.ts`/`receipt-storage.test.ts`, ux-developer or api-developer for
`image-resize.test.ts` since it's pure logic with no DOM dependency — either can own it; whoever
writes `image-resize.ts` writes its test in the same step).

### Out of Scope (confirmed carried from Phase 1/2)

- Bulk/batch backfill tooling for the historical 147 rows (one-at-a-time via edit/waive only).
- OCR or auto-extraction of amount/date from a receipt image.
- Attaching receipts to income/transfer rows (user confirmed expense-only for v1).
- An append-only waiver audit log (a history of every waive/un-waive cycle) — the three-column
  shape captures who/when/why for the *current* state, matching the `approvedAt`/`rejectionReason`
  precedent's reversibility model, not a full audit trail.
- Orphaned-blob cleanup tooling (deferred, matching reimbursement precedent).
- Consolidating `receipt-file-input.tsx`'s downscale logic into the member reimbursement upload
  flow — `image-resize.ts` is written generically enough to be reused there later, but wiring it
  into `reimbursement-form.tsx` is a separate, smaller follow-up ticket, not this one.

### Outputs

- Design doc above (this section).
- `docs/decisions.md` DECISION-035 written (column rename + waiver shape + `LEDGER_MANAGE`
  gating + storage-key reuse + regex hoist + downscale numbers + `all` pseudo-fund resolution).
- No source files modified — Phase 3 is design-only.

### Open questions / handoff notes

- **Implementer sequence: database-admin → api-developer → ux-developer** (specialist split,
  confirmed per CLAUDE.md's guidance — this spans schema + 3 new/changed routes + meaningful UI
  across 2 new client components and edits to 2 existing pages, well past the
  full-stack-developer "~<150 lines, small and tightly coupled" threshold).
  1. **database-admin** — schema rename + waiver columns + `0057_ledger_receipt_waiver.sql`.
  2. **api-developer** — regex hoist, `isReceiptMissing()`, guardrail `linkHref`/`entitySlug`/
     `fiscalYear` threading, `listTransactions({missingReceipt})`, the three new/changed routes
     (upload, receipt-view, waive/unwaive), the POST/PATCH body changes on the existing
     transaction routes. Writes `ledger.test.ts` additions and `receipt-storage.test.ts` additions.
  3. **ux-developer** — `image-resize.ts` (+ its test), `receipt-file-input.tsx`,
     `receipt-waiver-control.tsx`, `transaction-form.tsx` wiring, `[fundSlug]/page.tsx` (badge +
     waiver control + `all` mode + `receipt=missing` param), and the two `flag.linkHref` renders.
- Before database-admin starts: confirm no live fund slug is literally `all` (edge case above).
- qa (Phase 5): the manual click-through should specifically exercise the full Flow
  A→B→C→D→E→waive→un-waive→re-attach cycle from Phase 1, since several steps (waiver-clear-on-
  upload, remove-doesn't-waive) are behavior this design doc asserts but that's easy to get
  backwards in implementation.

---

# Phase 4 — Implementation

### Increment A — database-admin (schema + migration) — 2026-07-21

**Owner:** database-admin
**Status:** complete

### Summary

Renamed `ledger_transactions.receipt_url` → `receipt_storage_key` (nullable text, per Phase 3
design — an expense transaction can legitimately lack a receipt, which is why the waiver
mechanism exists) and added the three-column waiver trio
(`receipt_waived_at`/`receipt_waived_by_user_id`/`receipt_waiver_reason`), mirroring the existing
`approvedAt`/`approvedByUserId`/`rejectionReason` shape already on this table. Migration
`0057_ledger_receipt_waiver.sql` is idempotent (verified by running it twice) and preserved all
147 existing expense rows with no data loss. Fixed every TypeScript touchpoint the rename broke
so `tsc`, the full Vitest suite, and the production build are all clean at the end of this
increment. No new routes, no new UI, no new permission keys — rename-level changes only, per
scope.

### What I did

- Edited `src/lib/db/schema.ts`: renamed `receiptUrl` field to `receiptStorageKey` (column
  `receipt_url` → `receipt_storage_key`, still nullable `text`), added `receiptWaivedAt`
  (`timestamp`, nullable — matches `approvedAt`'s no-timezone style on this same table),
  `receiptWaivedByUserId` (`uuid`, FK → `users.id`, `ON DELETE SET NULL`), `receiptWaiverReason`
  (`text`, nullable). No new index — design doc specifies none (low cardinality, point lookups
  only). Updated the table's header comment block to note the addition and cite DECISION-035.
- Picked migration number `0057` — verified via `ls drizzle/migrations/*.sql | sort | tail -3`
  immediately before writing the file (last existing was `0056_ledger_check_number.sql`), matching
  the number the Phase 3 design doc already anticipated.
- Wrote `drizzle/migrations/0057_ledger_receipt_waiver.sql`:
  - Rename guarded both ways: only renames when `receipt_url` exists AND
    `receipt_storage_key` does not (so it's a no-op on every subsequent deploy).
  - Belt-and-suspenders `ADD COLUMN IF NOT EXISTS receipt_storage_key text` immediately after, in
    case a fresh environment is seeded straight from `schema.ts` with no `receipt_url` to rename.
  - Three `ADD COLUMN IF NOT EXISTS` statements for the waiver trio, including the FK.
- Fixed every TypeScript reference to the old `receiptUrl` field (rename-level only, no new
  validation/behavior beyond what Phase 3 assigns to this increment):
  - `src/app/api/admin/ledger/transactions/route.ts` — doc comment, destructured field, and insert
    payload renamed `receiptUrl` → `receiptStorageKey`; still a plain trimmed-string pass-through
    (no `RECEIPT_KEY_REGEX` validation added — that's api-developer's per the Phase 3 API Contract).
  - `src/app/api/admin/ledger/transactions/[id]/route.ts` — doc comment, `UpdatePayload` type, and
    the `body.receiptUrl` handling renamed the same way.
  - `src/lib/ledger-queries.ts` — the `receiptUrl` field in the `getPendingApprovals()` select
    renamed to `receiptStorageKey`, plus added `receiptWaivedAt`/`receiptWaivedByUserId`/
    `receiptWaiverReason` to that same select (TS required it — `PendingApprovalRow` is
    `LedgerTransaction & {...}` and `LedgerTransaction` now includes the three waiver fields).
    `txnsWithoutReceipt` (~line 685) changed from `!t.receiptUrl` to
    `!t.receiptStorageKey && !t.receiptWaivedAt` — implements the guardrail-input change the task
    called out explicitly (waived rows now excluded from the missing-receipt count), inlined
    directly rather than pre-building the `isReceiptMissing()` exported predicate Phase 3 assigns
    to api-developer in Implementation Order step 3 — left that extraction for them since it's
    real new-functionality/API surface, not a rename.
  - `src/lib/ledger.ts` — updated the `GuardrailsInput.txnsWithoutReceipt` doc comment to reflect
    the new field names and the waiver exclusion.
  - `scripts/port-ledger-dev-to-prod.ts` — the dev→prod ledger-porting script's transaction-row
    mapper (line ~452) referenced `t.receiptUrl`; renamed to `t.receiptStorageKey` so the script
    (Drizzle-typed against `ledgerTransactions`) still compiles and still works against a fresh
    environment seeded from `schema.ts`.
- Ran `pnpm db:migrate` against the local DB (`.env.local` `DATABASE_URL`) **twice** to prove
  idempotency, then verified the live schema and data with `psql`.
- Ran the Phase 4 gates: `pnpm exec tsc --noEmit`, `pnpm test`, `pnpm build:only`.

### Idempotency proof

Run 1 (fresh apply) — `0057_ledger_receipt_waiver.sql` executed the rename, then the
belt-and-suspenders `ADD COLUMN IF NOT EXISTS receipt_storage_key` fired a Postgres `NOTICE`
("column already exists, skipping") because the rename had just created it — confirming the guard
logic runs in the intended order. Overall: `✅ Migrations completed successfully`.

Run 2 (immediate re-run, no schema change in between) — every statement in `0057` fired a
`NOTICE`/skip (rename guard's `IF EXISTS ... AND NOT EXISTS ...` was false since both columns were
already in their final state; all three `ADD COLUMN IF NOT EXISTS` skipped). Overall:
`✅ Migrations completed successfully`. No errors on either run.

### psql verification

```
\d ledger_transactions  (relevant columns only)
          Column           |            Type             | Nullable | Default
 receipt_storage_key       | text                        |          |
 receipt_waived_at         | timestamp without time zone |          |
 receipt_waived_by_user_id | uuid                        |          |
 receipt_waiver_reason     | text                        |          |
    FK: ledger_transactions_receipt_waived_by_user_id_fkey
        FOREIGN KEY (receipt_waived_by_user_id) REFERENCES users(id) ON DELETE SET NULL
```
- `receipt_url` no longer present (confirmed absent from `\d` output).
- All four columns present, correct types, all nullable (no `NOT NULL` — matches design, since an
  expense transaction can legitimately lack a receipt).

Data-loss check:
```sql
SELECT
  count(*) FILTER (WHERE flow='expense') AS total_expense,             -- 147
  count(*) FILTER (WHERE flow='expense' AND receipt_storage_key IS NOT NULL) AS with_receipt, -- 0
  count(*) FILTER (WHERE receipt_waived_at IS NOT NULL) AS waived,     -- 0
  count(*) FILTER (WHERE receipt_waived_by_user_id IS NOT NULL) AS waived_by_set, -- 0
  count(*) FILTER (WHERE receipt_waiver_reason IS NOT NULL) AS waiver_reason_set  -- 0
FROM ledger_transactions;
```
147/147 expense rows preserved, all new/renamed columns NULL as expected — confirms the rename
was genuinely data-free (matching Phase 2's read-only verification of 0/147 non-null before this
migration ran).

### Gate results

- `pnpm exec tsc --noEmit` — clean, no errors.
- `pnpm test` — 378/378 passing (11 test files). No existing test fixtures referenced
  `receiptUrl`, so no fixture updates were forced by the rename.
- `pnpm build:only` — production build succeeded (exit 0), full route manifest generated, no
  build errors.

### Outputs

- Schema: `/Users/cshenso/git/westervillelions/src/lib/db/schema.ts` — `ledgerTransactions` table
  (`receiptStorageKey` rename + `receiptWaivedAt`/`receiptWaivedByUserId`/`receiptWaiverReason`).
- Migration: `/Users/cshenso/git/westervillelions/drizzle/migrations/0057_ledger_receipt_waiver.sql`
  — every statement idempotent (guarded rename, `IF NOT EXISTS` column adds), verified via two
  consecutive local runs with no errors.
- Tables affected: `ledger_transactions` only. No new tables, no new indexes (per design — low
  cardinality, point-lookup fields only).
- No role bindings / seed rows / new `FEATURES` keys — this increment introduces none (confirmed
  per Phase 3: reuses existing `LEDGER_RECORD`/`LEDGER_VIEW`/`LEDGER_MANAGE`).
- Non-schema files touched for rename-level TS correctness:
  `src/app/api/admin/ledger/transactions/route.ts`,
  `src/app/api/admin/ledger/transactions/[id]/route.ts`, `src/lib/ledger-queries.ts`,
  `src/lib/ledger.ts`, `scripts/port-ledger-dev-to-prod.ts`.
- Local apply command used: `export $(grep -E "^DATABASE_URL=" .env.local | xargs) && pnpm db:migrate`
  (run twice for the idempotency proof above).

### Open questions / handoff notes for api-developer

- **Schema is ready to consume.** `ledgerTransactions.receiptStorageKey` (nullable text, opaque
  key shape `receipts/<uuid>/<name>`), `receiptWaivedAt` (nullable timestamp),
  `receiptWaivedByUserId` (nullable uuid FK → `users.id`, `ON DELETE SET NULL`),
  `receiptWaiverReason` (nullable text) are all live in the local DB and in `schema.ts`.
- **Per Phase 3 Implementation Order step 3**, still needed from api-developer:
  - Hoist `RECEIPT_KEY_REGEX` into `src/lib/receipt-storage/index.ts`; update the two
    reimbursement route files to import it; validate `receiptStorageKey` against it on the
    transaction POST/PATCH bodies (I left both bodies as plain rename pass-throughs — no regex
    validation, no flow-conditional 400 yet — that validation is explicitly your increment's job
    per the design's API Contract #4/#5, not mine).
  - Add the exported `isReceiptMissing()` pure predicate to `src/lib/ledger.ts` and refactor
    `ledger-queries.ts:685` (and the new `listTransactions({missingReceipt})` filter) to use it —
    I inlined the equivalent boolean logic (`!t.receiptStorageKey && !t.receiptWaivedAt`) directly
    at the guardrail call site to get gates green this increment, but did not create the shared
    exported function since that's real new API surface assigned to you, not a rename.
  - Build the three new/changed routes: `POST /api/admin/ledger/transactions/upload`,
    `GET /api/admin/ledger/transactions/[id]/receipt`,
    `POST`+`DELETE /api/admin/ledger/transactions/[id]/receipt/waive` — none of these exist yet;
    I did not touch routing beyond the field rename in the two existing transaction route files.
  - `GuardrailFlag.linkHref` / `GuardrailsInput.entitySlug`/`fiscalYear` / Check 11's `linkHref`
    construction — none of this is wired yet; still Phase 3's design, unimplemented.
  - `listTransactions()`'s new `missingReceipt?: boolean` filter param — not yet added.
- **Getter shape note:** `getPendingApprovals()` in `ledger-queries.ts` now selects
  `receiptWaivedAt`/`receiptWaivedByUserId`/`receiptWaiverReason` alongside `receiptStorageKey`
  (TS required it since `PendingApprovalRow` extends the full `LedgerTransaction` type) — those
  three fields are already available on every row returned by that function if useful for the
  Approvals UI, though nothing in this increment's scope renders them.
- **Test coverage note:** no unit tests were added or modified this increment (none of the Named
  Unit Tests in the Phase 3 design — `image-resize.test.ts`, `ledger.test.ts`'s
  `isReceiptMissing()` cases, `receipt-storage.test.ts`'s regex hoist cases — are schema-layer
  work; they belong to api-developer/ux-developer per the design doc's own assignment).
- Before ux-developer builds the `all` pseudo-fund-slug mode: confirm no live fund resolves to
  slug `all` (Phase 3 Edge Cases flagged this; not something I checked as part of a schema-only
  increment, but worth doing before it becomes load-bearing).

---

### Increment B — api-developer (routes + query surface) — 2026-07-21

**Owner:** api-developer
**Status:** complete

### Summary

Built the full server-side surface Phase 3 assigned to this increment: hoisted the duplicated
`RECEIPT_KEY_REGEX` into `src/lib/receipt-storage/index.ts` and switched both reimbursement routes
to import it; added the exported `isReceiptMissing()` pure predicate to `src/lib/ledger.ts` and
rewired Check 11's `linkHref`/`entitySlug`/`fiscalYear` plumbing; added three new routes (upload,
receipt-view proxy, waive/un-waive); and wired `receiptStorageKey` validation (regex + expense-only
400) plus waiver-clear-on-attach into the existing transaction POST/PATCH bodies.
`listTransactions()` gained the `missingReceipt` filter for the `all` pseudo-fund page
ux-developer builds next. All three Phase 4 gates are green: `tsc --noEmit` clean, `pnpm test`
391/391 passing (378 + 13 new — 5 `isReceiptMissing()` cases + 2 `linkHref` cases in
`ledger.test.ts`, 6 `RECEIPT_KEY_REGEX` cases in `receipt-storage.test.ts`), `pnpm build:only`
succeeds with all three new routes in the manifest. No schema/UI files touched.

### What I did

- **Hoisted `RECEIPT_KEY_REGEX`** into `src/lib/receipt-storage/index.ts` (exported alongside the
  `ReceiptStorage` interface) and updated `src/app/api/members/reimbursements/route.ts` and
  `[id]/route.ts` to import it instead of keeping their own local copies — third-copy problem the
  architect flagged in Phase 2 never happened.
- **`src/lib/ledger.ts`**:
  - Added exported `isReceiptMissing(t: { flow, receiptStorageKey, receiptWaivedAt })` pure
    predicate — expense-only, both `receiptStorageKey` and `receiptWaivedAt` must be null.
  - `GuardrailFlag` gained an optional `linkHref?: string`.
  - `GuardrailsInput` gained required `entitySlug: string` and `fiscalYear: number`.
  - Check 11 now sets `linkHref: /admin/ledger/all?entity=${entitySlug}&fy=${fiscalYear}&receipt=missing`.
  - Updated the file's top-of-module changelog comment for this increment.
- **`src/lib/ledger-queries.ts`**:
  - `txnsWithoutReceipt` in `getOverview()` now computed via `allTxns.filter(isReceiptMissing)`
    (previously an inline boolean database-admin left for me per their handoff note).
  - `guardrails({...})` call site now passes `entitySlug: entity.slug, fiscalYear,`.
  - `listTransactions()` gained `missingReceipt?: boolean` — adds
    `and(eq(flow,'expense'), isNull(receiptStorageKey), isNull(receiptWaivedAt))` conditions when
    true, expressing the same rule as `isReceiptMissing()` on the SQL side (kept in sync by hand,
    documented as such in the JSDoc since Drizzle can't share the literal predicate function).
- **`POST /api/admin/ledger/transactions/upload`** (new) — flat route, mirrors
  `POST /api/members/reimbursements/upload` exactly: multipart `file` field, 10MB cap checked
  before reading bytes, `validateMagicBytes()` authoritative regardless of client-side resize,
  opaque key `receipts/<uuid>/<sanitized-name>`, persisted via `getReceiptStorage().save()`.
- **`GET /api/admin/ledger/transactions/[id]/receipt`** (new) — proxy-view route, mirrors
  `GET /api/admin/ledger/reimbursements/[id]/receipt`: fetches only the `receiptStorageKey` column,
  404s with human-readable JSON if the transaction doesn't exist, has no receipt attached, or the
  blob is missing from storage; streams bytes inline with `Cache-Control: no-store`.
- **`POST` + `DELETE /api/admin/ledger/transactions/[id]/receipt/waive`** (new, same file) — gated
  `LEDGER_MANAGE`. POST: 404 if not found → 400 if `flow !== 'expense'` → 403 if approved/rejected
  (same immutability guard as the existing PATCH/DELETE transaction routes) → 409 if a receipt is
  already attached → 400 if `reason` missing/blank → sets all three waiver columns
  (`receiptWaivedAt = now()`, `receiptWaivedByUserId = session.user.id`,
  `receiptWaiverReason = reason.trim().slice(0, 500)`). DELETE: 404 → 403 (immutability) → clears
  all three columns to null. Both return `{ id }`.
  - **Deviation note (non-blocking):** the design doc's API Contract section lists the 400/403/404/409
    response codes as a flat enumeration, not a literal execution order. I ordered checks
    404 → 400 (flow) → 403 (immutability) → 409 (already has receipt) → 400 (missing reason) —
    structural/existence checks before body-content checks. This is a defensible reading, not a
    contract violation, but flagging the exact order here since qa's manual click-through should
    exercise both 400 paths and the 409 path to confirm the messages match.
- **`POST /api/admin/ledger/transactions`** — added `receiptStorageKey` validation: regex-checked
  when present, 400 if `flow !== 'expense'`.
- **`PATCH /api/admin/ledger/transactions/[id]`** — `receiptStorageKey: null` clears (Flow D, does
  NOT touch waiver fields); non-null validates regex + expense-only (using the existing `newFlow`
  pattern for simultaneous flow changes) and clears all three waiver columns in the same `UPDATE`
  (waive-then-upload edge case from Phase 3). Extended `UpdatePayload` type with the three waiver
  fields to carry this.
- **Verified the `all` pseudo-fund-slug edge case** the design flagged for confirmation before it
  becomes load-bearing: `SELECT slug FROM ledger_funds WHERE slug='all'` → 0 rows (local DB). No
  live fund collides with the pseudo-slug ux-developer's next increment will introduce.
- **Named unit tests** (Phase 3's list, all written and passing):
  - `src/lib/ledger.test.ts` — new `describe("isReceiptMissing", ...)` block (5 cases: true when
    both null; false when key set; false when waived; false when both set; false for non-expense
    regardless of the other two fields). Extended the existing Check 11 tests with 2 cases:
    `linkHref` built correctly from `entitySlug`/`fiscalYear` when the flag fires, and absent when
    `txnsWithoutReceipt` is 0. Added `entitySlug`/`fiscalYear` to both `cleanState` and
    `cleanStateInc3` fixtures (required by the type change) — no other test in the file needed
    updating since every other `GuardrailsInput` literal spreads one of those two fixtures.
  - `src/lib/receipt-storage/receipt-storage.test.ts` — new `describe("RECEIPT_KEY_REGEX", ...)`
    block (6 cases): well-formed key accepted, well-formed key with dots/dashes/underscores
    accepted, path-traversal-shaped string rejected, wrong-prefix rejected, missing-uuid-segment
    rejected, bare blob URL rejected (guards the hoist never accidentally allows a URL through).

### Gate results

- `pnpm exec tsc --noEmit` — clean, no errors. (Confirmed exactly the two expected fixture errors
  before fixing `cleanState`/`cleanStateInc3`, then clean after.)
- `pnpm test` — **391/391 passing** (378 existing + 13 new), 11 test files, no regressions.
- `pnpm build:only` — production build succeeded; route manifest includes
  `/api/admin/ledger/transactions/upload`, `/api/admin/ledger/transactions/[id]/receipt`, and
  `/api/admin/ledger/transactions/[id]/receipt/waive`.
- `pnpm lint` — **could not run**: pre-existing environment issue unrelated to this change
  (`ESLint 9.39.2` / `minimatch` ESM interop crash: `SyntaxError: The requested module 'minimatch'
  does not provide an export named 'default'` inside `@eslint/eslintrc`'s dependency chain). Not
  something introduced by this increment — flagging for deployment-engineer's dependency review
  rather than attempting a fix inside this increment's scope.
- No `console.log` added — every new route's catch block uses `console.error`, matching every
  existing route in this codebase.

### Outputs — API contracts for ux-developer

**1. `POST /api/admin/ledger/transactions/upload`** (new)
Gate: `LEDGER_RECORD`. Multipart `file` field (≤10MB, PDF/JPEG/PNG only via magic bytes).
Response 200: `{ key: string }`. Errors: 400 (no file / oversized / unsupported type), 401, 403.
Call this from both the create dialog (Flow A) and the edit dialog (Flow B/C) — the transaction id
is irrelevant to the upload step; the returned `key` is submitted afterward as `receiptStorageKey`.

**2. `GET /api/admin/ledger/transactions/[id]/receipt`** (new)
Gate: `LEDGER_VIEW`. No body. Streams bytes inline (`Content-Disposition: inline`,
`Cache-Control: no-store`). Use as the `href` for a "View receipt" link opened in a new tab — on
404 the response body is `{ error: "..." }` (human-readable text, since this route is opened
directly rather than fetched via JS in the common case).

**3. `POST /api/admin/ledger/transactions/[id]/receipt/waive`** (new)
Gate: `LEDGER_MANAGE`. Body: `{ reason: string }` (required, ≤500 chars after trim). Response 200:
`{ id }`. Errors: 400 (`flow !== 'expense'` or missing/blank reason), 403 (forbidden, or
approved/rejected transaction), 404, 409 (`receiptStorageKey` already set — remove the receipt
first). Render behind a `canManage` check (existing pattern in `[fundSlug]/page.tsx`) and a
required-reason `Dialog` per Phase 3's `receipt-waiver-control.tsx` spec.

**`DELETE /api/admin/ledger/transactions/[id]/receipt/waive`** (same file) — un-waive. No body.
Response 200: `{ id }`. Errors: 401/403/404 (same shape). Clears all three waiver columns.

**4/5. `POST`/`PATCH /api/admin/ledger/transactions[/[id]]` — payload contract for the form:**
- `receiptStorageKey?: string` (POST) / `receiptStorageKey?: string | null` (PATCH) — the opaque
  key from the upload route. PATCH `null` removes (does NOT waive — re-flags the row). PATCH
  non-null attaches/replaces AND silently clears any existing waiver (no client-side action needed
  for that — it's server-enforced).
- 400 if `receiptStorageKey` is present but the effective flow (existing flow, or the new `flow` if
  changing it in the same request) is not `'expense'` — error message: `"Receipts can only be
  attached to expense transactions"`. Don't let the form submit a receipt for income/transfer rows.
- 400 if the key doesn't match the opaque-key shape — shouldn't happen in practice since the form
  only ever gets keys from the upload route's response, but the error message is
  `"receiptStorageKey format is invalid"` if you need to surface it.

**Reading current state:** every `GET`/list path already returns `LedgerTransaction` rows including
`receiptStorageKey`, `receiptWaivedAt`, `receiptWaivedByUserId`, `receiptWaiverReason` — no new read
endpoint needed to render the per-row badge ("View receipt" / "No receipt" / "Waived: <reason>").

**`listTransactions()` new option:** `missingReceipt?: boolean` — pass `true` (with no `fundId`) for
the `all` pseudo-fund-slug entity-wide filtered view Phase 3 assigns to your increment. Confirmed
no live fund resolves to slug `all` (see above) — safe to use as the special-case route segment.

**`GuardrailFlag.linkHref`** — now populated on Check 11's flag. Both `ledger-entity-detail.tsx`
and `compliance/page.tsx` need the `{flag.linkHref && <Link .../>}` block Phase 3 specifies — I did
not touch either file (out of scope / your territory).

### Deviations from the design doc

- Ordering of the waive route's validation checks (404 → 400 flow → 403 immutable → 409 already-
  has-receipt → 400 missing-reason) is my own choice among several defensible readings of the
  design's flat status-code enumeration — see the inline deviation note above. Not a contract
  change, just documenting the exact order for qa's click-through.
- No other deviations. Every route name, gate, status code, and field name matches Phase 3 exactly.

### Open questions / handoff notes

- **Next: ux-developer**, per Phase 3's Implementation Order step 4 — `image-resize.ts` (+ test),
  `receipt-file-input.tsx`, `receipt-waiver-control.tsx`, `transaction-form.tsx` wiring,
  `[fundSlug]/page.tsx` (badge + waiver control + `all` mode + `receipt=missing` param), and the
  two `flag.linkHref` renders in `ledger-entity-detail.tsx`/`compliance/page.tsx`.
- `docs/treasurer-todo.md` shows as modified in `git status` but I did not touch it — it was
  already dirty in the working tree before I started (T-22 entry, dated 2026-07-21, unrelated to
  this feature). Flagging so it isn't mistaken for something this increment introduced; left
  untouched per my scope restrictions.
- `pnpm lint`'s `minimatch`/ESLint crash is pre-existing and unrelated to this increment — worth a
  look at the next dependency review (deployment-engineer, 30-day cadence) since it currently
  blocks lint entirely, not just on this diff.
- qa's click-through should specifically hit: upload → attach on create (Flow A), attach on edit
  (Flow B), replace (Flow C), remove (Flow D, confirms it does NOT waive), view (Flow E, both
  success and the 404-missing-blob path), waive (with and without an existing receipt — confirms
  the 409), un-waive, and re-attaching a receipt onto a waived row (confirms the waiver clears).

---

### Increment C — ux-developer (form + register + guardrail link UI) — 2026-07-21

**Owner:** ux-developer
**Status:** complete

### Summary

Built every client-facing surface Phase 3 assigned to this increment: the pure resize-math module
(`image-resize.ts`, 10 unit tests), the two new client components (`receipt-file-input.tsx`,
`receipt-waiver-control.tsx`), full receipt wiring in `transaction-form.tsx` (attach on create,
attach/replace/remove on edit), the `[fundSlug]/page.tsx` `all` pseudo-fund-slug entity-wide mode
with the `receipt=missing` filter and per-row receipt/waiver UI, and the `flag.linkHref` render at
both guardrail call sites. All three Phase 4 gates are green: `tsc --noEmit` clean, `pnpm test`
401/401 passing (391 existing + 10 new `image-resize.test.ts` cases), `pnpm build:only` succeeds
with the full route manifest including all three of api-developer's new routes and the
`/admin/ledger/[fundSlug]` page. No schema/API files touched (aside from the required
`EditableTransaction` Pick-type extension in the three client files that already shared that type).

### What I did

- **`src/lib/image-resize.ts`** (new) — pure, no-DOM dimension math per the design's downscale
  spec: `RECEIPT_IMAGE_MAX_DIMENSION = 1600`, `RECEIPT_IMAGE_JPEG_QUALITY = 0.82`,
  `computeResizeDimensions(width, height, maxDimension?)` — scales the longer edge down to the max,
  preserves aspect ratio, rounds to integers, returns dimensions unchanged when both are already
  ≤ max, and doesn't throw on zero/negative input (defensive/documented, unreachable for a real
  decoded image).
- **`src/lib/image-resize.test.ts`** (new) — 10 cases: unchanged-when-under-max, landscape
  downscale, portrait downscale, non-integer rounding, both boundary cases (`width === max`,
  `height === max`), default-max-dimension usage, zero/negative defensive cases, and a constants
  sanity check. All passing.
- **`src/components/admin/ledger/receipt-file-input.tsx`** (new, client) — file picker
  (`accept=".pdf,.jpg,.jpeg,.png" capture="environment"`), 10 MB client-side pre-check (mirrors the
  server cap), image detection via `file.type`/extension, canvas resize glue
  (`createImageBitmap` → `computeResizeDimensions` → `canvas.toBlob("image/jpeg", 0.82)`) for image
  files only — PDFs upload untouched. Uploads immediately on file selection (not deferred to the
  parent form's Save) via `POST /api/admin/ledger/transactions/upload`, then calls
  `onUploaded({ key, displayName })`. If resize fails for any reason (decode error, no canvas
  support), falls back to uploading the original file rather than blocking. If the upload itself
  fails, the error renders inline (`role="alert"`) and the parent is **never** notified — the
  transaction save is never blocked by a receipt-upload failure, per Phase 1 Flow A.
- **`src/components/admin/ledger/receipt-waiver-control.tsx`** (new, client) — renders a "Waive"
  button (opens a Radix `Dialog` with a required, 500-char-capped reason textarea →
  `POST .../receipt/waive`) when `waived=false`, or an "Un-waive" button (behind
  `<ConfirmDialog>` — never `window.confirm`, non-destructive styling since it's a reversible
  administrative action, not data loss) when `waived=true`. Only ever rendered by the caller when
  `canManage` is true, matching the codebase's existing gate-in-parent convention
  (`ReconcileToggle`, `TxnDonorActions`) rather than a `usePermissions()` self-check — the parent
  page already computes `canManage` server-side, so prop-gating avoids a redundant client-side
  permission fetch. Server routes re-check `LEDGER_MANAGE` regardless.
- **`src/components/admin/ledger/transaction-form.tsx`** — extended `EditableTransaction`'s `Pick`
  with `receiptStorageKey`/`receiptWaivedAt`/`receiptWaiverReason`. Added a receipt section
  (`showReceiptSection = !isTransfer && !isEditingTransfer && apiFlow === "expense"`, so it never
  renders for income or transfer rows per the user's confirmed scope) with four UI states driven by
  local state (`existingReceiptKey`, `replacingReceipt`, `pendingReceipt`, `removeReceipt`):
  "No receipt" + file input (shows a waiver note if the row is currently waived — "Attaching a
  receipt here will clear the waiver"), "ready to attach" (green, post-upload, with Cancel),
  "attached" ("View receipt" link + Replace + Remove), and "will be removed" (with Undo). Remove
  goes through `<ConfirmDialog destructive>`. Wired both submit paths: POST body includes
  `receiptStorageKey` only when `pendingReceipt` is set (Flow A); PATCH body includes
  `receiptStorageKey: null` when `removeReceipt` (Flow D) or the pending key when attaching/replacing
  (Flow B/C), omitted entirely when the receipt state didn't change this edit.
- **`src/components/admin/ledger/transaction-actions.tsx`** — added the three receipt/waiver
  fields to the `editInitialValues` object built from the row's `LedgerTransaction`, so the edit
  dialog receives current receipt/waiver state.
- **`src/components/admin/ledger/transaction-form-dialog.tsx`** — extended its own
  `EditableTransaction` `Pick` type to match (TS required it as the prop passthrough type).
- **`src/app/(dashboard)/admin/ledger/[fundSlug]/page.tsx`**:
  - Added the `all` pseudo-fund-slug mode (`isAllMode = fundSlug === "all"`): skips the single-fund
    lookup/`notFound()`, fund-specific header chrome (`FundManageDialog`, "Budget / Actual Report"
    link), and passes no `fundId` to `listTransactions()` — entity-wide across all funds and fiscal
    year, matching Ruling 7's resolution (Check 11 is computed per-entity-across-all-funds, so this
    is the only honest guardrail-link target). Added a "Fund" column to the table, shown only in
    this mode (`{!fund && <th>Fund</th>}` / matching `<td>`), since the entity-wide list mixes funds
    and the existing Party/Fund column's transfer-partner-name logic doesn't resolve without a
    single-fund frame of reference (that partner lookup — `partnerByGroupId` — is now guarded
    `if (fund && …)` and simply skipped in `all` mode; both sides of every transfer already appear
    as their own rows when there's no fund filter, so the Fund column carries that information
    instead).
  - Added the `receipt=missing` query param (`missingReceiptFilter`), threaded into
    `listTransactions({ missingReceipt: missingReceiptFilter || undefined })` — works on both a
    normal fund slug (narrower drill-down) and `all` (the guardrail's actual target).
  - Per expense row (non-transfer): a receipt-status line under the flow/status badges — "View
    receipt" link when attached, a gray "Waived" pill (with the reason as a `title` tooltip) plus
    `<ReceiptWaiverControl>` when waived and `canManage`, or "No receipt" text plus
    `<ReceiptWaiverControl>` when missing and `canManage`. Read-only viewers (`LEDGER_VIEW` only)
    see the status text/link without the interactive control.
  - Page title/subtitle adapt to `all` mode ("All Transactions" / "Expenses Missing Receipts" when
    filtered) and empty-state copy adapts to the three cases (fund-scoped empty, all-mode empty,
    missing-receipt-filtered empty — "No expense transactions are missing a receipt in FY…" instead
    of nudging toward "Record Transaction," since the empty state here means the backlog is
    genuinely clear, not that no transactions exist).
  - Verified before wiring: `fund` is `undefined` in `all` mode and every render/query call that
    needs a real fund now branches on `fund` (or `fund?.id`) rather than assuming it's defined —
    confirmed via `tsc --noEmit` passing cleanly.
- **`src/components/admin/ledger/ledger-entity-detail.tsx`** and
  **`src/app/(dashboard)/admin/ledger/compliance/page.tsx`** — added the
  `{flag.linkHref && <Link href={flag.linkHref}>View flagged transactions →</Link>}` block inside
  the existing guardrail-flag `.map()` in both files (both already imported `Link`). Only Check 11
  populates `linkHref` today, so only that flag gains the link; every other guardrail flag renders
  exactly as before.

### Gate results

- `pnpm exec tsc --noEmit` — clean, no errors.
- `pnpm test` — **401/401 passing** (391 existing + 10 new `image-resize.test.ts` cases), 12 test
  files, no regressions.
- `pnpm build:only` — production build succeeded; route manifest includes
  `/api/admin/ledger/transactions/upload`, `/api/admin/ledger/transactions/[id]/receipt`,
  `/api/admin/ledger/transactions/[id]/receipt/waive`, and `/admin/ledger/[fundSlug]` (which now
  covers both real fund slugs and the `all` pseudo-slug at runtime).
- No `console.log` in any new/modified file (checked via grep across every file this increment
  touched). No `window.confirm`/`window.alert`/`window.prompt` (grep matched only a pre-existing
  code comment in `transaction-actions.tsx` documenting the convention, not an actual call).

### How the create-flow upload-before-save works

1. Admin opens "Record Transaction," selects Type = Expense, and picks a file in the Receipt
   section's `<ReceiptFileInput>`.
2. `ReceiptFileInput` uploads immediately on selection — not deferred to the form's Save button. If
   the file is an image, it's decoded via `createImageBitmap`, resized with
   `computeResizeDimensions` (longest edge 1600px), redrawn to a `<canvas>`, and re-encoded as JPEG
   at quality 0.82 before upload; PDFs upload untouched. The resulting blob is POSTed to
   `/api/admin/ledger/transactions/upload`, which mints and returns an opaque
   `receipts/<uuid>/<name>` key — no transaction row exists yet at this point (mirrors the
   reimbursement precedent's ordering).
3. On success, `ReceiptFileInput` calls `onUploaded({ key, displayName })`, and
   `transaction-form.tsx` stores it in `pendingReceipt` state, showing a green "✓ ready to attach"
   confirmation.
4. On upload failure, the error renders inline in `ReceiptFileInput` and `pendingReceipt` is never
   set — the admin can retry, or simply click "Record Transaction" without a receipt. The save is
   never blocked.
5. When the admin submits the form, if `pendingReceipt` is set, its `key` is included as
   `receiptStorageKey` in the `POST /api/admin/ledger/transactions` body; the server validates the
   key's format and that the flow is `expense` before persisting it on the new row.

Edit-mode attach/replace (Flow B/C) works identically, except the upload can happen at any time
while the edit dialog is open, and the resulting key is sent as `receiptStorageKey` in the `PATCH`
body instead — the server-side waiver-clear-on-attach behavior (Phase 3's edge case ruling) requires
no client-side action; it's enforced entirely by the PATCH handler api-developer built.

### Deviations from the design doc

- None structural. One presentational addition beyond the design doc's explicit component list: a
  "Fund" column on the `[fundSlug]/page.tsx` table, shown only in `all` mode. The design doc didn't
  specify how the entity-wide list should convey which fund each row belongs to once the
  fund-scoped frame of reference is gone (the existing Party/Fund column's transfer-partner-name
  logic depends on knowing "the other fund" relative to a single current fund). Adding an explicit
  Fund column seemed like the more honest and simpler resolution than trying to stretch the
  existing transfer-partner lookup to a mode where both sides of a transfer are already visible as
  separate rows. Flagging for qa/analyst review as a UX addition, not a contract change — no API
  shape changed to support it (`fundNameMap` already existed).
- Empty-state and title copy for `all` mode / `receipt=missing` is new microcopy not specified
  verbatim in the design doc ("All Transactions," "Expenses Missing Receipts," "No expense
  transactions are missing a receipt in FY…") — reasonable defaults per the UX Guidelines' empty-
  state convention, but the Lions Club may want to adjust wording.

### Outputs

- New: `src/lib/image-resize.ts`, `src/lib/image-resize.test.ts`,
  `src/components/admin/ledger/receipt-file-input.tsx`,
  `src/components/admin/ledger/receipt-waiver-control.tsx`.
- Modified: `src/components/admin/ledger/transaction-form.tsx`,
  `src/components/admin/ledger/transaction-actions.tsx`,
  `src/components/admin/ledger/transaction-form-dialog.tsx`,
  `src/app/(dashboard)/admin/ledger/[fundSlug]/page.tsx`,
  `src/components/admin/ledger/ledger-entity-detail.tsx`,
  `src/app/(dashboard)/admin/ledger/compliance/page.tsx`.
- No files touched outside `src/lib/` and `src/components/admin/ledger/` /
  `src/app/(dashboard)/admin/ledger/` — no schema, no API routes, no `src/lib/auth/`, no
  `src/components/members/`.
- `docs/treasurer-todo.md` still shows modified in `git status` — pre-existing T-22 edit from before
  this increment started (per api-developer's handoff note); left untouched, confirmed unrelated.
- `docs/work-log/2026-07-21-impact-gift-public-note.md` appears as an untracked file in
  `git status` — the concurrent analyst's work-log for a different feature; not touched.

### Open questions / handoff notes for qa (Phase 5)

Click-through list, covering the full Flow A→B→C→D→E→waive→un-waive→re-attach cycle Phase 3 flagged
as easy to get backwards:

1. **Flow A (attach on create):** Record Transaction → Expense → pick an image file → confirm it
   shows "✓ ready to attach" → submit → new row shows "View receipt"; opening it in a new tab
   streams the resized JPEG.
2. **Flow A, PDF:** same, but pick a PDF — confirm it uploads unresized and still opens correctly.
3. **Flow A, upload failure path:** hardest to trigger without simulating a network/server failure,
   but worth confirming the inline error copy renders and the transaction still saves without a
   receipt when Save is clicked anyway.
4. **Flow B (attach on edit):** open an existing expense row with no receipt → attach → save →
   confirm "View receipt" appears and the guardrail count decrements on next load of the
   Ledger/Compliance overview.
5. **Flow C (replace):** open a row with a receipt → Replace → pick a new file → save → confirm the
   new file is what "View receipt" now streams.
6. **Flow D (remove):** open a row with a receipt → Remove → confirm `<ConfirmDialog>` appears
   (never a native dialog) → confirm → save → confirms the row goes back to "No receipt," **not**
   "Waived" — removing must never imply waiving.
7. **Flow E (view):** both the success path and a 404 (e.g., temporarily point at a transaction with
   no receipt via direct URL) — confirm the 404 renders as readable JSON text in the new tab, not a
   blank page.
8. **Waive (no existing receipt):** click "Waive" on a "No receipt" row (requires `LEDGER_MANAGE`)
   → dialog requires a non-blank reason (try submitting empty — should be blocked client-side) →
   submit → row shows "Waived" pill with the reason in its tooltip, and the guardrail count
   decrements.
9. **Waive (already has a receipt) — 409 path:** confirm the Waive control never even renders for a
   row that has `receiptStorageKey` set (the UI hides it; also worth confirming server-side 409 if
   qa wants to hit the route directly).
10. **Un-waive:** click "Un-waive" → `<ConfirmDialog>` (not destructive-red, but still a confirm) →
    confirm → row goes back to "No receipt," and the guardrail count increments again.
11. **Re-attach onto a waived row:** on a waived row, attach a real receipt via edit → save →
    confirm the row now shows "View receipt" (not "Waived" + a receipt simultaneously) — this
    exercises the server's waiver-clear-on-attach behavior with no client-side action.
12. **Guardrail link:** from the Ledger Overview or Compliance page, click "View flagged
    transactions →" on the missing-receipt flag → confirm it lands on `/admin/ledger/all` filtered
    to the flagged rows, with the "Fund" column visible and title reading "Expenses Missing
    Receipts."
13. **`all` mode without the filter:** navigate to `/admin/ledger/all?entity=…&fy=…` directly (no
    `receipt=missing`) → confirm it renders every transaction across all funds for that entity/FY,
    with the Fund column populated correctly for both regular and transfer rows.
14. **Permission boundaries:** confirm a `LEDGER_VIEW`-only user sees receipt status (View
    receipt/No receipt/Waived) but never the Waive/Un-waive buttons, and never the receipt file
    input in the edit form (the whole form is already gated behind `canRecord` at the page level via
    `TransactionActions`/`TransactionFormDialog`, so this should already hold, but worth confirming).
15. **Mobile (360px):** confirm the receipt file input, the waiver dialog, and the `[fundSlug]`
    table (with its `overflow-x-auto` wrapper, now with one more column in `all` mode) all remain
    usable at a narrow viewport.

New copy strings the Lions Club may want to review: "Expenses Missing Receipts" (page title),
"filtered to expenses missing a receipt" (subtitle), the waiver dialog's placeholder/description
text, and "No expense transactions are missing a receipt in {FY}." (empty state).

Next: **qa** for Phase 5 (typecheck/build already green above; qa's job is the manual click-through
list, any Playwright coverage for the new flows, and the PASS/FAIL verdict), then **analyst** for
Phase 6 shipped-vs-intent.

---

### Loop-back fix — api-developer — 2026-07-21

**Owner:** api-developer
**Status:** complete

### Summary

Fixed the defect QA's Phase 5 verdict cited: both receipt-view routes
(`src/app/api/admin/ledger/transactions/[id]/receipt/route.ts:65` and
`src/app/api/admin/ledger/reimbursements/[id]/receipt/route.ts:49`) constructed their `Response`
body as `stored.bytes.buffer as ArrayBuffer` — the Buffer's *underlying* ArrayBuffer, which for any
small file (`fs.readFileSync` reads under Node's `Buffer.poolSize`, default 8KB, return a Buffer
that's a *view* into a much larger shared pool with a nonzero `byteOffset`) is the wrong region of
memory, not a slice scoped to the file's own bytes — while still declaring the correct
`Content-Length` for the real file. Reproduced QA's exact finding with a standalone repro before
fixing (see below) and confirmed the fix resolves it byte-for-byte. Extracted the fix into one
shared, unit-tested pure helper (`receiptBytesToBodyInit`, `src/lib/receipt-storage/index.ts`) so
both routes use identical, correct logic and any future receipt-streaming route gets it for free.

### What I did

- **Reproduced the exact defect** with a standalone Node script before writing any fix: wrote a
  29-byte file, read it via `fs.readFileSync` after allocating/discarding 50 small "junk" buffers to
  mimic pool contention (matching QA's observed SQL-fragment collision), and confirmed
  `bytes.byteOffset = 2328` (nonzero) and `bytes.buffer.byteLength = 8192` (the whole pool) vs. the
  actual file's `29` bytes — i.e., `bytes.buffer` alone is provably the wrong body. Deleted the
  scratch repro script after use (not committed).
- **Added `receiptBytesToBodyInit(bytes: Buffer | Uint8Array): Uint8Array<ArrayBuffer>`** to
  `src/lib/receipt-storage/index.ts`, exported alongside `RECEIPT_KEY_REGEX`. Implementation:
  `Uint8Array.from(bytes)` — the `TypedArray.from()` static method copies exactly the source view's
  own elements (respecting its `byteOffset`/`byteLength`, never the backing buffer's full extent)
  into a freshly allocated, exactly-sized `ArrayBuffer`. This is immune to the pooling bug by
  construction (there is no way to accidentally read past the view's own bytes) and returns a
  concrete `Uint8Array<ArrayBuffer>`, which is what satisfies `Response`'s `BodyInit` type under
  this project's TS lib version — a bare `new Uint8Array(buf, offset, length)` against a Node
  `Buffer`'s `.buffer` (typed `ArrayBufferLike`) does not typecheck here (tried it first; TS
  rejected `Uint8Array<ArrayBufferLike>` as not assignable to `BodyInit` — a lib.dom.d.ts generic
  quirk, not a correctness issue, but `Uint8Array.from()` sidesteps it cleanly without a cast).
  No `as` cast anywhere in the fix — the old bug (`.buffer as ArrayBuffer`) was exactly an `as` cast
  hiding the wrong-bytes problem; this fix is cast-free by construction.
- **Updated both routes** to call `receiptBytesToBodyInit(stored.bytes)` instead of
  `stored.bytes.buffer as ArrayBuffer`, and changed the `Content-Length` header from
  `stored.bytes.length.toString()` to `stored.bytes.byteLength.toString()` (identical value for a
  Buffer — `length`/`byteLength` are the same for `Uint8Array` subclasses — but `byteLength` is the
  more precise property name given the fix is specifically about byte-region correctness).
- **Regression tests** added to `src/lib/receipt-storage/receipt-storage.test.ts` (new
  `describe("receiptBytesToBodyInit", ...)` block, 3 cases), per QA's exact recommendation —
  constructs a Buffer as a view into a larger backing ArrayBuffer with a nonzero `byteOffset`:
  1. **"returns exactly the view's own bytes, not the underlying (larger, pooled) ArrayBuffer —
     regression for small-file receipt-view corruption"** — builds a 200-byte pool Buffer with a
     10-byte payload written at offset 100, takes a `Buffer.from(pool.buffer, pool.byteOffset+100,
     10)` view (guarded with `expect(view.byteOffset).toBeGreaterThan(0)` and
     `expect(view.buffer.byteLength).toBeGreaterThan(view.byteLength)` so the test itself can't
     silently degenerate into a zero-offset case), and asserts `receiptBytesToBodyInit(view)` is
     exactly 10 bytes and exactly the payload string — this is the direct unit-level regression for
     the bug class.
  2. **"round-trips through an actual Response body with only the view's bytes — the exact path both
     receipt routes use"** — constructs a real `new Response(receiptBytesToBodyInit(view), {...})`
     from the same pooled-view shape and reads it back via `response.arrayBuffer()`, asserting
     byte-for-byte equality — this exercises the literal code path (`Response` construction) both
     routes use, not just the helper in isolation, per QA's ask for "the response-body path."
  3. **"passes through a non-pooled, zero-offset Buffer unchanged (no regression for the common
     case)"** — confirms the fix doesn't change behavior for the ordinary case (large files,
     `byteOffset = 0`), so this isn't just "always allocate a copy and hope."
- **Verified the fix resolves the exact repro** by re-running the earlier standalone script's logic
  against `Uint8Array.from(bytes)`: the fixed body is exactly 29 bytes and exactly the file's
  content, vs. the old path's 8192-byte pool dump.

### formData() decision (QA's secondary note)

QA's secondary finding: uploads at/above ~10MB never reach the route's own
`file.size > MAX_FILE_SIZE_BYTES` check because `request.formData()` throws first, falling back to
a generic `"Invalid multipart form data"` message instead of `"File exceeds the 10 MB size limit"`.
**Read both upload routes before deciding**
(`src/app/api/admin/ledger/transactions/upload/route.ts` and
`src/app/api/members/reimbursements/upload/route.ts`): both **already** wrap `request.formData()`
in a `try/catch` that returns a graceful `400 { error: "Invalid multipart form data" }` — there is no
missing crash guard, and no `≤5-line` addition would change that (the guard already exists in both
files). What QA actually flagged is a **message mismatch**, not a missing try/catch: the specific
"File exceeds the 10 MB size limit" copy is unreachable for this failure mode because the
underlying platform throws before our own size check ever runs, and there's no reliable, portable
way to distinguish "the body was too large" from "the multipart body was otherwise malformed" from
inside a generic `catch` without inspecting engine-specific error internals (fragile, and out of
scope for a loop-back fix). Per the task's explicit instruction ("do NOT redesign this now... else
document as a known note for the analyst"), this is **documented as a known note** rather than
changed: the existing generic 400 is still a client-actionable, human-readable error (just not the
size-specific one), so no user-facing crash or 500 occurs — it's a copy-precision gap, not a
correctness defect, and distinguishing the two failure modes reliably is a small design question
(e.g., whether to set an explicit body-size limit upstream of `formData()` so oversized requests are
rejected before parsing even starts) rather than a same-file one-liner. Flagging for analyst/tech-lead
to decide whether it's worth a follow-up ticket.

### Gate results

- `pnpm exec tsc --noEmit` — clean, no errors. (One iteration needed: `new Uint8Array(bytes.buffer,
  byteOffset, byteLength)` initially failed to typecheck against `BodyInit` —
  `Uint8Array<ArrayBufferLike>` isn't assignable to `BodyInit` under this project's TS lib version —
  resolved by switching to `Uint8Array.from(bytes)` with an explicit `Uint8Array<ArrayBuffer>`
  return-type annotation on the helper, which is both correct and satisfies the type checker without
  a cast.)
- `pnpm test` — **404/404 passing** (401 existing + 3 new `receiptBytesToBodyInit` cases), 12 test
  files, no regressions.
- `pnpm build:only` — production build succeeded (exit 0), full route manifest generated including
  both receipt-view routes, no build errors.
- Standalone verification (not a committed test): reproduced the exact byte-offset/pool-size shape
  QA described (`byteOffset: 2328`, `buffer.byteLength: 8192` vs. the real file's `29` bytes) against
  a real `fs.readFileSync` small-file read, and confirmed `Uint8Array.from(bytes)` yields exactly the
  file's 29 bytes. Script deleted after use, not committed.

### Outputs

- Modified: `src/lib/receipt-storage/index.ts` (new exported `receiptBytesToBodyInit()` helper),
  `src/app/api/admin/ledger/transactions/[id]/receipt/route.ts` (uses the helper),
  `src/app/api/admin/ledger/reimbursements/[id]/receipt/route.ts` (uses the helper),
  `src/lib/receipt-storage/receipt-storage.test.ts` (3 new regression tests).
- No other files touched — no schema, no migrations, no components, no other work-logs, no upload
  route changes (existing try/catch already sufficient; see formData() decision above).
- No `docs/decisions.md` entry added — this is a bug fix to code shipped earlier this same day under
  DECISION-035, not a new structural decision; recommend a brief follow-up note on DECISION-035 if
  tech-lead wants one, but not required to close this loop-back.

### Open questions / handoff notes

- **Next: qa** — re-run Phase 5 verification. The repro recipe QA left (a <4KB file through the real
  upload+view routes) should now round-trip byte-for-byte; recommend also re-confirming the
  keep-alive-connection-corruption symptom is gone (a follow-up request on the same connection should
  no longer fail with `Parse Error: Expected HTTP/, RTSP/ or ICE/`).
- formData()/10MB-message-precision note carried forward for analyst's Phase 6 as a non-blocking,
  documented gap (see decision above) — not fixed, not a regression, pre-existing across both upload
  routes.
- No other deviations from QA's recommended fix — implemented as specified (Option: pass the
  Buffer/typed-array directly rather than reaching into `.buffer`), with `Uint8Array.from()` chosen
  over the two options QA listed once the direct `new Uint8Array(view)` / `new Uint8Array(buf,
  offset, length)` forms both hit the same `BodyInit` typing wall.

---

# Phase 5 — Verification (qa)

**Owner:** qa
**Status:** complete
**Date:** 2026-07-21

### Summary

**Verdict: FAIL.** Typecheck, all 401 named unit tests, the production build, and migration
idempotency are all clean, and a full live click-through of Increment C's 15-item list — Flow
A→B→C→D→E→waive→un-waive→re-attach, the guardrail link, permission gating, and rejection paths —
passes end to end. But the manual click-through surfaced a real, reproducible defect in the
receipt-*viewing* code path shared by both the new ledger-transaction receipt route and the
pre-existing member-reimbursement receipt route it was built to mirror: for any receipt file small
enough to fall under Node's internal `Buffer` pooling threshold (empirically confirmed: under
~4KB), `GET .../receipt` streams back **the wrong bytes** — a fragment of unrelated in-process
memory, not the stored receipt — while still declaring the correct `Content-Length`. This also
corrupted a keep-alive HTTP connection badly enough to break the *next*, unrelated request on it.
This is not a synthetic edge case invented by an unrealistic test file; genuinely small real-world
receipts (a short exported PDF, a simple/blank scanned document) will trigger the identical
failure. Per this task's instructions, a defect this concrete is a FAIL regardless of how much else
is green — returning to api-developer with exact citations below, not fixed by qa.

### What I did

- Read the full work-log (Phases 1–4, all three increments) before touching anything.
- **Type check:** `pnpm exec tsc --noEmit` — clean, no errors.
- **Unit tests:** `pnpm test` — **401/401 passing**, 12 files. Verified by name (not just count) that
  every test Phase 3's design doc named actually exists and passes: `image-resize.test.ts`'s 10
  `computeResizeDimensions` cases (unchanged-under-max, landscape/portrait downscale, both boundary
  cases, default-max-dimension, zero/negative defensive, constants sanity); `ledger.test.ts`'s
  `isReceiptMissing` (5 cases) and Check 11 `linkHref` cases (2); `receipt-storage.test.ts`'s
  `RECEIPT_KEY_REGEX` block (6 cases, plus the pre-existing magic-byte suite untouched).
- **Production build:** `pnpm build:only` — succeeded; route manifest includes
  `/api/admin/ledger/transactions/upload`, `/api/admin/ledger/transactions/[id]/receipt`,
  `/api/admin/ledger/transactions/[id]/receipt/waive`, and `/admin/ledger/[fundSlug]` (covers both
  real fund slugs and the `all` pseudo-slug).
- **Migration idempotency:** re-ran `pnpm db:migrate` against the local DB. `0057_ledger_receipt_waiver.sql`
  fired `NOTICE`/skip on every statement (rename guard false since already renamed; all four
  `ADD COLUMN IF NOT EXISTS` skipped) — confirmed idempotent, `✅ Migrations completed successfully`.
- **Route-level gate audit** (read every new/changed route's source, not inferred from passing tests):

  | Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
  |---|---|---|---|
  | `POST /api/admin/ledger/transactions/upload` | yes | yes | `LEDGER_RECORD` — correct (mutation-adjacent: mints a key that becomes attachable) |
  | `GET /api/admin/ledger/transactions/[id]/receipt` | yes | yes | `LEDGER_VIEW` — correct, broader than `LEDGER_RECORD` per the reimbursement precedent; bulk PII concern doesn't apply (single-row, admin-only financial doc, not a roster/subscriber export) |
  | `POST /api/admin/ledger/transactions/[id]/receipt/waive` | yes | yes | `LEDGER_MANAGE` — correct, matches the design's step-up argument |
  | `DELETE /api/admin/ledger/transactions/[id]/receipt/waive` | yes | yes | `LEDGER_MANAGE` — correct |
  | `POST /api/admin/ledger/transactions` (receiptStorageKey field) | yes (pre-existing handler) | yes (pre-existing handler) | `LEDGER_RECORD` — correct; regex + expense-only 400 confirmed present in source |
  | `PATCH /api/admin/ledger/transactions/[id]` (receiptStorageKey field) | yes (pre-existing handler) | yes (pre-existing handler) | `LEDGER_RECORD` — correct; confirmed in source that a non-null key clears all three waiver columns in the same `UPDATE`, and `null` does NOT touch them |

  Also confirmed by source read: the waive route's 409 ("already has a receipt — remove it before
  waiving") and 403 immutability guard (approved/rejected transactions) are both present and fire in
  the order api-developer's Increment B documented.
- **Dev-server live click-through.** Started `pnpm dev`, confirmed the e2e admin
  (`lions-e2e-test@westervillelions.org`) holds all four `LEDGER_*` features including
  `LEDGER_MANAGE` (queried the local DB directly), so the full waive/un-waive cycle could be driven
  live, not code-read. Wrote a temporary Playwright spec (not committed — deleted after this
  verification per the cleanup instruction) that drove every item on Increment C's 15-item list
  against the real routes: create → attach on edit (Flow B, the primary flow) → View streams inline
  with correct `Content-Type`/`Content-Disposition: inline`/`Cache-Control: no-store` → 404 renders
  human JSON → Replace swaps the streamed file → Remove via `<ConfirmDialog>` (confirmed — never a
  native dialog) and confirmed it does **not** waive → Waive requires a non-blank reason (native
  `required` blocks empty submit) → 409 confirmed when a receipt is already attached (both via the
  UI, where the control never renders, and directly against the route) → Un-waive via
  `<ConfirmDialog>` → re-attaching onto a waived row clears the waiver server-side with no client
  action → guardrail link (`View flagged transactions →`) lands on `/admin/ledger/all` filtered to
  `receipt=missing` with the `Fund` column and "Expenses Missing Receipts" title → `all` mode without
  the filter renders correctly with the Fund column populated → 360px viewport has no page-level
  horizontal overflow. **12/12 of these drove green on the real server.**
- **Downscale reality check.** Uploaded a fabricated 2400×1200 JPEG (long edge 2400 > the 1600px
  cap) via the real upload route through the actual UI file input (exercising the real
  `createImageBitmap` → `computeResizeDimensions` → `canvas.toBlob` client path). Downloaded the
  bytes the view route streamed back and inspected them with `sips`:
  **original 2400×1200 → stored/streamed 1600×800, format `jpeg`.** Long edge landed exactly at the
  1600px spec, aspect ratio preserved exactly (2400/1200 = 1600/800 = 2), PNG/JPEG-agnostic input
  correctly normalized to JPEG output. Matches the Phase 3 downscale spec precisely.
- **Rejection paths.** Server-side magic-byte rejection (plain text posing as `.jpg`) returns a
  human-readable 400 — confirmed both via the UI form and directly against the upload route. A
  9MB file uploads successfully and is correctly capped/validated. **Finding:** files at/above
  ~10MB (including one only 4 bytes over the 10,485,760-byte cap) never reach the route's own
  `file.size > MAX_FILE_SIZE_BYTES` check at all — `request.formData()` throws first, and the
  response falls back to the route's generic `"Invalid multipart form data"` catch-all rather than
  the intended `"File exceeds the 10 MB size limit"` copy. Confirmed via a `curl`-based binary
  search independent of Playwright (9MB parses and hits the real check; 10MB does not), so this
  isn't a Playwright multipart-encoding artifact. Not the reason for this FAIL verdict on its own,
  but flagging since the design's promised human copy for this exact path appears to be effectively
  unreachable in local dev — worth api-developer confirming whether this also holds against Vercel
  Blob in staging before relying on the message.
- **The critical defect — receipt-view routes stream the wrong bytes for small files.** While
  driving the "Replace" step of the click-through with a 200-byte hand-built PDF (a legitimate,
  valid-magic-bytes, tiny document — not a corrupted or adversarial input), the view route returned
  bytes that were **not the PDF** — verified byte-for-byte via `xxd`: the response body began
  `insert into "ledger_transactions" ("id", "entity_id", "fund_id", "bank_acc...` — a live fragment
  of an unrelated Drizzle SQL `INSERT` statement string, evidently still resident in Node's shared
  small-object memory at the time of the read. The file **on disk** in `.receipt-store/` was
  confirmed correct (`%PDF-1.4...`) — the corruption happens only in how the route serializes the
  response, not in storage. Root-caused with a minimal Node repro:
  ```
  const b = fs.readFileSync(smallFile);      // 200-byte file
  b.byteOffset            // 8   (nonzero — sliced from a shared pool)
  b.buffer.byteLength     // 8192 (Buffer.poolSize — the WHOLE pool, not this file)
  ```
  Both receipt-view routes construct the HTTP response as
  `new Response(stored.bytes.buffer as ArrayBuffer, { headers: { "Content-Length": stored.bytes.length... } })`.
  `stored.bytes.buffer` is the Buffer's **underlying** `ArrayBuffer`, not a slice scoped to
  `[byteOffset, byteOffset + length)`. For any file `fs.readFileSync` returns from Node's internal
  Buffer pool (empirically: files under ~4KB — confirmed 200 bytes pools, 195KB does not, `byteOffset`
  0 vs. nonzero respectively), this sends the wrong region of memory while still declaring the
  correct `Content-Length` for the *actual* file — a declared-vs-actual body-length mismatch that
  also corrupted the keep-alive connection enough to break the next unrelated request (reproduced
  directly: a subsequent Playwright request failed with
  `Parse Error: Expected HTTP/, RTSP/ or ICE/`).
  - **Exact citations:**
    `src/app/api/admin/ledger/transactions/[id]/receipt/route.ts:65` (new, this increment) —
    `return new Response(stored.bytes.buffer as ArrayBuffer, { ...`
    `src/app/api/admin/ledger/reimbursements/[id]/receipt/route.ts:49` (pre-existing precedent this
    increment mirrored verbatim, per Phase 2/3's explicit "mirror the reimbursement proxy route
    exactly" guidance) — same pattern, same bug. **Not introduced by this increment — inherited from
    the reimbursement flow, and likely already live wherever a member reimbursement receipt happens
    to be small.**
  - **Scope of manifestation:** confirmed this reproduces via `LocalReceiptStorage` (`fs.readFileSync`
    pooling) — i.e., always in local dev, and in production too if `BLOB_READ_WRITE_TOKEN` is ever
    absent and the app falls back to the local adapter (a documented risk already, DECISION-020/FU-6).
    The Vercel Blob adapter's `read()` uses `Buffer.from(await resp.arrayBuffer())`, which wraps a
    freshly-allocated, exactly-sized `ArrayBuffer` from `fetch()` at `byteOffset 0` — **not** pooled,
    so this specific manifestation likely does not reproduce against Vercel Blob in production. That
    does not make the code correct; it makes it fragile and coincidentally safe under one storage
    backend today. Recommend fixing regardless of current production exposure.
  - **Recommended fix (not applied — qa does not write feature code):** pass the Buffer/Uint8Array
    directly — `new Response(stored.bytes, { ... })` — rather than reaching into `.buffer`. The Web
    `Response` body accepts a `BufferSource` and correctly honors a typed array view's own
    `byteOffset`/`byteLength`; there is no need to touch `.buffer` at all. (Equivalent alternative:
    `stored.bytes.buffer.slice(stored.bytes.byteOffset, stored.bytes.byteOffset + stored.bytes.byteLength)`.)
    Same fix needed in both files.
- **Cleanup.** Deleted every test transaction created (verified via SQL: zero rows matching
  `QA-%`/`CURL-DEBUG-TEST` memo patterns after cleanup), deleted every orphaned receipt blob this
  session created under `.receipt-store/receipts/` (the app's own accepted "no orphan cleanup"
  gap means these don't self-delete when a transaction is deleted — confirmed `.receipt-store/`
  now contains only the single pre-existing `acknowledgments/` test fixture that was present before
  this session started). Confirmed club-entity FY2024/FY2025 missing-receipt counts are back to
  their original 12/34 (0 waived) — matching Phase 2's original 147-row (12+34+101) figure exactly,
  no residual waivers or test pollution. Deleted the temporary Playwright spec and all scratch
  fixture files; killed the dev server; confirmed port 3000 is free.

### Outputs

- **No implementation source files modified** — per this task's scope, all fixes are left to
  api-developer.
- Read for the gate audit: `src/app/api/admin/ledger/transactions/upload/route.ts`,
  `src/app/api/admin/ledger/transactions/[id]/receipt/route.ts`,
  `src/app/api/admin/ledger/transactions/[id]/receipt/waive/route.ts`,
  `src/app/api/admin/ledger/transactions/route.ts`, `src/app/api/admin/ledger/transactions/[id]/route.ts`,
  `src/app/api/admin/ledger/reimbursements/[id]/receipt/route.ts`,
  `src/lib/receipt-storage/local.ts`, `src/lib/receipt-storage/vercel-blob.ts`.
- Temporary, uncommitted verification artifacts (Playwright spec, test fixtures, downloaded receipt
  bytes, cookie/storage-state files) — all deleted at the end of this session; none left in the repo.
- No `docs/decisions.md` entry added (qa doesn't author decisions) — recommend DECISION-035 gets a
  follow-up note once api-developer's fix lands, or a new DECISION-0NN if the fix is non-trivial.

### Regression test recommendation (for api-developer, not written by qa this pass)

- **`should stream the exact stored bytes for a receipt file under Node's Buffer-pool threshold —
  regression for small-file receipt-view corruption`** — an integration-style test (route handler or
  Playwright) that uploads a file under ~2KB, views it back, and asserts byte-for-byte equality with
  the original upload. This needs a real HTTP round trip (or at minimum a real `fs.readFileSync` call
  against a small file) to catch — a pure-unit mock of the storage layer would hide the exact bug,
  since the defect lives in how the route turns `stored.bytes` into a `Response`, not in the storage
  adapter's own read/write correctness (which is already covered and correct).

### Feature-Gate Audit

See the route-level gate audit table above — all six routes/payload paths this feature touches have
`auth()` + the correct `hasFeature(FEATURES.*)` check, verified by reading the route source directly,
not inferred from passing tests.

### Coverage on Critical Modules

- `src/lib/ledger.ts` — `isReceiptMissing()` and the Check 11 `linkHref` construction: fully covered
  (5 + 2 new cases this increment, on top of the existing Check 1–10 coverage already in the file).
- `src/lib/image-resize.ts` — 10/10 named cases from Phase 3's design, 100% of the module's exported
  surface.
- `src/lib/receipt-storage/index.ts` (`RECEIPT_KEY_REGEX`) — 6 cases covering accept/reject paths
  including path-traversal and bare-URL rejection.
- Not covered by Vitest (correctly — this is integration territory): the `Response` construction bug
  above. No unit test over the route file exists or was expected to per Phase 3's design; this is
  exactly the kind of defect the "manual click-through" layer of the verification stack exists to
  catch, and it did.

### Open questions / handoff notes

- **Next: api-developer** (Phase 4 rework), not analyst. Fix both citations above
  (`transactions/[id]/receipt/route.ts:65` and `reimbursements/[id]/receipt/route.ts:49`) in the
  same pass, since it's the identical defect in both files. Add the regression test recommended
  above before requesting re-verification.
- Secondary, non-blocking finding for the same pass: the ~10MB+ upload path never reaches the
  intended "File exceeds the 10 MB size limit" message locally (`request.formData()` throws first).
  Worth a look while already in this file, but not itself a reason this verdict is FAIL.
- **Deviation position (requested by the task, for analyst's Phase 6):** the added "Fund" column in
  `all`-mode (Increment C's flagged deviation) is a reasonable UI necessity, not scope drift. Once
  the fund-scoped frame of reference is removed (which Ruling 7 required for an honest guardrail-link
  target), the existing Party/Fund column's transfer-partner-name logic has no fund to resolve
  "the other side" relative to — some way to convey which fund each row belongs to is required for
  the entity-wide list to be legible at all, not an optional embellishment. No API/data-model surface
  was added to support it (`fundNameMap` already existed); it's presentational only. Recommend
  accepting it as part of this increment rather than deferring it.
- Once api-developer's fix lands: re-run the same click-through (the temporary Playwright spec is
  gone, but the repro recipe above — a <4KB file through the real upload+view routes — reproduces it
  in under a minute) and confirm byte-for-byte equality before re-issuing a verdict.

---

## Phase 5 — Re-verification addendum (qa) — 2026-07-21

**Owner:** qa
**Status:** complete

### Summary

**Verdict: PASS.** This is a focused re-verify of the loop-back fix only (the small-file
receipt-view corruption bug), not a full re-run — the prior Phase 5 pass already covered 12/12
click-through items, the feature-gate audit, and the downscale reality check, none of which the
loop-back fix touched. All three gates are green (`tsc`, 404/404 tests, production build). The
three new regression tests in `receipt-storage.test.ts` correctly construct a nonzero-`byteOffset`
Buffer view into a larger backing `ArrayBuffer` — exactly the shape that broke before — and assert
the fix. Live re-test against the real dev server: uploaded a genuine 168-byte PDF (well under the
~4KB pooling threshold that triggered the original defect) through the actual
`POST /api/admin/ledger/transactions/upload` route, attached it to a real expense transaction via
`POST /api/admin/ledger/transactions`, and streamed it back via
`GET /api/admin/ledger/transactions/[id]/receipt` — **byte-for-byte identical** to the original
file, correct `Content-Length: 168`, correct `Content-Type: application/pdf`, no pool-fragment
leakage. Repeated the fetch and interleaved an unrelated request on the same curl session — no
keep-alive corruption, confirming the original defect's secondary symptom is also gone. Re-checked
the pre-existing `GET /api/admin/ledger/reimbursements/[id]/receipt` route the same way (same
shared `receiptBytesToBodyInit()` helper, same 168-byte file) — also byte-for-byte correct. QA's
prior secondary finding (10MB `formData()` message-precision) is documented in the work-log as a
known, non-blocking note, and I agree with that ruling on re-review — it does not gate this
verdict. All test data, blobs, and the dev server were cleaned up; baseline (147/0/0 expense
receipt/waiver counts, empty `.receipt-store/` beyond the pre-existing fixture, port 3000 free) is
restored exactly.

### What I did

- Read the prior Phase 5 FAIL section and the "Loop-back fix — api-developer" subsection in full
  before touching anything.
- Read the changed source: `src/lib/receipt-storage/index.ts` (new
  `receiptBytesToBodyInit(bytes: Buffer | Uint8Array): Uint8Array<ArrayBuffer>`, implemented as
  `Uint8Array.from(bytes)`), both receipt-view routes
  (`src/app/api/admin/ledger/transactions/[id]/receipt/route.ts:65`,
  `src/app/api/admin/ledger/reimbursements/[id]/receipt/route.ts:49`) — confirmed both now call
  `receiptBytesToBodyInit(stored.bytes)` instead of the old `stored.bytes.buffer as ArrayBuffer`,
  and both `Content-Length` headers now read `stored.bytes.byteLength` (unchanged value, more
  precise property name).
- Read the 3 new tests in `src/lib/receipt-storage/receipt-storage.test.ts`
  (`describe("receiptBytesToBodyInit", ...)`, lines ~255-298):
  1. Direct helper test — builds a 200-byte `pool` `Buffer`, writes a 10-byte payload at offset
     100, takes `Buffer.from(pool.buffer, pool.byteOffset + 100, 10)` (a nonzero-`byteOffset` view
     into a larger backing buffer — the exact bug shape), asserts
     `view.byteOffset > 0` and `view.buffer.byteLength > view.byteLength` as a self-check the test
     can't silently degenerate, then asserts `receiptBytesToBodyInit(view)` is exactly the 10-byte
     payload. **This is the primary regression test and it constructs the exact defect shape.**
  2. Full `Response`-construction round-trip using the same pooled-view shape — the literal code
     path both routes use, not just the helper in isolation.
  3. Non-pooled, zero-offset `Buffer` passes through unchanged — confirms the fix doesn't alter the
     ordinary (large-file) case.
- **Type check:** `pnpm exec tsc --noEmit` — clean, no errors.
- **Unit tests:** `pnpm test` — **404/404 passing** (401 + 3 new), 12 test files, 282ms. Matches the
  expected count exactly.
- **Production build:** `pnpm build:only` — exit 0, no errors, full route manifest generated
  including both receipt-view routes and the upload/waive routes.
- **Live re-test of the exact failing scenario**, against a fresh `pnpm dev` (started clean, killed
  any stale process on :3000 first):
  1. Authenticated as the e2e admin (`lions-e2e-test@westervillelions.org`, confirmed via
     `/api/auth/session` to hold `ledger.view`/`ledger.record`/`ledger.manage`) via the real
     NextAuth credentials callback (CSRF token + cookie jar), not a bypass.
  2. Wrote a genuine 168-byte PDF (`%PDF-1.4` header, some filler text, `%%EOF` footer) — well
     under the ~4KB Node `Buffer` pooling threshold that triggered the original defect.
  3. `POST /api/admin/ledger/transactions/upload` with the real file (multipart) →
     `200 {"key":"receipts/ccee31cf-.../small-receipt.pdf"}`.
  4. `POST /api/admin/ledger/transactions` with `flow:"expense"`, the entity/fund ids for
     Club/Activity Fund, and `receiptStorageKey` set to the minted key → `201`, transaction id
     captured.
  5. `GET /api/admin/ledger/transactions/[id]/receipt` → `200`, `content-length: 168`,
     `content-type: application/pdf`, `content-disposition: inline`,
     `cache-control: no-store, no-cache, must-revalidate`. Downloaded the body and ran `cmp` against
     the original 168-byte file: **byte-for-byte identical.** No SQL-fragment or other pool-garbage
     bytes present.
  6. Interleaved a second, unrelated request (`GET /api/auth/session`) immediately after the
     receipt fetch on the same curl invocation, then re-fetched the receipt a second time — both
     succeeded normally (`200`/`200`) with the second receipt fetch again byte-for-byte identical.
     No keep-alive connection corruption (the original bug's `Parse Error: Expected HTTP/, RTSP/ or
     ICE/` symptom does not reproduce).
  7. **Re-checked the pre-existing reimbursement route.** No reimbursement rows existed locally and
     the e2e admin account has no linked member (can't submit one through the member-facing
     `POST /api/members/reimbursements` route without a member link), so I inserted one throwaway
     `ledger_reimbursements` row directly via SQL, reusing the same already-uploaded 168-byte
     receipt key, memo-tagged `QA-REVERIFY-2026-07-21` for unambiguous cleanup. Fetched
     `GET /api/admin/ledger/reimbursements/[id]/receipt` → `200`, `content-length: 168`,
     `content-type: application/pdf` — **byte-for-byte identical** to the same original file.
     Confirms the shared helper fixes both call sites, not just the new one.
- **Confirmed the 10MB `formData()` note is documented and non-blocking.** Re-read the "formData()
  decision (QA's secondary note)" section the loop-back fix wrote: both upload routes already
  wrap `request.formData()` in `try/catch` (no missing crash guard — confirmed by reading both
  route files), so the only gap is generic-400-vs-specific-400 copy precision for the ~10MB-and-up
  case, not a crash or a 500. I agree this is correctly ruled non-blocking — it was true before the
  loop-back fix and is unchanged by it; nothing in this fix's diff touches upload-size handling.
- **Cleanup.**
  - Deleted the SQL-inserted throwaway reimbursement row and the API-created test transaction
    (`DELETE FROM ledger_transactions/ledger_reimbursements WHERE memo/description LIKE
    'QA-REVERIFY-2026-07-21%'` — confirmed 1 row each before, 0 after).
  - Deleted the uploaded receipt blob directory (`.receipt-store/receipts/ccee31cf-.../`) —
    confirmed `.receipt-store/` now contains only the single pre-existing
    `acknowledgments/test_ack_letter.pdf` fixture that predates this session.
  - Confirmed baseline restored via SQL:
    `SELECT count(*) FILTER (WHERE flow='expense'), count(*) FILTER (...receipt_storage_key IS NOT
    NULL), count(*) FILTER (...receipt_waived_at IS NOT NULL) FROM ledger_transactions` →
    **147 / 0 / 0** — exact match to Phase 2's original read-only baseline. `ledger_reimbursements`
    count → **0**, matching the pre-session state.
  - Deleted all scratch files this session created (cookie jar, uploaded/downloaded test files,
    response JSON, header dumps) from the scratchpad directory.
  - Killed the dev server; confirmed `lsof -ti:3000` returns nothing (port free).

### Outputs

- No implementation source files modified — this is a verification-only pass.
- Read: `src/lib/receipt-storage/index.ts`,
  `src/app/api/admin/ledger/transactions/[id]/receipt/route.ts`,
  `src/app/api/admin/ledger/reimbursements/[id]/receipt/route.ts`,
  `src/lib/receipt-storage/receipt-storage.test.ts`,
  `src/app/api/admin/ledger/transactions/route.ts` (to confirm the POST body contract for the
  live re-test).
- No new scratch artifacts left behind — all deleted at the end of this session (verified via
  `ls .receipt-store/` and the SQL count queries above).
- No `docs/decisions.md` entry — nothing structural changed this pass.

### Gate results (this addendum)

- `pnpm exec tsc --noEmit` — clean.
- `pnpm test` — 404/404 passing, 12 files, 282ms.
- `pnpm build:only` — exit 0, clean.
- Live byte-compare (transactions receipt route): 168/168 bytes, exact match.
- Live byte-compare (reimbursements receipt route): 168/168 bytes, exact match.
- Keep-alive / repeated-fetch check: no corruption, no dropped connection.

### Verdict: PASS

### Open questions / handoff notes

- **Next: analyst** for Phase 6 shipped-vs-intent. Carry forward from the prior Phase 5 pass: the
  "Fund" column addition in `all` mode is a reasonable UI necessity, not scope drift (recommend
  accepting as part of this increment). Carry forward the 10MB `formData()` message-precision gap
  as a documented, non-blocking, pre-existing note (not introduced or fixed by this feature) —
  worth a follow-up ticket if the club wants the size-specific error message to actually be
  reachable, but not a Phase 6 blocker.
- No further loop-backs needed on the receipt-view corruption bug — fixed, regression-tested at
  the unit level, and independently re-confirmed live against both affected routes with real
  byte-for-byte comparison in this addendum.

---

# Phase 6 — Shipped vs Intent (analyst)

**Owner:** analyst
**Status:** complete
**Date:** 2026-07-21

### Summary

**Verdict: SHIP IT.** The shipped feature delivers exactly what Phase 1 promised and what the user
locked in afterward: expense transactions can now have a receipt attached at create or edit time,
images are downscaled client-side to a legible-but-small JPEG before upload with an authoritative
server-side re-check, the guardrail count that started this whole request is now actionable (it
links straight to the flagged rows) and — per the user's own decision, not a Phase 1 default — can
genuinely reach zero via an audited waiver mechanism. Independently re-verified the DB end-state
myself (`147` expense rows / `0` with a receipt / `0` waived / no fund resolves to slug `all`) —
matches QA's numbers exactly, and the shape (`receipt_storage_key`, three waiver columns, correct FK)
is live. The one process bump — a real, user-facing byte-corruption bug in receipt streaming — is
exactly what the pipeline is for: QA caught it before ship, api-developer fixed it same-day with a
targeted regression test, and QA re-verified live with a byte-for-byte comparison. That is the
loop-back working as designed, not a mark against the feature.

### What I did

- Re-read this work-log in full: Phase 1 (my own prior review), Phase 2 (architect), Phase 3
  (tech-lead), all three Phase 4 increments plus the loop-back fix, and both Phase 5 passes (FAIL →
  fix → PASS).
- Independently ran read-only `psql` against the local DB (the same one QA used) to confirm the
  shipped end-state without re-trusting QA's numbers blindly:
  `SELECT count(*) FILTER (WHERE flow='expense'), count(*) FILTER (...receipt_storage_key IS NOT
  NULL), count(*) FILTER (...receipt_waived_at IS NOT NULL) FROM ledger_transactions` → **147 / 0 /
  0** — exact match to both Phase 2's original baseline and QA's post-cleanup baseline. Also
  confirmed `receipt_storage_key`/`receipt_waived_at`/`receipt_waived_by_user_id`/
  `receipt_waiver_reason` are live columns with the correct FK, and that no `ledger_funds.slug`
  equals `all` (the pseudo-slug's precondition, checked twice already by api-developer and
  ux-developer — now three-for-three).
- Read the shipped source for brand/invariant spot-checks rather than re-deriving QA's functional
  verification: `receipt-waiver-control.tsx` (`ConfirmDialog` import + usage confirmed, `rounded-2xl`
  on its `Dialog.Content`), `transaction-form.tsx` (`ConfirmDialog` import + usage for Remove),
  grepped both plus `receipt-file-input.tsx` for `window.confirm`/`alert`/`prompt` — none found.
  Grepped `src/lib/permissions.ts` to confirm `LEDGER_VIEW`/`LEDGER_RECORD`/`LEDGER_MANAGE` exist
  with the descriptions the design doc's gating argument depends on.
- Walked every flow named in my own Phase 1 review (A–E, waive, un-waive) against QA's two Phase 5
  passes' click-through evidence and api-developer/ux-developer's stated implementation, rather than
  re-running the app myself (per this task's explicit instruction: no dev server, no build gates —
  QA already ran live byte-compare verification this same day).
- Weighed the three items this task specifically flagged: the streaming defect's loop-back, the
  "Fund" column deviation, and the two known non-blocking notes (10MB message precision, waiver
  fixture gap) — see rulings below.
- Appended two items to `docs/backlog.md` (safe to append per this task's scope): a cross-reference
  note on existing **B-03** (the waiver control's `LEDGER_MANAGE` gate was verified live only against
  the all-permissions e2e admin, same root fixture gap B-03 already names) and a new **B-04** (the
  10MB upload message-precision gap). Did not touch `docs/treasurer-todo.md` or `docs/decisions.md`,
  per scope.

### Intent-vs-shipped diff

1. **"No place to add a receipt."**
   Phase 1 said: attach/replace/remove a receipt on an expense transaction, create and edit, gated
   `LEDGER_RECORD`, view gated `LEDGER_VIEW`.
   Shipped: exactly this — `receipt-file-input.tsx` in the create dialog (Flow A) and edit dialog
   (Flow B/C), a dedicated proxy view route gated `LEDGER_VIEW`, Remove behind `<ConfirmDialog
   destructive>`.
   **Verdict: matches.**

2. **"Store the receipts" (with the DECISION-020 translation surfaced to the user).**
   Phase 1 said: opaque storage key in a renamed `receipt_storage_key` column, bytes in blob storage
   (or the local dev fallback), never a client-visible URL — explicitly flagged as a translation of
   the user's "store in the database" framing, confirmed by architect in Phase 2.
   Shipped: exact match — column renamed (verified data-free, 147/147 preserved, by both database-
   admin and my own independent re-check), key format regex-validated server-side, bytes streamed
   through an auth-gated proxy, never a raw URL.
   **Verdict: matches.**

3. **"Scale pictures down small but still legible."**
   Phase 1 said this needed a concrete number from tech-lead; no number existed at Phase 1.
   Shipped: 1600px long edge, JPEG quality 0.82, PNG normalized to JPEG, PDFs pass through
   untouched — QA independently verified this against a real 2400×1200 upload through the actual UI
   path and confirmed the stored/streamed file measured exactly 1600×800 via `sips`.
   **Verdict: matches** (Phase 1 deferred the number; Phase 3 set it; QA proved it lands).

4. **Historical backlog / waiver mechanism.**
   Phase 1 recommended shipping upload-only and treating a waiver as a separate decision unless the
   user said otherwise. The user explicitly overrode that recommendation and chose the waiver
   mechanism for this increment, with a recorded reason and audit columns.
   Shipped: three-column waiver (`receiptWaivedAt`/`receiptWaivedByUserId`/`receiptWaiverReason`),
   gated `LEDGER_MANAGE` (a step-up from `LEDGER_RECORD`, argued by architect from the existing
   `LEDGER_APPROVE`-vs-`LEDGER_RECORD` precedent), 409 if a receipt is already attached, waiver
   clears automatically on real-receipt attach, un-waive restores the flag. All of this was
   independently confirmed live by QA (waive/un-waive/re-attach-clears-waiver, items 8–11 of the
   click-through) and matches the user's decision precisely.
   **Verdict: matches the user's decision** (a deliberate, confirmed deviation from Phase 1's own
   *recommendation* — correctly so, since the user, not the analyst, gets the final call on scope).

5. **Guardrail becomes actionable.**
   Phase 1 flagged the bare, unlinked count as a gap; the user then explicitly chose to fix it in
   this same increment.
   Shipped: `GuardrailFlag.linkHref` renders as "View flagged transactions →" at both call sites
   (`ledger-entity-detail.tsx`, `compliance/page.tsx`), landing on the new `/admin/ledger/all`
   entity-wide filtered view — QA drove this live (click-through item 12) and confirmed the correct
   title/filter/Fund column.
   **Verdict: matches.**

6. **Non-expense rows.**
   Phase 1 flagged as an open question; the user answered expense-only for v1.
   Shipped: `showReceiptSection` in `transaction-form.tsx` explicitly excludes transfers and
   non-expense flows; the guardrail and waiver logic are both hard-gated to `flow === 'expense'`
   (`isReceiptMissing()`, waive route's 400).
   **Verdict: matches.**

### Deviation ruling — the "Fund" column in `all`-mode

Increment C added a "Fund" column to the transaction table, visible only in the new entity-wide
`all` pseudo-fund-slug mode, and flagged it as a deviation for my review. **Ruling: necessary UI,
not scope drift — accepted as part of this increment, no follow-up needed.**

Reasoning: architect's Ruling 7 required the guardrail link to target an entity-wide view (Check 11
is computed per-entity-across-all-funds, so a single-fund link would misrepresent the flagged set).
Once the fund-scoped frame of reference is gone, the existing Party/Fund column's transfer-partner
lookup has nothing to resolve "the other side" against — some way to convey which fund each row
belongs to is a requirement for the entity-wide list to be legible at all, not an optional
embellishment layered on top of the ask. No API or data-model surface was added to support it
(`fundNameMap` already existed); it's presentational only, and QA independently confirmed it renders
correctly for both regular and transfer rows in `all` mode. This is the correct kind of drift: the
architecture required a consequence the design doc didn't spell out verbatim, and the implementer
resolved it in the simplest honest way rather than punting or hacking the existing column.

### Streaming-defect loop-back — process ruling

The Phase 5 FAIL (both receipt-view routes streaming a stale Buffer-pool memory fragment instead of
the actual file, for any receipt under ~4KB) is weighed as **the pipeline working as designed, not a
mark against the feature or the increment that shipped it.** Specifics:

- The bug was inherited from the pre-existing reimbursement proxy route, which this increment was
  explicitly instructed (Phase 2/3) to mirror "exactly" — copying a real, already-live latent defect
  is a legitimate failure mode for a mirror-the-precedent design, not a new mistake introduced this
  increment.
- QA found it via the layer of verification built for exactly this: a manual click-through with a
  genuinely small real file, not a synthetic/adversarial one — this is precisely the "reproducible,
  concrete defect" bar the pipeline sets for a FAIL regardless of how much else is green.
- The fix (`receiptBytesToBodyInit()`, a `Uint8Array.from()` copy) is correct by construction (no
  `as` cast hiding a wrong-region read), was proven against a standalone repro before and after, and
  was applied to **both** affected routes in one pass rather than just the new one — closing the
  bug at its actual root (a shared, previously-copy-pasted body-construction pattern) instead of
  patching only the file this increment touched.
- Re-verification was independent and live: a genuine 168-byte PDF through the real upload → attach
  → view round trip on both routes, byte-for-byte `cmp`, plus a keep-alive-corruption re-check. Not
  a re-run of the same unit tests — an actual repeat of the failing scenario.
- Net effect: the reimbursement flow is now *also* fixed as a side effect of this feature's QA pass,
  which is a real, if incidental, win beyond this ticket's own scope.

### Edge cases (per template)

| Case | Verdict | Notes |
|---|---|---|
| Empty state | pass | `all`-mode + `receipt=missing` empty copy ("No expense transactions are missing a receipt in FY…") correctly reads as "backlog is clear," not "nothing exists here" — the right empty-state framing for a filtered compliance view. |
| Failure microcopy | pass | Upload failure renders inline (`role="alert"`) and never blocks the transaction save (verified by QA, both code-read and live); 404 on missing/deleted blob renders human JSON, confirmed live. |
| Permission gates | pass, with a coverage caveat | All three tiers (`LEDGER_RECORD` attach, `LEDGER_VIEW` view, `LEDGER_MANAGE` waive) confirmed present server-side by QA's route-level source audit and exercised live for the all-permissions e2e admin. The `LEDGER_MANAGE`-vs-`LEDGER_VIEW` boundary specifically was **not** exercised live from a restricted session — code-read only for that one distinction. Tracked as a fixture gap (B-03), not a functional gap: the gate exists in source and is the correct key: verified by two independent readers (QA, then me) of the same route file. |
| Mobile (360px) | pass | QA drove the file input, waiver dialog, and the now-wider (`all`-mode Fund column) table at 360px live; confirmed no page-level horizontal overflow. |

### Known non-blocking notes — final disposition

- **10MB `formData()` message-precision gap.** Pre-existing on both upload routes before this
  feature (inherited, not introduced), confirmed by QA to be a copy-precision gap only — the user
  still gets a human-readable 400, just the generic one instead of the size-specific one. Logged as
  **B-04** in `docs/backlog.md` this session. Not a ship blocker: no crash, no silent failure, no
  data loss.
- **Waiver UI never live-tested against a `LEDGER_VIEW`-only session.** This is the fixture gap
  `B-03` already names (an e2e admin bound to every `FEATURES.*` key is the only signed-in fixture
  available); the underlying server-side gate was verified correct by source read twice over
  (QA, then me, independently). Cross-referenced onto `B-03` this session rather than opening a
  duplicate ticket, since it's the identical root cause B-03 already tracks.

### Follow-ups (tracked, non-blocking — feature ships without them)

- **B-04** (new, this session) — oversized-upload error message is unreachable; fix scope TBD, not
  urgent.
- **B-03** (existing, cross-referenced this session) — e2e fixture for a restricted admin session;
  now also covers this feature's `LEDGER_MANAGE` boundary, not just the original `admin.security_view`
  case.

Neither blocks ship. Both are fixture/tooling debt, not user-facing defects.

### Outputs

- `docs/work-log/2026-07-21-transaction-receipts.md` — this Phase 6 section, and the Per-Phase
  Status table's Phase 6 row updated to `Complete` / `SHIP IT` / 2026-07-21.
- `docs/backlog.md` — appended a cross-reference note to **B-03** and added new **B-04**.
- No other files modified. No dev server started, no build/test gates re-run (per this task's
  instructions) — relied on QA's Phase 5 live byte-compare evidence, independently spot-checked via
  read-only `psql` (147/0/0 expense-receipt-waiver counts, correct columns/FK, no fund slug `all`)
  and targeted source reads (ConfirmDialog usage, `rounded-2xl`, no native dialogs, `LEDGER_*`
  feature keys).

### Open questions / handoff notes

- None blocking. This closes the pipeline for `2026-07-21-transaction-receipts.md`.
- Next work, if picked up later: **B-01** (Ledger user's guide) should eventually document the
  receipt-upload and waiver flow once written; **B-04** and the `B-03` cross-reference are available
  for whoever next touches e2e fixtures or upload-size handling.
