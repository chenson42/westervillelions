-- Create homepage_announcements table
CREATE TABLE IF NOT EXISTS homepage_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text,
  link_url text,
  link_label text,
  is_active boolean NOT NULL DEFAULT true,
  starts_at timestamptz,
  ends_at timestamptz,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Add announcements.manage feature
INSERT INTO features (name, category, description)
SELECT 'announcements.manage', 'content', 'Create, edit, and delete homepage announcements'
WHERE NOT EXISTS (
  SELECT 1 FROM features WHERE name = 'announcements.manage'
);

-- Grant announcements.manage to the Admin role
INSERT INTO role_features (role_id, feature_id)
SELECT r.id, f.id
FROM roles r, features f
WHERE r.name = 'Admin'
  AND f.name = 'announcements.manage'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf
    WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );
