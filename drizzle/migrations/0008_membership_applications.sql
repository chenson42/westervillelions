-- Membership applications table
CREATE TABLE IF NOT EXISTS membership_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name TEXT NOT NULL,
  middle_initial TEXT,
  last_name TEXT NOT NULL,
  suffix TEXT,
  gender TEXT,
  occupation TEXT,
  date_of_birth TEXT,
  spouse_name TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  country TEXT DEFAULT 'USA',
  phone TEXT,
  email TEXT NOT NULL,
  member_type TEXT NOT NULL DEFAULT 'new',
  sponsor_name TEXT,
  previous_member_number TEXT,
  previous_club_name TEXT,
  previous_club_number TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  admin_notes TEXT,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Seed membership.manage feature and grant to admin role
INSERT INTO features (name, category, description)
SELECT 'membership.manage', 'membership', 'View and manage membership applications'
WHERE NOT EXISTS (SELECT 1 FROM features WHERE name = 'membership.manage');

INSERT INTO role_features (role_id, feature_id)
SELECT r.id, f.id
FROM roles r, features f
WHERE r.name = 'admin' AND f.name = 'membership.manage'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );
