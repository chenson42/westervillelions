import { test, expect, type Page } from "@playwright/test";
import bcrypt from "bcryptjs";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/lib/db";
import { users, roles, userRoles } from "../src/lib/db/schema";
import { signInAsAdmin } from "./helpers/auth";

/**
 * Santa's Workshop admin gate (Phase 3, e2e spec 1, Slice 1 half): a signed-in
 * member without santas_workshop.manage is bounced from every page under
 * /admin/santas-workshop; an admin and a board member (who hold the key by
 * migration 0114) can open it; the sidebar entry shows only with the key.
 *
 * Fixtures are disposable users (example.invalid) holding existing roles only;
 * no role or feature definition is created or changed, and both users are
 * deleted afterwards.
 */

const STAMP = Date.now();
const PASSWORD = "E2eSantaGate!2026";
const MEMBER_EMAIL = `qa-sw-member-${STAMP}@example.invalid`;
const BOARD_EMAIL = `qa-sw-board-${STAMP}@example.invalid`;
const createdUserIds: string[] = [];

test.describe.configure({ mode: "serial" });

async function makeUser(email: string, roleName: string): Promise<void> {
  const role = await db.query.roles.findFirst({ where: eq(roles.name, roleName) });
  if (!role) throw new Error(`Fixture needs the '${roleName}' role: run pnpm db:migrate first.`);
  const [u] = await db
    .insert(users)
    .values({ email, name: `QA ${roleName} fixture`, password: await bcrypt.hash(PASSWORD, 10), role: "member", isActive: true })
    .returning({ id: users.id });
  createdUserIds.push(u.id);
  await db.insert(userRoles).values({ userId: u.id, roleId: role.id });
}

async function signInAs(page: Page, email: string): Promise<void> {
  await page.goto("/signin");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/signin"), { timeout: 15000 });
}

test.beforeAll(async () => {
  await makeUser(MEMBER_EMAIL, "member");
  await makeUser(BOARD_EMAIL, "board_member");
});

test.afterAll(async () => {
  if (createdUserIds.length > 0) {
    await db.delete(userRoles).where(inArray(userRoles.userId, createdUserIds));
    await db.delete(users).where(inArray(users.id, createdUserIds));
  }
});

const PAGES = ["/admin/santas-workshop", "/admin/santas-workshop/new", "/admin/santas-workshop/00000000-0000-4000-8000-000000000000", "/admin/santas-workshop/00000000-0000-4000-8000-000000000000/edit"];

test("a member without the key is bounced from every page and the API", async ({ page }) => {
  await signInAs(page, MEMBER_EMAIL);
  for (const path of PAGES) {
    await page.goto(path);
    await expect(page, path).not.toHaveURL(new RegExp(`${path}$`));
    await expect(page.getByRole("heading", { name: /Santa.s Workshop/, level: 1 }), path).toHaveCount(0);
  }
  const res = await page.request.get("/api/admin/santas-workshop/sessions");
  expect([401, 403]).toContain(res.status());
});

test("an admin sees the nav entry and the sessions page", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/admin");
  await expect(page.getByRole("link", { name: /Santa's Workshop/ }).first()).toBeVisible();
  await page.goto("/admin/santas-workshop");
  await expect(page.getByRole("heading", { name: /Santa.s Workshop/, level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "New session" })).toBeVisible();
});

test("a board member (holds the key by default) can open the sessions page", async ({ page }) => {
  await signInAs(page, BOARD_EMAIL);
  await page.goto("/admin/santas-workshop");
  await expect(page.getByRole("heading", { name: /Santa.s Workshop/, level: 1 })).toBeVisible();
});
