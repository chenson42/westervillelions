CREATE TABLE IF NOT EXISTS plastic_dropoff_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  phone TEXT,
  entry_instructions TEXT,
  hours TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Seed the initial two drop-off sites. Idempotent: each row is only inserted
-- when no row with the same name already exists, so admins can rename/delete
-- without the migration silently restoring them.
INSERT INTO plastic_dropoff_locations
  (name, address, phone, entry_instructions, hours, is_active, sort_order)
SELECT
  'Pure Roots Boutique',
  'Westerville, OH',
  NULL,
  'Enter through the back door. See purerootsboutique.com for store info.',
  NULL,
  true,
  0
WHERE NOT EXISTS (
  SELECT 1 FROM plastic_dropoff_locations WHERE name = 'Pure Roots Boutique'
);

INSERT INTO plastic_dropoff_locations
  (name, address, phone, entry_instructions, hours, is_active, sort_order)
SELECT
  'Westerville Farmers Market',
  'COhatch parking lot, 240 S. State St, Westerville, OH 43081',
  NULL,
  'Come find us at the Westerville Lions tent.',
  'Saturdays during the summer',
  true,
  1
WHERE NOT EXISTS (
  SELECT 1 FROM plastic_dropoff_locations WHERE name = 'Westerville Farmers Market'
);
