-- Receipt Storage in the Database (DECISION-040): bytes for ledger transaction
-- receipts, reimbursement receipts, and acknowledgment letters move from
-- Vercel Blob into Postgres. See docs/work-log/2026-07-21-receipt-storage-in-database.md
-- for the full design.
--
-- No data migration — there are no existing production receipts to move
-- (production uploads were failing before this change; user-confirmed).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS. Brand-new table, safe to re-run.

CREATE TABLE IF NOT EXISTS ledger_receipt_files (
  key          text        PRIMARY KEY,
  content_type text        NOT NULL,
  bytes        bytea       NOT NULL,
  byte_size    integer     NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
