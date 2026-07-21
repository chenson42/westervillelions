-- Bank Reconciliation inc2: reconciliation sessions, staged bank lines, and
-- match links (DECISION-036). See docs/work-log/2026-07-21-ledger-reconciliation-sessions.md
-- for the full design.
--
-- Three new tables:
--   ledger_reconciliation_sessions — one per bank account + statement period
--   ledger_bank_lines              — parsed Chase CSV rows staged per session
--   ledger_reconciliation_matches  — links a bank line to exactly one ledger
--                                    transaction (transaction_id UNIQUE forever;
--                                    bank_line_id deliberately NOT unique so
--                                    inc3's Zeffy batch matching needs no
--                                    schema change)
-- Plus one new provenance column on ledger_transactions:
--   reconciled_session_id — pointer to which session's close (if any) set
--   reconciled/reconciled_at on that row. Not a parallel status (architect
--   Ruling 3) — session close still writes the existing reconciled/
--   reconciled_at columns.
--
-- All timestamp columns are timestamptz, matching this file's TS schema
-- (timestamp(..., { withTimezone: true })) and the current codebase
-- convention for newly-added tables (ledger_filings, failed_login_attempts).
--
-- Idempotent: guarded CREATE TABLE IF NOT EXISTS, DO $$ constraint/index
-- guards, guarded ADD COLUMN IF NOT EXISTS. Safe to re-run on every deploy.

CREATE TABLE IF NOT EXISTS ledger_reconciliation_sessions (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account_id          uuid        NOT NULL REFERENCES ledger_bank_accounts(id) ON DELETE CASCADE,
  statement_period_start   date        NOT NULL,
  statement_period_end     date        NOT NULL,
  opening_balance_cents    integer     NOT NULL,
  closing_balance_cents    integer     NOT NULL,
  status                   text        NOT NULL DEFAULT 'open',
  uploaded_at              timestamptz,
  csv_filename             text,
  csv_row_count            integer,
  closed_at                timestamptz,
  closed_by_user_id        uuid        REFERENCES users(id) ON DELETE SET NULL,
  reopened_at              timestamptz,
  reopened_by_user_id      uuid        REFERENCES users(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ledger_recon_sessions_account_period_key') THEN
    ALTER TABLE ledger_reconciliation_sessions
      ADD CONSTRAINT ledger_recon_sessions_account_period_key
      UNIQUE (bank_account_id, statement_period_start, statement_period_end);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_ledger_recon_sessions_account
  ON ledger_reconciliation_sessions (bank_account_id, statement_period_end);

CREATE TABLE IF NOT EXISTS ledger_bank_lines (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id           uuid        NOT NULL REFERENCES ledger_reconciliation_sessions(id) ON DELETE CASCADE,
  bank_account_id      uuid        NOT NULL REFERENCES ledger_bank_accounts(id) ON DELETE CASCADE,
  posting_date         date        NOT NULL,
  description          text        NOT NULL,
  amount_cents         integer     NOT NULL,
  raw_type             text,
  check_or_slip_number text,
  balance_cents        integer,
  in_statement_period  boolean     NOT NULL DEFAULT true,
  dedupe_key           text        NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ledger_bank_lines_session_dedupe_key') THEN
    ALTER TABLE ledger_bank_lines
      ADD CONSTRAINT ledger_bank_lines_session_dedupe_key UNIQUE (session_id, dedupe_key);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_ledger_bank_lines_session_period
  ON ledger_bank_lines (session_id, in_statement_period);
CREATE INDEX IF NOT EXISTS ix_ledger_bank_lines_check_slip
  ON ledger_bank_lines (bank_account_id, check_or_slip_number);

CREATE TABLE IF NOT EXISTS ledger_reconciliation_matches (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          uuid        NOT NULL REFERENCES ledger_reconciliation_sessions(id) ON DELETE CASCADE,
  bank_line_id        uuid        NOT NULL REFERENCES ledger_bank_lines(id) ON DELETE CASCADE,
  transaction_id      uuid        NOT NULL REFERENCES ledger_transactions(id) ON DELETE CASCADE,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by_user_id  uuid        REFERENCES users(id) ON DELETE SET NULL
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ledger_recon_matches_txn_key') THEN
    ALTER TABLE ledger_reconciliation_matches
      ADD CONSTRAINT ledger_recon_matches_txn_key UNIQUE (transaction_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_ledger_recon_matches_bank_line
  ON ledger_reconciliation_matches (bank_line_id);

ALTER TABLE ledger_transactions
  ADD COLUMN IF NOT EXISTS reconciled_session_id uuid
  REFERENCES ledger_reconciliation_sessions(id) ON DELETE SET NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ix_ledger_txns_reconciled_session') THEN
    CREATE INDEX ix_ledger_txns_reconciled_session ON ledger_transactions (reconciled_session_id);
  END IF;
END $$;
