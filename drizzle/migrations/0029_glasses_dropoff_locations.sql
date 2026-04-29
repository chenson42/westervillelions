CREATE TABLE IF NOT EXISTS glasses_dropoff_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

ALTER TABLE glasses_dropoff_locations ADD CONSTRAINT IF NOT EXISTS uq_glasses_dropoff_name UNIQUE (name);

INSERT INTO glasses_dropoff_locations (name, address, sort_order) VALUES
  ('Central College Christian School', '975 S. Sunbury Rd', 0),
  ('Church of the Messiah', '51 N. State St', 1),
  ('Med West Eyecare', '555 W. Shrock Rd', 2),
  ('Northeast Vision Center', '113 B. Commerce Park Dr', 3),
  ('The Lasik Vision Institute', '440 Polaris Parkway Suite 325', 4),
  ('Uptown Eyecare', '114 N. State St', 5),
  ('Walmart Vision and Glasses', '50 E. Shrock Rd', 6),
  ('Westerville Community United Church of Christ', '770 County Line Rd', 7),
  ('Westerville Eyecare', '925 N. State St', 8),
  ('Westerville Senior Center', '350 N. Cleveland Ave', 9)
ON CONFLICT (name) DO NOTHING;
