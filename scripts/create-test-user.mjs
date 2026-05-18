/**
 * Creates or resets a dedicated e2e test admin user with known credentials.
 * Run with: pnpm exec dotenv -e .env.local -- node scripts/create-test-user.mjs
 * 
 * This is used to set up predictable credentials for Playwright e2e tests.
 * The test user (email comes from E2E_ADMIN_EMAIL in .env.local) is never used in production.
 * Re-run this script if the user has been deactivated — the ON CONFLICT re-activates.
 */
import postgres from 'postgres';
import { createHash } from 'crypto';

const sql = postgres(process.env.DATABASE_URL);

// Create a bcrypt-style hash for the test password
// NOTE: We use bcrypt via the app itself – here we just use a pre-computed hash
// Password is: TestLions2026!
// Pre-computed with bcrypt.hash("TestLions2026!", 10)
const TEST_EMAIL = process.env.E2E_ADMIN_EMAIL;
const TEST_PASSWORD_HASH = process.env.E2E_ADMIN_PASSWORD_HASH;

if (!TEST_EMAIL || !TEST_PASSWORD_HASH) {
  console.error('E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD_HASH must be set in .env.local');
  process.exit(1);
}

try {
  // Upsert test user
  const [user] = await sql`
    INSERT INTO users (email, name, password, is_active, role, created_at, updated_at)
    VALUES (${TEST_EMAIL}, 'E2E Test Admin', ${TEST_PASSWORD_HASH}, true, 'admin', NOW(), NOW())
    ON CONFLICT (email) DO UPDATE SET
      password = ${TEST_PASSWORD_HASH},
      is_active = true,
      updated_at = NOW()
    RETURNING id
  `;
  
  console.log('Test user upserted:', user.id);

  // Ensure admin role
  const [adminRole] = await sql`SELECT id FROM roles WHERE name = 'admin'`;
  if (adminRole) {
    await sql`
      INSERT INTO user_roles (user_id, role_id)
      VALUES (${user.id}, ${adminRole.id})
      ON CONFLICT DO NOTHING
    `;
    console.log('Admin role assigned');
  }

  // Ensure member role too
  const [memberRole] = await sql`SELECT id FROM roles WHERE name = 'member'`;
  if (memberRole) {
    await sql`
      INSERT INTO user_roles (user_id, role_id)
      VALUES (${user.id}, ${memberRole.id})
      ON CONFLICT DO NOTHING
    `;
  }

  console.log('Test user ready:', TEST_EMAIL);
} finally {
  await sql.end();
}
