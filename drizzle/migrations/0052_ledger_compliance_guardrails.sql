-- Migration 0052: Lions Fund-Compliance Guardrails — holding-period warn threshold
-- inc7: add configurable aging threshold to ledger_settings (DECISION-027)
-- Idempotent: safe to re-run on every deploy.

ALTER TABLE ledger_settings
  ADD COLUMN IF NOT EXISTS holding_period_warn_days integer NOT NULL DEFAULT 365;
