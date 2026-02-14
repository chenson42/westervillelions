-- Roles, Permissions, Groups, and Campaigns Schema
-- All statements are idempotent and safe to run multiple times

DO $$ BEGIN
  -- Create roles table
  CREATE TABLE IF NOT EXISTS roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    sort_order INTEGER NOT NULL DEFAULT 999,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

  -- Create features table
  CREATE TABLE IF NOT EXISTS features (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

  -- Create user_roles junction table
  CREATE TABLE IF NOT EXISTS user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

  -- Create role_features junction table
  CREATE TABLE IF NOT EXISTS role_features (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    feature_id UUID NOT NULL REFERENCES features(id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

  -- Create permission_audit_log table
  CREATE TABLE IF NOT EXISTS permission_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    target_role_id UUID REFERENCES roles(id) ON DELETE SET NULL,
    target_feature_id UUID REFERENCES features(id) ON DELETE SET NULL,
    details TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

  -- Create password_reset_tokens table
  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

  -- Create campaigns table
  CREATE TABLE IF NOT EXISTS campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT,
    zeffy_link TEXT NOT NULL,
    image TEXT,
    display_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

  -- Create group_types table
  CREATE TABLE IF NOT EXISTS group_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

  -- Create groups table (self-referential for hierarchy)
  CREATE TABLE IF NOT EXISTS groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_type_id UUID NOT NULL REFERENCES group_types(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    parent_group_id UUID REFERENCES groups(id) ON DELETE SET NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

  -- Create group_roles table
  CREATE TABLE IF NOT EXISTS group_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

  -- Create group_memberships table
  CREATE TABLE IF NOT EXISTS group_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    group_role_id UUID NOT NULL REFERENCES group_roles(id) ON DELETE CASCADE,
    joined_at TIMESTAMP NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

  -- Add email column to members table if it doesn't exist
  BEGIN
    ALTER TABLE members ADD COLUMN IF NOT EXISTS email TEXT;
  EXCEPTION
    WHEN duplicate_column THEN NULL;
  END;

  -- Add board_position column to members table if it doesn't exist
  BEGIN
    ALTER TABLE members ADD COLUMN IF NOT EXISTS board_position TEXT;
  EXCEPTION
    WHEN duplicate_column THEN NULL;
  END;

  -- Add image column to events table if it doesn't exist
  BEGIN
    ALTER TABLE events ADD COLUMN IF NOT EXISTS image TEXT;
  EXCEPTION
    WHEN duplicate_column THEN NULL;
  END;

EXCEPTION
  WHEN duplicate_table THEN
    NULL;
END $$;

-- Seed data for roles (idempotent)
DO $$ BEGIN
  INSERT INTO roles (name, description, sort_order)
  SELECT 'admin', 'Administrator with full system access', 1
  WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'admin');

  INSERT INTO roles (name, description, sort_order)
  SELECT 'board_member', 'Board member with elevated permissions', 2
  WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'board_member');

  INSERT INTO roles (name, description, sort_order)
  SELECT 'member', 'Regular club member', 3
  WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'member');

  INSERT INTO roles (name, description, sort_order)
  SELECT 'volunteer', 'Community volunteer (not a club member)', 4
  WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'volunteer');
END $$;

-- Seed data for features (idempotent)
DO $$ BEGIN
  -- Members features
  INSERT INTO features (name, category, description)
  SELECT 'members.view', 'members', 'View member directory'
  WHERE NOT EXISTS (SELECT 1 FROM features WHERE name = 'members.view');

  INSERT INTO features (name, category, description)
  SELECT 'members.edit', 'members', 'Edit member information'
  WHERE NOT EXISTS (SELECT 1 FROM features WHERE name = 'members.edit');

  INSERT INTO features (name, category, description)
  SELECT 'members.delete', 'members', 'Delete members'
  WHERE NOT EXISTS (SELECT 1 FROM features WHERE name = 'members.delete');

  -- Events features
  INSERT INTO features (name, category, description)
  SELECT 'events.view', 'events', 'View events calendar'
  WHERE NOT EXISTS (SELECT 1 FROM features WHERE name = 'events.view');

  INSERT INTO features (name, category, description)
  SELECT 'events.create', 'events', 'Create new events'
  WHERE NOT EXISTS (SELECT 1 FROM features WHERE name = 'events.create');

  INSERT INTO features (name, category, description)
  SELECT 'events.edit', 'events', 'Edit existing events'
  WHERE NOT EXISTS (SELECT 1 FROM features WHERE name = 'events.edit');

  INSERT INTO features (name, category, description)
  SELECT 'events.delete', 'events', 'Delete events'
  WHERE NOT EXISTS (SELECT 1 FROM features WHERE name = 'events.delete');

  -- Campaigns features
  INSERT INTO features (name, category, description)
  SELECT 'campaigns.manage', 'campaigns', 'Manage donation campaigns'
  WHERE NOT EXISTS (SELECT 1 FROM features WHERE name = 'campaigns.manage');

  -- Groups features
  INSERT INTO features (name, category, description)
  SELECT 'groups.manage', 'groups', 'Manage groups and memberships'
  WHERE NOT EXISTS (SELECT 1 FROM features WHERE name = 'groups.manage');

  -- Admin features
  INSERT INTO features (name, category, description)
  SELECT 'admin.users', 'admin', 'Manage user accounts'
  WHERE NOT EXISTS (SELECT 1 FROM features WHERE name = 'admin.users');

  INSERT INTO features (name, category, description)
  SELECT 'admin.roles', 'admin', 'Manage roles and permissions'
  WHERE NOT EXISTS (SELECT 1 FROM features WHERE name = 'admin.roles');

  INSERT INTO features (name, category, description)
  SELECT 'admin.dashboard', 'admin', 'Access admin dashboard'
  WHERE NOT EXISTS (SELECT 1 FROM features WHERE name = 'admin.dashboard');

  -- Reports features
  INSERT INTO features (name, category, description)
  SELECT 'reports.view', 'reports', 'View reports and analytics'
  WHERE NOT EXISTS (SELECT 1 FROM features WHERE name = 'reports.view');

  INSERT INTO features (name, category, description)
  SELECT 'reports.export', 'reports', 'Export reports'
  WHERE NOT EXISTS (SELECT 1 FROM features WHERE name = 'reports.export');
END $$;

-- Seed data for role-feature mappings (idempotent)
-- Admin gets all features (handled in code, but add some here for completeness)
DO $$ BEGIN
  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id
  FROM roles r
  CROSS JOIN features f
  WHERE r.name = 'admin'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf
    WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );

  -- Board member gets most features except admin.roles
  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id
  FROM roles r
  CROSS JOIN features f
  WHERE r.name = 'board_member'
  AND f.name IN (
    'members.view', 'members.edit',
    'events.view', 'events.create', 'events.edit',
    'campaigns.manage',
    'groups.manage',
    'admin.dashboard',
    'reports.view', 'reports.export'
  )
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf
    WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );

  -- Regular member gets view-only features
  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id
  FROM roles r
  CROSS JOIN features f
  WHERE r.name = 'member'
  AND f.name IN ('members.view', 'events.view')
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf
    WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );

  -- Volunteer gets minimal access
  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id
  FROM roles r
  CROSS JOIN features f
  WHERE r.name = 'volunteer'
  AND f.name IN ('events.view')
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf
    WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );
END $$;

-- Seed data for group types (idempotent)
DO $$ BEGIN
  INSERT INTO group_types (name, description)
  SELECT 'Committee', 'Standing committees (Finance, Service, Membership, etc.)'
  WHERE NOT EXISTS (SELECT 1 FROM group_types WHERE name = 'Committee');

  INSERT INTO group_types (name, description)
  SELECT 'Service Team', 'Project-based service teams'
  WHERE NOT EXISTS (SELECT 1 FROM group_types WHERE name = 'Service Team');

  INSERT INTO group_types (name, description)
  SELECT 'Branch', 'Club branches (Main, Somali, etc.)'
  WHERE NOT EXISTS (SELECT 1 FROM group_types WHERE name = 'Branch');
END $$;

-- Seed data for group roles (idempotent)
DO $$ BEGIN
  INSERT INTO group_roles (name, description)
  SELECT 'Leader', 'Group leader or chair'
  WHERE NOT EXISTS (SELECT 1 FROM group_roles WHERE name = 'Leader');

  INSERT INTO group_roles (name, description)
  SELECT 'Co-Leader', 'Group co-chair or vice chair'
  WHERE NOT EXISTS (SELECT 1 FROM group_roles WHERE name = 'Co-Leader');

  INSERT INTO group_roles (name, description)
  SELECT 'Member', 'Regular group member'
  WHERE NOT EXISTS (SELECT 1 FROM group_roles WHERE name = 'Member');
END $$;
