-- The Ledger — Increment 2: Controls
-- Adds board_minute + rejection_reason columns to ledger_transactions;
-- creates the ledger_reimbursements table.
--
-- All statements are idempotent and safe to run multiple times.
-- DECISION-020: receipt_storage_key stores an opaque key, not a provider URL.

-- ─── 1. Add new columns to ledger_transactions ───────────────────────────────

ALTER TABLE ledger_transactions ADD COLUMN IF NOT EXISTS board_minute text;
ALTER TABLE ledger_transactions ADD COLUMN IF NOT EXISTS rejection_reason text;

-- ─── 2. Create ledger_reimbursements ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ledger_reimbursements (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  submitted_by_member_id  uuid        NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  submitted_by_user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  amount_cents            integer     NOT NULL,
  description             text        NOT NULL,
  beneficiary_cause       text,
  -- Opaque storage key (DECISION-020); pattern: receipts/<uuid>/<filename>
  receipt_storage_key     text        NOT NULL,
  -- Nullable; treasurer assigns at pay time (decision R-3)
  fund_id                 uuid        REFERENCES ledger_funds(id) ON DELETE SET NULL,
  -- App-layer values: 'submitted' | 'approved' | 'rejected' | 'paid'
  -- No CHECK constraint — consistent with ledger_transactions.status (inc1 precedent)
  status                  text        NOT NULL DEFAULT 'submitted',
  reviewed_by_user_id     uuid        REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at             timestamptz,
  board_minute            text,
  rejection_reason        text,
  paid_at                 timestamptz,
  -- FK to the expense transaction created when treasurer marks paid; null until paid
  ledger_transaction_id   uuid        REFERENCES ledger_transactions(id) ON DELETE SET NULL,
  submitted_at            timestamptz NOT NULL DEFAULT now(),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- ─── 3. Indexes on ledger_reimbursements ─────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ix_ledger_reimb_member') THEN
    CREATE INDEX ix_ledger_reimb_member ON ledger_reimbursements(submitted_by_member_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ix_ledger_reimb_status') THEN
    CREATE INDEX ix_ledger_reimb_status ON ledger_reimbursements(status);
  END IF;
END $$;
