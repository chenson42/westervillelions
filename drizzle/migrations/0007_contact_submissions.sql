-- Contact form submissions table
CREATE TABLE IF NOT EXISTS contact_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Add contact.view feature
DO $$ BEGIN
  INSERT INTO features (name, category, description)
  SELECT 'contact.view', 'contact', 'View contact form submissions'
  WHERE NOT EXISTS (SELECT 1 FROM features WHERE name = 'contact.view');

  -- Grant to admin role
  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id FROM roles r CROSS JOIN features f
  WHERE r.name = 'admin' AND f.name = 'contact.view'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );

  -- Grant to board_member role
  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id FROM roles r CROSS JOIN features f
  WHERE r.name = 'board_member' AND f.name = 'contact.view'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );
END $$;
