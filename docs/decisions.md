# Decisions Log

Architectural and implementation decisions for the Westerville Lions Club website. Newest first. Each decision is numbered; the number does not change once assigned.

## Format

Each decision uses this shape:

```markdown
## DECISION-NNN: [One-line title]

**Status:** Resolved | Superseded by DECISION-MMM | Under review
**Date:** YYYY-MM-DD

**Decision:** [What we decided.]

**Rationale:** [Why we decided it — the tradeoff named out loud.]

**Impact:** [What changes in the codebase as a result; any follow-ups.]

---
```

- **Architectural decisions** (new top-level directories, new npm dependencies, structural changes) are owned by the architect agent.
- **Implementation decisions** (data shape, API surface, where logic lives, library choice within already-approved deps) are owned by the tech-lead agent.

Both kinds live in this single file, newest first. Numbers are assigned in order and never reused.

---

## DECISION-020: Receipt storage is pluggable via a `ReceiptStorage` interface; proxy routes stream content; store an opaque key, not a provider URL

**Status:** Resolved
**Date:** 2026-06-25

**Decision:**
Receipt file storage is exposed through a **`ReceiptStorage` interface** (three methods: `save`, `read`, `delete`) with two concrete adapters selected at runtime by environment:

- **`VercelBlobStorage`** (default in production): wraps `@vercel/blob`. Blobs are written under `receipts/<uuid>/<sanitized-name>` with `access: 'public'` but UUID-namespaced. The adapter is lazy-imported (`import()`) inside its module file so that local dev never loads the `@vercel/blob` package.
- **`LocalReceiptStorage`** (default when `BLOB_READ_WRITE_TOKEN` is absent): writes files under a `.receipt-store/` directory in the repo root (added to `.gitignore`). Reads and streams from disk. Requires zero configuration — no env var, no Vercel account.

Selection rule: `getReceiptStorage()` checks `process.env.BLOB_READ_WRITE_TOKEN`; if set, returns a `VercelBlobStorage` instance; otherwise returns a `LocalReceiptStorage` instance.

**Column rename:** `ledger_reimbursements.receipt_url` is renamed to `receipt_storage_key` (`text NOT NULL`). The column stores an opaque, provider-neutral key (e.g., `receipts/<uuid>/<filename>`) — not a full Vercel Blob URL. This is provider-agnostic and works identically for both adapters.

**Proxy routes stream bytes, not redirect.** `GET /api/members/reimbursements/[id]/receipt` and `GET /api/admin/ledger/reimbursements/[id]/receipt` call `getReceiptStorage().read(key)`, then return the raw bytes with `Content-Type: <contentType>` and `Content-Disposition: inline`. They do NOT redirect to any storage URL. The storage URL/path is never sent to the browser. This works identically for Vercel Blob and local-filesystem, and is strictly more private than a redirect.

**Upload route** returns `{ key: string }` (not `{ url: string }`). The key is stored in `receipt_storage_key`. The browser never learns the underlying blob URL or local path.

**`isBlobUrl()` is removed.** Because the upload route returns an opaque key (not a URL) and the column stores that key, there is no external-URL injection surface to validate. The Blob URL allow-list check on PATCH is replaced by a format check: the key must match the pattern `receipts/<uuid>/<filename>` and must exist in the storage (the read call returns null if not).

**`BLOB_READ_WRITE_TOKEN`** is required only in production. It is absent locally, and local dev needs no storage config at all.

**Rationale:**
DECISION-018 mandated Vercel Blob as the production storage provider — this decision does not change that. It adds a pluggability layer that fixes two problems DECISION-018 left open: (1) the original design required `BLOB_READ_WRITE_TOKEN` in local dev even though Vercel Blob cannot be used locally without network access and a real Blob store; (2) the redirect-based proxy model exposed the Vercel Blob CDN URL to the browser for the duration of the browser fetch, creating a window where the URL could be intercepted and reused without auth. Streaming the bytes from the server through the proxy closes that window and makes the two adapters behaviorally identical. The local adapter costs zero production-runtime overhead (never loaded) and zero configuration.

The `ReceiptStorage` interface also future-proofs the design: swapping to Cloudflare R2 or S3 in a future increment is a new adapter module, not a rewrite of upload/proxy routes.

**Impact:**
- New module: `src/lib/receipt-storage/index.ts` (interface + `getReceiptStorage()` factory + re-exports).
- New module: `src/lib/receipt-storage/vercel-blob.ts` (VercelBlobStorage adapter).
- New module: `src/lib/receipt-storage/local.ts` (LocalReceiptStorage adapter).
- `.receipt-store/` added to `.gitignore`.
- `src/lib/blob.ts` is **not created** (superseded by the receipt-storage module).
- `ledger_reimbursements.receipt_url` is **renamed** to `receipt_storage_key text NOT NULL` in migration `0046_ledger_controls.sql` and in `schema.ts`.
- Upload route returns `{ key }` instead of `{ url }`.
- Proxy routes (`GET .../receipt`) stream bytes via `getReceiptStorage().read(key)` instead of redirecting.
- `isBlobUrl()` helper is not needed and is not created.
- Refines DECISION-018.

---

## DECISION-019: Receipt file-type validation — hand-rolled magic-byte check, no `file-type` npm package

**Status:** Resolved
**Date:** 2026-06-25

**Decision:**
The receipt upload handler in `src/app/api/members/reimbursements/upload/route.ts` validates file type via a **hand-rolled magic-byte inspection** of the first 8 bytes of the uploaded buffer. No additional npm package (`file-type` or otherwise) is added. Supported formats and their byte signatures:

| Format | Bytes checked |
|--------|--------------|
| PDF | `25 50 44 46` (first 4: `%PDF`) |
| JPEG | `FF D8 FF` (first 3) |
| PNG | `89 50 4E 47 0D 0A 1A 0A` (all 8) |

If the buffer does not match any of these signatures, the handler returns 400. Content-Type from the request header is used as a hint for the error message only — the magic bytes are the authoritative check.

**Rationale:**
The `file-type` npm package (~50 KB, MIT, ESM-only) would work correctly for this use case. However, this project must validate exactly three MIME types (PDF, JPEG, PNG). The magic bytes for all three fit in a trivial 10-line helper function. Adding a dependency for three byte comparisons introduces: (1) a package to audit at every `pnpm audit` run; (2) ESM-only compatibility surface to manage in a Next.js App Router project; (3) ongoing maintenance cost if the package releases breaking changes. The hand-rolled check is simpler, has zero maintenance surface, is fully transparent to the reader, and is correct for the use case. The dependency evaluation criteria prefer the option already available — in this case, Node.js `Buffer` comparison — when it solves the problem adequately.

**Impact:**
- No new npm package.
- The magic-byte logic lives in `src/lib/blob.ts` (the `uploadReceipt` helper). It is unit-testable with a three-case Vitest test (valid PDF, valid JPEG, invalid content).
- If a future increment requires a broader set of supported file types (e.g., Word docs, spreadsheets), this decision should be revisited and `file-type` evaluated at that time.

---

## DECISION-018: Receipt file storage for ledger reimbursements — Vercel Blob with server-minted signed URLs

**Status:** Resolved
**Date:** 2026-06-24

**Decision:**
Receipt files for `ledger_reimbursements` are stored in **Vercel Blob** (`@vercel/blob` npm package, new dependency). Blobs are uploaded server-side from the receipt-upload route handler (never from the browser directly to Blob), minted with `put(path, stream, { access: 'public' })` but placed under a UUID path that is not guessable. All receipt reads from the member portal or admin UI go through a **server-side proxy route** (`GET /api/members/reimbursements/[id]/receipt` for the member, `GET /api/admin/ledger/reimbursements/[id]/receipt` for officers) that verifies session + ownership/permission before redirecting to the blob URL. The blob URL itself is never embedded in HTML or returned in JSON to the client; every access is mediated by a server check.

Required new env var: `BLOB_READ_WRITE_TOKEN` (Vercel Blob store token).

The `receiptUrl` column on `ledger_reimbursements` stores the full Vercel Blob URL (e.g., `https://<store>.public.blob.vercel-storage.com/<uuid>/<filename>`). File-type validation (PDF, JPEG, PNG; max 10 MB) is enforced server-side in the upload handler before writing to Blob.

The existing `receiptUrl` text field on `ledger_transactions` (ordinary transactions, FU-3) remains a paste-URL text field for now — no file-upload UX for ordinary transactions in inc2. The file-storage decision applies only to `ledger_reimbursements` in this increment.

The `public/uploads`-based upload handler at `src/app/api/admin/upload/route.ts` (used for campaign images) is left untouched; that surface is not financial and ephemeral loss there is acceptable. Receipt files are financial documents with a 7-year retention requirement — they require durable object storage.

**Rationale:**
- `public/uploads` + `writeFile` is already used for campaign images and is the only file-upload precedent in the codebase. That handler was confirmed unacceptable for receipts: Vercel's serverless runtime provides no persistent local disk, so any file written to the local filesystem is lost between invocations and certainly lost on redeployment. Financial documents with a 7-year retention requirement cannot use ephemeral storage.
- **Vercel Blob** is the correct fit: the project is deployed on Vercel, Blob is native to the platform (no cross-provider credentials, no separate CDN), it is actively maintained, and the `@vercel/blob` package adds negligible bundle weight to a server-only upload route. License: Apache-2.0.
- **Cloudflare R2 / S3** would work but introduce additional cross-provider credentials (`AWS_ACCESS_KEY_ID`, etc.) and a heavier SDK for a single use-case in a small club app. The dependency evaluation criteria prefer the option that is already available in the deploy environment.
- **Storing blobs in Postgres** (bytea) is rejected: blob columns at multi-MB scale degrade query performance across all tables sharing the DB connection pool and violate the principle of keeping the DB for structured data only.
- The access-control model (server proxy, never raw blob URL to the client) provides defense-in-depth: even if a blob URL were somehow leaked, the server route is the only entry point that links the UUID path back to a member identity or a permission check.

**Impact:**
- New npm dependency: `@vercel/blob`. Add to `package.json` (production dependency).
- New env var: `BLOB_READ_WRITE_TOKEN` — deployment-engineer must document in Vercel environment variables.
- New upload route: `src/app/api/members/reimbursements/upload/route.ts` — accepts a multipart file, validates type + size, calls `put()`, returns the blob URL to the server action (not to the browser). This is a server action or route handler intermediary, not a direct browser-to-Blob upload.
- New receipt-proxy routes: `GET /api/members/reimbursements/[id]/receipt` (auth + memberId ownership check → redirect) and `GET /api/admin/ledger/reimbursements/[id]/receipt` (auth + `LEDGER_VIEW` → redirect).
- `ledger_reimbursements.receiptUrl` column: `text NOT NULL` (required — every reimbursement must have a receipt).
- `ledger_transactions.receiptUrl` remains text (paste-URL) for ordinary transactions — no file upload in inc2 for that surface.
- Security review must audit: upload file-type sniffing (MIME type from Content-Type header is spoofable — server must also inspect the first bytes), size limit enforcement, that the blob path is UUID-namespaced (not predictable), and that the proxy routes return 404 (not 403) for IDs that exist but belong to another member.

---

## DECISION-017: Ledger `flow` column stores `'income' | 'expense'` only; `transferGroupId` is the transfer discriminator

**Status:** Resolved
**Date:** 2026-06-24

**Decision:**
The `flow` column on `ledger_transactions` takes only two values: `'income'` and `'expense'`. It does NOT store a third value `'transfer'`. For a transfer pair (two linked rows per DECISION-016), the debit row stores `flow = 'expense'` and the credit row stores `flow = 'income'`. The `transferGroupId` UUID column (non-null on both rows of a pair) is the sole discriminator used to: (a) label rows as "Transfer" in the UI, (b) enforce two-row atomic delete/edit, and (c) join transfer pairs in the inc2 firewall guardrail. No check constraint on `flow` may include `'transfer'` as a valid value.

**Rationale:**
DECISION-016 established two linked rows so that `fundBalanceCents()` can be a single-pass sum with no special cases. That property only holds if `flow` encodes the sign direction (`'income'` = positive, `'expense'` = negative) on each row independently. If `flow = 'transfer'` were stored, the balance helper would need to know whether the queried fund is the source (debit) or destination (credit) of each transfer row — reintroducing exactly the asymmetry DECISION-016 was designed to eliminate. The spec and DECISION-016 text reference `flow = 'transfer'` as the *conceptual* category, not a literal column value; this decision binds the implementation to the reading that preserves the single-pass property.

**Impact:**
- `ledger_transactions.flow` check constraint (if any): `flow IN ('income', 'expense')` — no `'transfer'`.
- `fundBalanceCents()` in `src/lib/ledger.ts`: income rows add, expense rows subtract, no other branch needed.
- UI code that renders "Transfer" derives the label from `transferGroupId IS NOT NULL`, not from `flow = 'transfer'`.
- The inc2 firewall guardrail joins on `transferGroupId` and checks `sourceFund.kind` vs `destFund.kind` — it does not filter on a `flow` value.

---

## DECISION-016: Ledger transfer representation — two linked rows via `transferGroupId`

**Status:** Resolved
**Date:** 2026-06-24

**Decision:**
Ledger transfers between funds are stored as **two linked rows** in `ledger_transactions`, not a single row with a `transferFromFundId` annotation. The debit row has `flow = 'expense'`, `fundId = sourceFundId`, and a UUID `transferGroupId`. The credit row has `flow = 'income'`, `fundId = destFundId`, and the same `transferGroupId`. Both rows share the same `entityId`, `txnDate`, `amountCents`, and `memo`. The server action that records a transfer inserts both rows atomically (a single DB transaction). Cross-entity transfers are not defined and must be rejected server-side.

The `flow = 'transfer'` discriminator is retained on both rows (alongside `transferGroupId`) so the UI can render them with a "Transfer" label, suppress the `party` required-field validation on the debit row, and so the inc2 firewall guardrail can detect Activity→Admin flows by joining on `transferGroupId` to find pairs where source `fund.kind = 'activity'` and destination `fund.kind = 'administrative'`.

**Rationale:**
The single-row design (one row, `transferFromFundId` nullable) makes `fundBalanceCents()` asymmetric: the helper cannot be a simple sum over `(fundId, flow)` tuples because transfer rows serve double duty — income for the destination fund, expense for the source fund in the same row. Every balance query and the inc2 guardrail would need to special-case this. The two-row design keeps `fundBalanceCents()` a single-pass sum with no special cases: each fund sums only its own rows. The firewall guardrail becomes a straightforward join on `transferGroupId`. Both the debit and credit appear in their respective fund ledgers as first-class rows, satisfying the audit-trail requirement symmetrically.

**Impact:**
- `ledger_transactions` gains a nullable `transferGroupId uuid` column (no FK — it is a self-join key within the same table).
- `src/lib/ledger.ts` — `fundBalanceCents()` sums all rows for a fund by sign (income positive, expense negative) with no transfer special-case.
- The server action for recording a transfer inserts two rows in a single DB transaction. The form UI collects source fund, destination fund, amount, date, memo — one submission.
- `flow = 'transfer'` is still a valid discriminator value and appears on both rows of a transfer pair.
- `transferFromFundId` column from the spec prototype is dropped — that was a demo-prototype artifact, not a schema commitment.

---

## DECISION-015: Fiscal-year convention is start-year, shared via `src/lib/fiscal-year.ts`

**Status:** Resolved
**Date:** 2026-06-24

**Decision:**
The Lions fiscal year (Jul 1 – Jun 30) is labeled by its **starting** calendar year everywhere in the app: `FY2026 = Jul 1 2026 – Jun 30 2027`. The helpers `getFiscalYear` / `currentFiscalYear` / `fiscalYearLabel` are extracted from `src/lib/dues.ts` into a single shared module `src/lib/fiscal-year.ts` (re-exported from `dues.ts` for back-compat). The forthcoming Ledger accounting feature imports from `@/lib/fiscal-year` rather than redefining it.

**Rationale:**
The Ledger prototype (`Westerville_Lions_Ledger.html`) labeled the same 12 months by their **ending** year (`FY2026 = Jul 2025 – Jun 2026`) — off by one from the shipped dues feature. Two features disagreeing on what "FY2026" means would cause treasurers to record dues and accounting against different windows and mis-file. The transparency doc's per-capita cycle (Jul 2026 → Jun 2027 as one Lions year) matches the start-year labeling already shipped in dues, so we standardize on it and give it one home.

**Impact:**
New file `src/lib/fiscal-year.ts`; `dues.ts` now re-exports the three helpers (no behavior change — dues was already start-year, so no data migration). The Ledger spec (`docs/features/the-ledger-accounting.md`, §2) and all future ledger fiscal-year math depend on this module. The prototype's end-year labeling is explicitly dropped.

---

## DECISION-014: Dues Tracking scope expansion — treasurer role, two-amount dues_settings, dues_category on members, new permission keys

**Status:** Resolved
**Date:** 2026-06-24

**Decision:**
Five implementation-level decisions added in the Phase 3 loop-back revision after scope expansion (work-log: `docs/work-log/2026-06-24-dues-tracking.md`):

1. **New `treasurer` role seeded at sort_order 3.** The existing role order (admin=1, board_member=2, member=3, volunteer=4) gains `treasurer` at position 3; `member` shifts to 4, `volunteer` to 5. The migration uses conditional UPDATEs (`WHERE name = 'member' AND sort_order = 3`) to make the bump idempotent. `ROLES.TREASURER = "treasurer"` added to `src/lib/permissions.ts`.

2. **Two permission keys replace the old single `dues.view` / `membership.manage` design.**
   - `FEATURES.DUES_VIEW = "dues.view"` — read gate. Bound to `admin` + `board_member` + `treasurer`.
   - `FEATURES.DUES_MANAGE = "dues.manage"` — write gate. Bound to `admin` + `treasurer` ONLY. `membership.manage` is NOT the dues write gate. Membership managers who are not admins or treasurers have no dues write access.
   - All read surfaces gate on `hasAnyFeature([DUES_VIEW, DUES_MANAGE])`. All write surfaces gate on `hasFeature(DUES_MANAGE)`. CSV export gates on `hasAnyFeature([DUES_MANAGE, REPORTS_EXPORT])`.

3. **`dues_settings` holds two amounts per fiscal year.** The single `expected_amount_cents` column from DECISION-013 does not exist. The table has `individual_amount_cents` and `family_amount_cents` instead. The status query resolves the applicable amount with a CASE expression keyed on `m.dues_category`. FY2026 seed: individual 12000 cents ($120.00), family 9600 cents ($96.00).

4. **New `members.dues_category` column (`text NOT NULL DEFAULT 'individual'`).** Values: `individual | family`. Set by treasurer/admin on the per-member dues detail page via `PATCH /api/admin/dues/[memberId]/category`. Existing members default to `individual` via the column default. Changing the category retroactively recomputes status for all fiscal years (acceptable at club scale; documented in UI).

5. **Named treasurer role assignments in migration.** Chris Henson (chenson42@gmail.com) and James Shively (jmshively@gmail.com) receive the `treasurer` role via idempotent email-keyed `user_roles` INSERTs in `0040_dues_tracking.sql`. Email keys (not UUID) ensure the migration works in production without hardcoding environment-specific IDs.

**Rationale:** A separate `treasurer` role with its own permission key keeps financial write access narrowly scoped without requiring new UI for role management. The two-amount design is the minimal extension for a family discount: one row per year, two columns, resolved at query time. Putting `dues_category` on the member (not per payment or per fiscal year) reflects the reality that membership type is a stable attribute of the person, not a per-year decision. Email-keyed user assignments are idempotent across environments.

**Impact:**
- `src/lib/db/schema.ts` — `duesCategory` column on `members`; `individualAmountCents` + `familyAmountCents` on `duesSettings` (no `expectedAmountCents`).
- `src/lib/permissions.ts` — `DUES_VIEW`, `DUES_MANAGE` in `FEATURES`; `TREASURER` in `ROLES`.
- `drizzle/migrations/0040_dues_tracking.sql` — DDL + treasurer role seed + sort_order bumps + FY2026 seed + user_roles bindings.
- `drizzle/migrations/0041_dues_permissions.sql` — both feature rows + role bindings.
- `src/lib/dues.ts` — `deriveStatus()` takes `(totalPaidCents, expectedCents | null)`.
- New API endpoint: `PATCH /api/admin/dues/[memberId]/category`.
- New admin component: `DuesCategoryControl` on per-member detail page.
- New admin component: `DuesConfigureModal` (two-input) on dues list page.

**Amends:** DECISION-013 — the Impact bullet for `dues_settings.expected_amount_cents` is superseded. The fiscal-year integer convention and integer-cents storage decisions in DECISION-013 remain valid and unchanged.

---

## DECISION-013: Dues Tracking — fiscal year as starting integer, amounts as integer cents, status derived on read

**Status:** Resolved (Impact amended by DECISION-014 — `dues_settings` has two amount columns, not one)
**Date:** 2026-06-24

**Decision:**
Three implementation-level data choices for the `dues_payments` and `dues_settings` tables:

1. **Fiscal year stored as a single integer (the starting calendar year).** FY2026 = Jul 1 2026 – Jun 30 2027 is stored as `fiscal_year = 2026`. The helper `getFiscalYear(date)` in `src/lib/dues.ts` maps any payment date to this integer: if the month is January–June (0–5), return `year - 1`; if July–December (6–11), return `year`. This avoids storing a date range per year and avoids any ambiguity about which year a row belongs to. Display label is `FY2026 (Jul 2026 – Jun 2027)`.

2. **Amounts stored as integer cents.** `amount_cents: integer` avoids floating-point rounding on financial values. The UI divides by 100 for display and multiplies by 100 on input. Negative values represent refunds/reversals. Zero is disallowed at the application layer (validated before insert).

3. **Dues status (Paid / Partial / Unpaid) computed on read, never stored.** Status = `COALESCE(SUM(amount_cents), 0)` for a `(member_id, fiscal_year)` pair, compared to the applicable `dues_settings` amount for that year (individual or family, per DECISION-014). No denormalized status column on `members` or `dues_payments`. This eliminates the risk of stale cached status and keeps the data model minimal; the club's scale (~100 members) makes the GROUP BY query negligible.

**Rationale:** Integer fiscal year is unambiguous and queryable with a simple equality filter. Integer cents is standard practice for financial storage at any scale. Derived status avoids the class of bugs where a stored flag diverges from the actual payment sum after an edit or delete.

**Impact:**
- `dues_payments.fiscal_year`: `integer NOT NULL`
- `dues_payments.amount_cents`: `integer NOT NULL` (non-zero enforced at app layer)
- `dues_settings`: two amount columns — `individual_amount_cents` and `family_amount_cents` (see DECISION-014; the single `expected_amount_cents` column is superseded)
- `src/lib/dues.ts` — new file: `getFiscalYear()`, `currentFiscalYear()`, `fiscalYearLabel()`, `deriveStatus()`
- No stored status column anywhere.

---

## DECISION-012: Dues Tracking — separate `/admin/dues` route, `DUES_VIEW` permission key, CSV via Response + manual encoding, member-portal path reserved

**Status:** Resolved
**Date:** 2026-06-24

**Decision:**
Four structural rulings for the Annual Membership Dues Tracking feature (work-log: `docs/work-log/2026-06-24-dues-tracking.md`):

1. **Separate `/admin/dues` route, not a tab under `/admin/membership`.** The existing `/admin/membership` route is scoped to membership *applications* (the `membership_applications` table). Dues tracking is a financially distinct domain (a `dues_payments` table linked to `members`). Merging the two would conflate a one-time intake workflow with a recurring per-year ledger, creating a surface with two unrelated data models and two unrelated permission audiences. The new route lives at `src/app/(dashboard)/admin/dues/` with its own top-level sidebar entry, gated on the new `DUES_VIEW` key. A sub-route at `src/app/(dashboard)/admin/dues/[memberId]/` holds per-member detail. The admin API handlers live under `src/app/api/admin/dues/`.

2. **New `DUES_VIEW` feature key added to the `FEATURES` catalog.** The analyst's Option A (new `dues.view` key, bound to `board_member` and `admin`) is the architecturally correct choice. Option B (grant `membership.manage` to `board_member`) would give board members write-API access even when the UI hides controls — a quiet invariant violation. `DUES_VIEW` becomes the read gate; `MEMBERSHIP_MANAGE` remains the write gate. Page-level and API-level checks use `hasFeature()` with these two keys; no second gating mechanism is introduced.

3. **Export uses `Response` with hand-rolled CSV, not `exceljs`.** The existing `exceljs` export produces an `.xlsx` file targeted at Zeffy's import format. The dues export is a plain auditor CSV (name, email, year, amount, status). Adding a 1 MB+ Excel workbook for six columns of plain text is not justified. A hand-rolled `text/csv` response — already a supported output of the native `Response` API in Node — keeps the bundle clean. `exceljs` is not introduced as a new dependency for this surface.

4. **Member self-view path reserved at `/members/dues` but not built in this increment.** If member self-view is added later, it lives in the existing `src/app/members/` route group (already authenticated), not in `/(dashboard)/admin`. No code is written for this path now; the reservation is noted so the data model (Phase 3) does not foreclose it.

**Rationale:** Separating dues from membership applications keeps each admin surface coherent. A new permission key is the only correct enforcement model for the read-vs-write split. Hand-rolled CSV avoids a new dependency. Reserving the member self-view path prevents a schema decision from accidentally locking out the future increment.

**Impact:**
- `src/app/(dashboard)/admin/dues/` — new route directory (Phase 4).
- `src/app/(dashboard)/admin/dues/[memberId]/` — new sub-route for per-member detail (Phase 4).
- `src/app/api/admin/dues/` — new API route directory (Phase 4).
- `src/components/admin/admin-sidebar.tsx` — new "Dues" entry gated on `DUES_VIEW` (Phase 4).
- `src/lib/permissions.ts` — `DUES_VIEW: "dues.view"` added to `FEATURES` (Phase 4, via add-permission skill).
- `drizzle/migrations/` — idempotent migration binding `dues.view` to `admin` and `board_member` roles (Phase 4, via add-permission skill).
- No new npm dependencies introduced.

---

## DECISION-011: Write-in Signups implementation details — `kind` discriminator, shared `AdminRsvpRow` type, no `force` flag, no server capacity check

**Status:** Resolved
**Date:** 2026-05-20

**Decision:**
Four implementation-level rulings for the Write-in Signups feature, downstream of DECISION-010:

1. **Explicit `kind` discriminator in POST body.** `POST /api/admin/events/[id]/signup` uses `{ kind: "member" | "guest", ... }` as the discriminator rather than inferring intent from the presence/absence of `userId`. If `kind` is absent but `userId` is present, the server treats it as `kind: "member"` for backward compatibility during the transition (existing call sites in `occurrence-rsvp-section.tsx` and `admin-event-rsvp-table.tsx` do not yet send `kind`; they are updated in step 8 of the implementation order).

2. **`AdminRsvpRow` hoisted to `src/types/admin-rsvp.ts`.** The local `RsvpRowData` interface in `occurrence-rsvp-section.tsx` and the local `RsvpRow` interface in `admin-event-rsvp-table.tsx` are equivalent types with different names. `WriteInForm`'s `onAdded` callback would require a mapped adapter at each call site if the types stayed local and diverged. Hoisting to `src/types/admin-rsvp.ts` resolves the naming conflict, removes the adapter risk, and gives TypeScript a single source of truth for the admin attendee row shape. The raw DB query result type (`RsvpRow` in `page.tsx` lines 12–20) stays local — it represents the pre-consolidation Drizzle query shape and is not the same thing.

3. **No `force: true` flag in the POST body.** The server never enforces a capacity cap on the admin signup path (existing behavior). The inline client warning (yellow advisory above the submit button) is the only capacity signal. The `created_by_user_id` audit column implicitly records admin-initiated override inserts. Adding a `force` flag would introduce a code path with no observable server-side effect.

4. **No server-side capacity check on admin POST.** Consistent with existing behavior — the admin path bypasses capacity enforcement. The client advisory warning satisfies the soft-warn policy from Phase 1.

**Rationale:** Explicit discriminators eliminate a class of client bugs (sending both `userId` and `guestName`). Hoisting the shared type captures the real duplication between the two components at the type level without merging their structurally different parents. Omitting `force` and the server cap check keeps the admin path consistent with its pre-existing behavior and avoids dead code.

**Impact:**
- `src/types/admin-rsvp.ts` — new file.
- `src/components/admin/occurrence-rsvp-section.tsx` — local `RsvpRowData` removed; imports `AdminRsvpRow`.
- `src/components/admin/admin-event-rsvp-table.tsx` — local `RsvpRow` removed; imports `AdminRsvpRow`.
- `src/app/(dashboard)/admin/events/[id]/page.tsx` — row-mapping output typed as `AdminRsvpRow`; `isGuest: !r.userId` added to non-recurring rows.
- `src/app/api/admin/events/[id]/signup/route.ts` — POST branches on `kind`; backward-compat fallback for absent `kind`.

---

## DECISION-010: API shape, lookup endpoint, component placement, and schema addition for Write-in Signups

**Status:** Resolved
**Date:** 2026-05-20

**Decision:**
Four structural rulings for the Write-in Signups feature (work-log: `docs/work-log/2026-05-20-write-in-signups.md`):

1. **Extend the existing admin signup route; no separate `/guest-signup` route.** `POST /api/admin/events/[id]/signup` accepts a discriminated body: either `{ userId, occurrenceDate? }` (existing member path) or `{ guestName, guestEmail?, occurrenceDate?, force? }` (new guest path). `DELETE` accepts either `{ userId, occurrenceDate? }` or `{ rsvpId }` (new guest path; requires eventId ownership check). A new `PATCH /api/admin/events/[id]/signup/[rsvpId]` route handles in-place guest edits at `src/app/api/admin/events/[id]/signup/[rsvpId]/route.ts`.

2. **Email-match lookup lives at `GET /api/admin/members/lookup?email=...`** (`src/app/api/admin/members/lookup/route.ts`). Gated by `FEATURES.EVENTS_EDIT` (not `MEMBERS_VIEW`). Returns only `{ id, name, email }` to limit PII exposure. No existing endpoint does a point-lookup by email; the full-list `GET /api/admin/members` over-fetches for this purpose.

3. **One shared `WriteInForm` component in `src/components/admin/write-in-form.tsx`.** Reused by both `occurrence-rsvp-section.tsx` (recurring path) and `admin-event-rsvp-table.tsx` (non-recurring path). The two call sites differ only in whether `occurrenceDate` is passed. No unification of the parent components is required.

4. **`created_by_user_id` added to `event_rsvps`.** Nullable `uuid` referencing `users.id` with `ON DELETE SET NULL`. Member self-signups leave it null; admin write-ins populate it with the session user's id. Idempotent migration: `ALTER TABLE event_rsvps ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;`. No index needed.

**Rationale:** Extending the existing route avoids duplicating auth preamble and response shape. The narrow lookup endpoint limits data exposure to exactly what the email-match CTA requires. A single shared `WriteInForm` captures the real duplication between the two admin RSVP components without merging their structurally different parent state. The audit column is low-risk (nullable, idempotent migration) and provides an accountable record for capacity-override inserts.

**Impact:**
- `src/app/api/admin/events/[id]/signup/route.ts` — extended (POST + DELETE branches).
- `src/app/api/admin/events/[id]/signup/[rsvpId]/route.ts` — new file (PATCH).
- `src/app/api/admin/members/lookup/route.ts` — new file (GET).
- `src/components/admin/write-in-form.tsx` — new file.
- `src/lib/db/schema.ts` — `createdByUserId` column added to `eventRsvps`.
- `drizzle/migrations/` — new idempotent migration for `created_by_user_id` column.
- Three latent bug fixes in `occurrence-rsvp-section.tsx`, `admin-event-rsvp-table.tsx`, and `admin/events/[id]/page.tsx` are included in the same implementation pass.

---

## DECISION-009: Component rename strategy and shadcn scaffold classification for Add-to-Calendar dropdown

**Status:** Resolved
**Date:** 2026-05-20

**Decision:**
Two structural rulings for the "Add to Calendar — Provider Dropdown" feature (work-log: `docs/work-log/2026-05-20-add-to-calendar-dropdown.md`):

1. **Rename in place, not alongside.** `src/components/events/add-to-calendar-button.tsx` is renamed to `add-to-calendar-dropdown.tsx` and its body is replaced entirely. A parallel file is not created. The old component (`AddToCalendarButton`) will have no callers after this feature ships; keeping both files creates an ambiguity that must be managed forever. Four call sites are updated as part of the same change. The new export is `AddToCalendarDropdown`.

2. **`npx shadcn@latest add dropdown-menu` is not a new npm dependency.** `@radix-ui/react-dropdown-menu` is already in `package.json`. The scaffold command generates `src/components/ui/dropdown-menu.tsx` — a TypeScript/TSX wrapper file — and adds no new entry to `pnpm-lock.yaml`. This is the same structural pattern as `src/components/ui/confirm-dialog.tsx` (a hand-written Radix wrapper). DECISION-008's "no new npm dep" ruling is preserved.

**Rationale:** Rename-in-place eliminates dead artifacts in a single commit. The shadcn scaffold ruling keeps the wrapper consistent with the rest of `src/components/ui/` without widening the dependency graph.

**Impact:**
- `src/components/events/add-to-calendar-button.tsx` → `src/components/events/add-to-calendar-dropdown.tsx` (renamed, body replaced).
- `src/components/ui/dropdown-menu.tsx` created via shadcn scaffold.
- Four call sites updated to import `AddToCalendarDropdown` from the new path.
- Dead `eventTitle` prop removed from the component and all call sites (v1.15.0 follow-up, closed here).

---

## DECISION-008: ICS generator, route, and button placement for Add-to-Calendar feature

**Status:** Resolved
**Date:** 2026-05-20

**Decision:**
Three structural rulings for the Add-to-Calendar feature (work-log: `docs/work-log/2026-05-20-add-to-calendar.md`):

1. **ICS generator lives in `src/lib/events.ts`.** The generator functions (`generateIcsEvent`, `generateIcsSeries`, `buildVcalendar`) are added as new exports to the existing file rather than a new `src/lib/ics.ts` or `src/lib/events/ics.ts`. `events.ts` already owns `generateOccurrences`, `parseWallClock`, and `easternOffsetFor` — all three are required by the ICS generator. Keeping them co-located avoids a cross-file import of a module that owns every piece of data the generator needs. File will reach ~500 lines; that is still well within a single-concern boundary.

2. **Route lives at `src/app/api/events/[id]/ics/route.ts`, not under a new `/api/ics/` namespace.** The existing public event API lives at `src/app/api/events/[id]/rsvp` and `src/app/api/events/[id]/signup`. An ICS download is another operation on the same event resource and belongs in the same resource tree. A top-level `/api/ics/` namespace adds a second resource tree that mirrors `/api/events/` without justification. A single handler at this path uses an internal branch (see ruling 3) to enforce `isPublic` vs. `FEATURES.MEMBERS_VIEW`.

3. **Single handler with an internal auth branch.** One `GET` handler checks: if the event is public (`isPublic === true`), serve the ICS to any caller; if private, require a session and `hasFeature(session.user.features, FEATURES.MEMBERS_VIEW)`. Two separate handlers (one public, one member) would share identical ICS generation logic and differ only in the five-line auth preamble — not enough divergence to justify duplication.

4. **No new npm dependency.** A hand-rolled ICS generator (~200 lines) is correct. The `ics` and `ical-generator` npm packages are actively maintained but neither is already in `package.json`. The ICS format needed here is a small, well-specified subset of RFC 5545 (VCALENDAR + VEVENT + optional VTIMEZONE). The project dependency evaluation criteria require that an existing dependency solve the problem before a new one is added. None does. Adding a new dep for ~200 lines of string building (where correctness is fully verifiable against the RFC) is not warranted. No bundle-size impact on the server-only route.

5. **`<AddToCalendarButton>` lives in `src/components/events/`.** It is an event-surface-specific component, not a general UI primitive, so `src/components/ui/` is wrong. Its only peer event components are `occurrence-signup-list.tsx` and `single-event-signup.tsx`, both already in `src/components/events/`.

**Rationale:** Nesting under the existing events resource tree and co-locating the generator with its dependencies are the two choices that minimize new indirection. The single-handler-with-branch pattern matches the existing RSVP handler, which also branches on session state internally.

**Impact:**
- `src/lib/events.ts` gains ICS generator exports (~200 lines).
- New route: `src/app/api/events/[id]/ics/route.ts`.
- New component: `src/components/events/add-to-calendar-button.tsx`.
- No new npm dependency. No new migration. No new FEATURES key.

---

## DECISION-007: `OccurrenceGroupData.date` stays typed as `Date`; `rsvpByDate` key uses `format(d, "yyyy-MM-dd HH:mm:ss")`

**Status:** Resolved
**Date:** 2026-05-18

**Decision:**
`OccurrenceGroupData.date` remains typed as `Date` (not changed to `string`). After `eventRsvps.occurrenceDate` switches to `mode: "string"`, the `rsvpByDate` map key in `src/app/(dashboard)/admin/events/[id]/page.tsx` changes from `row.occurrenceDate?.toISOString() ?? "null"` to `row.occurrenceDate ?? "null"` (plain string from DB). The lookup key at line 119 changes from `d.toISOString()` to `format(d, "yyyy-MM-dd HH:mm:ss")` (date-fns, local components) so both sides of the map use the same string format that Postgres returns.

**Rationale:** `generateOccurrences` returns `Date[]`; changing `OccurrenceGroupData.date` to `string` would cascade type changes through the entire admin page, the orphan-detection loop, and the sort comparator — more churn than benefit. The Date type is correct and coherent as long as dates are locally parsed on the way in (via `parseWallClock`). The map key format change is a surgical two-line edit that makes both sides consistent without touching the type.

**Impact:** Two lines in `src/app/(dashboard)/admin/events/[id]/page.tsx` — lines 99 and 119. No type change to `OccurrenceGroupData`.

---

## DECISION-006: Helper placement and `formatEventWhen` centralization for wall-clock refactor

**Status:** Resolved
**Date:** 2026-05-18

**Decision:**
New time helpers (`parseWallClock`, `formatEasternOffset`, `formatEventWhen`) live in the existing `src/lib/events.ts`, not in a new file or subdirectory. A single `formatEventWhen(event): string` helper is required and must be the only place that branches on `event.isAllDay` for display purposes — callers must not re-implement the branch inline.

**Rationale:** `events.ts` is 245 lines and handles a single domain. Adding three small helpers (~30 lines each) reaches ~330 lines — still cohesive. A new `src/lib/event-times.ts` file would require updating ~12 import sites and adds indirection without justification at this size. The centralized `formatEventWhen` helper is required because 10+ display sites need the all-day branch; a missing branch at any one site produces a silent wrong display (time shown when it should be omitted, or vice versa). Making the branch optional-inline creates an untestable invariant.

**Impact:** `src/lib/events.ts` gains three new exported functions. All display sites import and call `formatEventWhen` rather than branching directly on `isAllDay`.

---

## DECISION-005: Migration shape and `mode: "string"` annotation for wall-clock columns

**Status:** Resolved
**Date:** 2026-05-18

**Decision:**
One migration file (`drizzle/migrations/0037_events_wall_clock_and_all_day.sql`) adds the single new DDL change: `ALTER TABLE events ADD COLUMN IF NOT EXISTS is_all_day boolean NOT NULL DEFAULT false`. The `mode: "string"` annotation on `events.startDate`, `events.endDate`, `events.recurrenceEndDate`, and `eventRsvps.occurrenceDate` is a Drizzle TypeScript-only annotation — it instructs Drizzle to return the raw Postgres string rather than constructing a `Date` object. It emits no DDL and will not alter or drop the column on `db:push`. No second migration file is needed for the mode changes.

**Rationale:** Splitting into two migrations (one for `is_all_day`, one as a documentation note) adds file noise with no operational benefit — the mode annotation requires zero SQL. A single migration with only the `ADD COLUMN IF NOT EXISTS` statement satisfies the idempotency invariant (CLAUDE.md: "Every statement must be idempotent"). Confirming mode is DDL-safe is critical: Drizzle's `mode` option on `timestamp()` affects only the JS return type, not the Postgres column definition. The column remains `timestamp without time zone` in the database regardless of the `mode` value in `schema.ts`.

**Impact:** New file `drizzle/migrations/0037_events_wall_clock_and_all_day.sql` with one statement. `src/lib/db/schema.ts` updated to add `mode: "string"` to four columns and a new `isAllDay` boolean column on the `events` table.

---

## DECISION-004: RSVP count display on cancelled occurrence rows

**Status:** Resolved
**Date:** 2026-05-18

**Decision:**
On public and member-portal cancelled occurrence rows (`OccurrenceSignupList`), suppress the "X attendees" count and the action button entirely — render only the "Cancelled" badge and optional reason text. In the admin accordion, always show the count; admins need to know how many people were signed up before the cancellation.

**Rationale:** Showing a signup count on a row where signups are impossible is confusing to members. Admins have a legitimate need for the number (historical data; they may want to notify those members manually in v2). The difference in behavior is appropriate to the audience.

**Impact:** `OccurrenceSignupList` checks `row.isCancelled` before rendering the count `<p>` and the action button. Admin accordion header always renders its count span regardless of `isCancelled`.

---

## DECISION-003: Orphaned cancellation records surfaced in admin accordion as extra rows

**Status:** Resolved
**Date:** 2026-05-18

**Decision:**
When an admin edits the recurrence rule so that a previously cancelled date falls outside the new generated window, the cancellation record is NOT silently hidden and NOT accompanied by a warning at edit time. Instead, the admin detail page (`src/app/(dashboard)/admin/events/[id]/page.tsx`) detects orphans by comparing the `eventOccurrenceOverrides` set against the generated occurrence list and appends them to `occurrenceGroups` with a display label that includes "outside current recurrence rule." The admin can Restore (delete the record) to clean up. Sort order is chronological across generated and orphaned rows.

**Rationale:** Option (b) — warn at recurrence-rule edit time — requires changes to the event-edit form and introduces a two-step flow (edit, then decide what to do about orphans). Option (c) — leave invisible — is a data integrity risk. Option (a) is purely additive (no form changes) and keeps orphan management explicit in the same accordion where cancellations live.

**Impact:** `src/app/(dashboard)/admin/events/[id]/page.tsx` gains post-generation orphan detection logic. No new API surface required.

---

## DECISION-002: `generateOccurrences` signature unchanged; only `getNextOccurrence` gains cancellation exclusion

**Status:** Resolved
**Date:** 2026-05-18

**Decision:**
The architect's suggestion specified `generateOccurrences` should gain a `cancelledDates: Set<string>` parameter to skip cancelled dates. After reading all call-sites, this is the correct place for the exclusion on the `/events` list (next-occurrence computation) but the WRONG place for the detail-page occurrence list, where cancelled dates must APPEAR (with a badge) rather than be skipped. To avoid a confusing dual-mode parameter ("sometimes skip, sometimes don't"), the exclusion is placed only on `getNextOccurrence`, which is responsible for "what is the next bookable date." `generateOccurrences` remains a pure date generator. Callers that need the `isCancelled` flag annotate their `OccurrenceRow[]` after generation using the cancellation map fetched separately.

**Rationale:** Filtering inside `generateOccurrences` would produce inconsistent behavior depending on caller intent. The function's contract is "give me all dates in the window" — callers decide what to do with each date. `getNextOccurrence`'s contract is "give me the next actionable date" — skipping cancelled dates is correct there.

**Impact:** `src/lib/events.ts` — `getNextOccurrence` and its `findNextDayOfWeek` helper gain `cancelledDates: Set<string> = new Set()`. `generateOccurrences` is unchanged. Five `getNextOccurrence` call-sites each gain a batch cancellation fetch.

---

## DECISION-001: Cancel-occurrence table name, occurrence_date column type, and cancel API shape

**Status:** Resolved (Impact bullet about `generateOccurrences` partially superseded by [DECISION-002](#decision-002-generateoccurrences-signature-unchanged-only-getnextoccurrence-gains-cancellation-exclusion))
**Date:** 2026-05-18

**Decision:**
Three rulings for the "Cancel a Single Event Occurrence" feature (work-log: `docs/work-log/2026-05-18-cancel-event-occurrence.md`):

1. **Table name:** `event_occurrence_overrides`. This is the right name: it is additive (does not touch `events` or `eventRsvps`), is self-describing, and leaves room for future override types (e.g., time-change overrides) without a rename. Columns: `id uuid PK`, `event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE`, `occurrence_date date NOT NULL`, `cancelled_at timestamp WITH TIME ZONE NOT NULL`, `cancelled_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL`, `cancellation_reason text`. Composite unique on `(event_id, occurrence_date)`.

2. **`occurrence_date` is a `date` column (no time component).** The existing `eventRsvps.occurrenceDate` is a `timestamp` (naive, no timezone — the known project bug). We do NOT use that column type for the new table. Occurrence cancellation is keyed on the calendar date of the occurrence (`YYYY-MM-DD`), not its wall-clock time. A `date` column avoids timezone ambiguity entirely: the API route segment carries `YYYY-MM-DD`, the DB stores `YYYY-MM-DD`, and the UI badge lookup is a string equality check. This is safe because every occurrence of a given event on a given calendar date is the same occurrence — there is no scenario where two occurrences of the same event share the same calendar date.

3. **Single toggle endpoint:** `POST /api/admin/events/[id]/occurrences/[date]/cancel` with body `{ cancelled: boolean, reason?: string }`. Rationale: a single endpoint is easier to guard (one auth check, one hasFeature check, one rate-limit surface), easier to test (one contract), and the body makes the intent explicit. Two separate endpoints (cancel + restore) would duplicate boilerplate and create an ambiguous "which one do I call?" question for the client. The `[date]` segment carries a `YYYY-MM-DD` string. When `cancelled: true`, the handler upserts a row into `event_occurrence_overrides`; when `cancelled: false`, it deletes it. The handler returns the updated occurrence state.

**Rationale:** All three choices minimize ambiguity at the data-model and API boundaries. The `date` column type is the most load-bearing decision: using `timestamp` here (matching the existing `eventRsvps.occurrenceDate`) would re-introduce the naive-timestamp bug and create a join surface where two `timestamp` values with different TZ assumptions must be compared for equality — a known failure mode in this codebase. The `date` column sidesteps that entirely.

**Impact:**
- New file: `drizzle/migrations/0036_event_occurrence_overrides.sql` (idempotent: `CREATE TABLE IF NOT EXISTS`, unique constraint guarded with `IF NOT EXISTS`).
- New table in `src/lib/db/schema.ts`: `eventOccurrenceOverrides`.
- New route: `src/app/api/admin/events/[id]/occurrences/[date]/cancel/route.ts`.
- ~~`src/lib/events.ts` — `generateOccurrences()` gains an optional `cancelledDates: Set<string>` parameter.~~ **Superseded by DECISION-002:** the parameter was placed on `getNextOccurrence` (and its `findNextDayOfWeek` helper) instead. `generateOccurrences` is unchanged.
- `src/types/events.ts` — `OccurrenceRow` gains `isCancelled: boolean` and `cancellationReason: string | null`.
- No new npm dependency. No new `FEATURES` key. No new role binding.

---

<!-- Decisions are appended above this line, newest first. -->
