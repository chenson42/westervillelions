-- Add phone column for drop-off locations
ALTER TABLE glasses_dropoff_locations ADD COLUMN IF NOT EXISTS phone TEXT;

-- One-time refresh of the drop-off location list.
-- Guard: only runs while no row has a phone set (i.e. before this seed has applied).
-- After the first run every active site has a phone, so this block becomes a no-op
-- on subsequent deploys, preserving any admin edits made via the UI.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM glasses_dropoff_locations WHERE phone IS NOT NULL) THEN
    -- Remove locations no longer participating in the drop-off program
    DELETE FROM glasses_dropoff_locations
    WHERE name IN ('The Lasik Vision Institute', 'Walmart Vision and Glasses');

    -- Upsert the current authoritative list (updates existing rows, inserts new ones)
    INSERT INTO glasses_dropoff_locations (name, address, phone, sort_order) VALUES
      ('Central College Christian School', '975 S. Sunbury Road, Westerville, OH 43081', '614-497-8146', 0),
      ('Church of the Messiah', '51 N. State Street, Westerville, OH 43081', '614-882-2167', 1),
      ('Clarkson Eyecare', '636 W. Shrock Road, Westerville, OH 43081', '614-890-3577', 2),
      ('Columbus Vision Associates', '487 Lazelle Road, Westerville, OH 43081', '614-431-2099', 3),
      ('Columbus Laser and Cataract Center', '6357 N. Hamilton Road, New Albany, OH 43081', '614-939-1600', 4),
      ('Linden Branch, Columbus Library', '2223 Cleveland Ave., Columbus, OH 43211', '614-645-2275', 5),
      ('Med West Eyecare', '555 W. Shrock Road, Westerville, OH 43081', '614-891-0350', 6),
      ('Meijer Optical', '100 Polaris Pkwy, Westerville, OH 43082', '614-891-4235', 7),
      ('Nationwide Children''s Close to Home Optical', '433 N. Cleveland Ave., Suite 2E, Westerville, OH 43082', '614-355-8300', 8),
      ('Northeast Vision Center', '113 B. Commerce Park Dr., Westerville, OH 43082', '614-882-9131', 9),
      ('Professional Eye Care', '584 N. State Street, Westerville, OH 43082', '614-895-9955', 10),
      ('Uptown Eyecare', '114 N. State Street, Westerville, OH 43081 (box on front porch)', '614-882-0851', 11),
      ('Vision Professionals', '690 W. Cherry St., Sunbury, OH 43074', '740-965-4671', 12),
      ('Westerville Community United Church of Christ', '770 County Line Road, Westerville, OH 43082', '614-882-7056', 13),
      ('Westerville Eyecare', '925 N. State St., Westerville, OH 43082', '614-523-3949', 14),
      ('Westerville Senior Center', '350 N. Cleveland Ave, Westerville, OH 43082', '614-901-6560', 15)
    ON CONFLICT (name) DO UPDATE
    SET address = EXCLUDED.address,
        phone = EXCLUDED.phone,
        sort_order = EXCLUDED.sort_order,
        is_active = true,
        updated_at = now();
  END IF;
END $$;
