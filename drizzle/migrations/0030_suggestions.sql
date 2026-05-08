-- Suggestion box submissions table
CREATE TABLE IF NOT EXISTS suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  category TEXT NOT NULL,
  message TEXT NOT NULL,
  is_anonymous BOOLEAN NOT NULL DEFAULT false,
  is_read BOOLEAN NOT NULL DEFAULT false,
  handled_by TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Add suggestions.view feature and grant to admin + board_member
DO $$ BEGIN
  INSERT INTO features (name, category, description)
  SELECT 'suggestions.view', 'suggestions', 'View member suggestion box submissions'
  WHERE NOT EXISTS (SELECT 1 FROM features WHERE name = 'suggestions.view');

  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id FROM roles r CROSS JOIN features f
  WHERE r.name = 'admin' AND f.name = 'suggestions.view'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );

  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id FROM roles r CROSS JOIN features f
  WHERE r.name = 'board_member' AND f.name = 'suggestions.view'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );
END $$;
