-- Ledger Category Management: audit trail for category writes
-- (docs/work-log/2026-08-07-ledger-category-management.md, DECISION-065/066).
-- Table is named ledger_audit_log (not ledger_category_audit_log) and
-- target_category_id is one of several typed target-FK columns this table is
-- expected to grow (target_transaction_id, target_budget_id — additive,
-- future, out of scope here) — mirrors permission_audit_log's shape.
--
-- before/after hold JSON-stringified diffs of ONLY the changed fields, not
-- full-row snapshots (see the matching comment on ledgerAuditLog in
-- schema.ts). No DB CHECK on `action` — this codebase doesn't use
-- enum/CHECK constraints for these classifier columns anywhere (fund_kind,
-- flow on ledger_categories are the same free-text convention).

CREATE TABLE IF NOT EXISTS ledger_audit_log (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  action              TEXT NOT NULL,
  target_category_id  UUID REFERENCES ledger_categories(id) ON DELETE SET NULL,
  before              TEXT,
  after               TEXT,
  details             TEXT,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'ix_ledger_audit_log_category'
  ) THEN
    CREATE INDEX ix_ledger_audit_log_category ON ledger_audit_log (target_category_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'ix_ledger_audit_log_created'
  ) THEN
    CREATE INDEX ix_ledger_audit_log_created ON ledger_audit_log (created_at);
  END IF;
END $$;
