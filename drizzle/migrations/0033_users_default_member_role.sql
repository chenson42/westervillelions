-- Ensure every user has at least the 'member' role assigned in user_roles.
-- Idempotent: only inserts for users that currently have zero rows in user_roles.
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u
CROSS JOIN roles r
WHERE r.name = 'member'
  AND NOT EXISTS (
    SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id
  );
