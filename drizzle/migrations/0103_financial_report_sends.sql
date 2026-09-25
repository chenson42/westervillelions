-- Financial Report "Send to Board" — sent-log table (DECISION-100/101).
-- docs/work-log/2026-09-25-financial-report-auto-send.md
--
-- One row per attempted send, success or failure. The unique index that
-- guards against a double-click / concurrent double-send is PARTIAL
-- (WHERE success = true): a failed attempt's row never collides with
-- anything, so a retry after failure is always insertable with no cleanup
-- step, while two concurrent SUCCESSFUL sends for the same
-- (entity, month_end, totals_fingerprint) collide and the loser gets
-- already_sent. A changed fingerprint (a genuine corrected resend) is a new
-- row and is therefore allowed even against a prior successful send for the
-- same entity/month.
--
-- No seed data and no personal data — every column is a UUID FK, a date, a
-- boolean, or a system-generated hash/error string.
--
-- All statements are idempotent and safe to run multiple times.

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

-- Partial unique index — see header comment above for why it's partial.
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
