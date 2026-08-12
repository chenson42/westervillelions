-- Annual Membership Dues Tracking — DDL, role seed, and seed data
-- All statements are idempotent and safe to run multiple times.

-- 1. Add dues_category column to members
ALTER TABLE members ADD COLUMN IF NOT EXISTS dues_category TEXT NOT NULL DEFAULT 'individual';

-- 2. Create dues_payments table
CREATE TABLE IF NOT EXISTS dues_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  fiscal_year INTEGER NOT NULL,
  payment_date DATE NOT NULL,
  amount_cents INTEGER NOT NULL,
  method TEXT NOT NULL,
  notes TEXT,
  recorded_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 3. Create dues_settings table
CREATE TABLE IF NOT EXISTS dues_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fiscal_year INTEGER NOT NULL UNIQUE,
  individual_amount_cents INTEGER NOT NULL,
  family_amount_cents INTEGER NOT NULL,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 4. Composite index on dues_payments (member_id, fiscal_year) — hot read path
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'ix_dues_payments_member_fiscal_year'
  ) THEN
    CREATE INDEX ix_dues_payments_member_fiscal_year ON dues_payments (member_id, fiscal_year);
  END IF;
END $$;

-- 5. Seed the treasurer role
--    Existing sort_order sequence: admin=1, board_member=2, member=3, volunteer=4.
--    Insert treasurer at sort_order 3; bump member → 4 and volunteer → 5.
INSERT INTO roles (name, description, sort_order)
SELECT 'treasurer', 'Club treasurer — manages and records dues payments', 3
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'treasurer');

-- Bump member sort_order 3 → 4 (idempotent: WHERE clause matches only the old value)
UPDATE roles SET sort_order = 4 WHERE name = 'member'    AND sort_order = 3;

-- Bump volunteer sort_order 4 → 5 (idempotent: WHERE clause matches only the old value)
UPDATE roles SET sort_order = 5 WHERE name = 'volunteer' AND sort_order = 4;

-- 6. Seed FY2026 dues amounts
INSERT INTO dues_settings (fiscal_year, individual_amount_cents, family_amount_cents)
SELECT 2026, 12000, 9600
WHERE NOT EXISTS (SELECT 1 FROM dues_settings WHERE fiscal_year = 2026);

-- 7. Bootstrap seed identity — grants 'admin' and 'treasurer' to whatever
--    email SEED_ADMIN_EMAIL resolves to (see drizzle/run-migrations.mjs for
--    the substitution mechanism). Left unset, '{{SEED_ADMIN_EMAIL}}'
--    substitutes to '' and the SELECT matches no user, so this is a no-op.
--
--    Fresh install: sign in once (so a users row exists), set
--    SEED_ADMIN_EMAIL=you@example.com in .env.local, then re-run
--    `pnpm db:migrate` to grant yourself admin + treasurer. Production
--    already carries its own historical grants applied before this
--    migration was parameterized; those are untouched by this change.

INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u, roles r
WHERE u.email = '{{SEED_ADMIN_EMAIL}}'
  AND u.email <> ''
  AND r.name = 'admin'
  AND NOT EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = u.id AND ur.role_id = r.id
  );

INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u, roles r
WHERE u.email = '{{SEED_ADMIN_EMAIL}}'
  AND u.email <> ''
  AND r.name = 'treasurer'
  AND NOT EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = u.id AND ur.role_id = r.id
  );
