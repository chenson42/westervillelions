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
| 4 — Implementation | TBD by tech-lead | In progress — schema complete | — | 2026-07-21 |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

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

# Phase 5 — Verification (qa)

_(pending)_

---

# Phase 6 — Shipped vs Intent (analyst)

_(pending)_
