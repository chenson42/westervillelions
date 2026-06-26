-- The Ledger — Increment 6a: Donors & Acknowledgments + Dues Auto-Post columns
-- Creates ledger_donors and ledger_acknowledgments tables;
-- adds dues_payment_id, sync_stale, and donor_id columns to ledger_transactions.
--
-- All statements are idempotent and safe to run multiple times.
-- DECISIONS: 025 (dues↔ledger coupling, sync_stale marker, donor_id on transactions),
--            026 (ack type precedence, amountCents immutability, unique index on donation_txn_id)
--
-- Creation order matters:
--   1. ledger_donors            — no FK to new tables
--   2. ALTER ledger_transactions — FK to ledger_donors (now exists)
--   3. ledger_acknowledgments   — FKs to both ledger_transactions and ledger_donors

-- ─── 1. Create ledger_donors ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ledger_donors (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  -- max 200 chars enforced at app layer
  email       text,
  -- nullable; standard email format
  address     text,
  -- nullable; max 500 chars at app layer
  member_id   uuid        REFERENCES members(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ─── 2. Add new columns to ledger_transactions ────────────────────────────────

-- dues_payment_id: idempotency key for auto-posted dues rows (DECISION-025)
-- ON DELETE SET NULL: a deleted dues payment must not cascade-delete a reconciled ledger row
ALTER TABLE ledger_transactions
  ADD COLUMN IF NOT EXISTS dues_payment_id uuid
    REFERENCES dues_payments(id) ON DELETE SET NULL;

-- Unique constraint on dues_payment_id: one ledger row per dues payment maximum (DECISION-025)
-- Using CREATE UNIQUE INDEX IF NOT EXISTS to guarantee idempotency on re-run
CREATE UNIQUE INDEX IF NOT EXISTS ux_ledger_txns_dues_payment
  ON ledger_transactions(dues_payment_id)
  WHERE dues_payment_id IS NOT NULL;

-- sync_stale: out-of-sync marker for reconciled rows whose source dues payment was changed (DECISION-025)
ALTER TABLE ledger_transactions
  ADD COLUMN IF NOT EXISTS sync_stale boolean NOT NULL DEFAULT false;

-- donor_id: links a Foundation income transaction to a donor record (DECISION-025)
ALTER TABLE ledger_transactions
  ADD COLUMN IF NOT EXISTS donor_id uuid
    REFERENCES ledger_donors(id) ON DELETE SET NULL;

-- ─── 3. Create ledger_acknowledgments ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ledger_acknowledgments (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Foundation income transaction being acknowledged; cascade-delete with the transaction
  donation_txn_id         uuid        NOT NULL REFERENCES ledger_transactions(id) ON DELETE CASCADE,
  -- Donor who made the gift; nullable if the donor record is later deleted
  donor_id                uuid        REFERENCES ledger_donors(id) ON DELETE SET NULL,
  -- Immutable copy of the transaction's amount_cents at ack creation time (DECISION-026)
  amount_cents            integer     NOT NULL,
  -- Immutable copy of the transaction's txn_date at ack creation time
  txn_date                date        NOT NULL,
  -- 'written_ack_250' | 'quid_pro_quo_75' — auto-derived by deriveAckType(), manual override allowed
  type                    text        NOT NULL,
  -- FMV of goods/services given to donor; required when type='quid_pro_quo_75'
  quid_pro_quo_value_cents integer,
  -- null = pending; set to now() when treasurer marks sent
  sent_at                 timestamptz,
  -- Opaque Blob storage key; pattern: acknowledgments/<uuid>/<filename>
  letter_storage_key      text,
  -- Free-text alternative to an uploaded letter file
  letter_text             text,
  recorded_by_user_id     uuid        REFERENCES users(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- ─── 4. Indexes on ledger_acknowledgments ─────────────────────────────────────

-- Unique: one acknowledgment per donation transaction (DECISION-026 defense-in-depth)
CREATE UNIQUE INDEX IF NOT EXISTS ux_ledger_acks_txn
  ON ledger_acknowledgments(donation_txn_id);

-- Donor giving history query
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ix_ledger_acks_donor') THEN
    CREATE INDEX ix_ledger_acks_donor ON ledger_acknowledgments(donor_id);
  END IF;
END $$;

-- Pending queue filter (WHERE sent_at IS NULL)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ix_ledger_acks_sent_at') THEN
    CREATE INDEX ix_ledger_acks_sent_at ON ledger_acknowledgments(sent_at);
  END IF;
END $$;
