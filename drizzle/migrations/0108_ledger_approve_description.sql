-- ledger.approve no longer covers reimbursements (DECISION-106).
-- The description below is byte-for-byte identical to
-- FEATURE_DESCRIPTIONS[FEATURES.LEDGER_APPROVE] in src/lib/permissions.ts.
-- Idempotent: the IS DISTINCT FROM guard makes every re-run a no-op.
UPDATE features
SET description = 'Approve and reject pending disbursements, and approve or unlock budgets'
WHERE name = 'ledger.approve'
  AND description IS DISTINCT FROM 'Approve and reject pending disbursements, and approve or unlock budgets';
