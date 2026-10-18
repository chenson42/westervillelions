import { test, expect, type Page } from "@playwright/test";
import { signInAsAdmin } from "./helpers/auth";
import { getActivityFundName } from "./helpers/fund-names";

/**
 * B-172 Increment 1 (DECISION-126/127), the user-visible half:
 *
 *  1. A Club Public Funds income category can declare the Foundation category
 *     its gifts become when swept (the "counterpart"). The category screen
 *     shows the chip, the flags dialog shows the Foundation's flags read-only,
 *     and clearing the counterpart removes both.
 *  2. A gift on Public Funds income can carry a donor chosen (or created) in
 *     the picker on the create form. The create-donor form lives in a portal
 *     INSIDE the transaction <form>, and React events bubble through the React
 *     tree, so a create-donor submit once saved the gift early with no donor —
 *     regression for the donor-picker submit-bubbling bug found live on
 *     2026-10-17 (docs/work-log/2026-10-17-itemized-sweep-inc1-rename-and-mirrors.md).
 *  3. The Foundation-bound hint changes with the amount (a receipt is needed
 *     from $250).
 *
 * Fixtures: one disposable Club Public Funds income category (created through
 * the API with a unique name, deactivated and un-mirrored afterwards: categories
 * are never hard-deleted), one disposable donor (example.invalid) and one gift;
 * the gift is deleted through the audited DELETE route and the donor through its
 * own route. No seeded category, fund or donor is edited, and the fund name is
 * read from the database, never typed (DECISION-127).
 */
test.describe.configure({ mode: "serial" });

const CLUB_ENTITY_ID = "a6a61beb-2839-4b9e-9c44-ad9ffbeaf50b";
const FOUNDATION_ENTITY_ID = "8a27091d-ae9b-4c58-bff3-a633c418ee21";
// A real Foundation charitable income category the counterpart points at (read-only use).
const FOUNDATION_TARGET_NAME = "Public donations";

const RUN = Date.now();
const QA_CATEGORY = `QA E2E Mirror ${RUN}`;
const QA_PARTY = `QA E2E Mirror Party ${RUN}`;
const QA_DONOR = `Example Donor E2E ${RUN}`;

let page: Page;
let nativeDialogFired = false;
let activityFundName = "Public Funds";
let categoryId = "";
let foundationTargetId = "";
let giftId = "";
const earlyTransactionPosts: string[] = [];
// Every gift the suite's browser saved, so a failed run (a gift saved early, a test that
// threw before it recorded giftId) still cleans up after itself.
const savedGiftIds: string[] = [];

async function listCategories(entityId: string, includeInactive = false) {
  const res = await page.request.get(
    `/api/admin/ledger/categories?entityId=${entityId}&includeInactive=${includeInactive}`,
  );
  expect(res.ok(), `category list failed: ${res.status()}`).toBe(true);
  return (await res.json()).categories as Array<{
    id: string;
    name: string;
    fundKind: string;
    flow: string;
    mirrorsCategoryId: string | null;
  }>;
}

async function patchCategory(id: string, body: Record<string, unknown>) {
  return page.request.fetch(`/api/admin/ledger/categories/${id}`, { method: "PATCH", data: body });
}

function categoryRow(name: string) {
  return page.locator("tr", { hasText: name }).first();
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  page.on("dialog", (dialog) => {
    nativeDialogFired = true;
    void dialog.dismiss();
  });
  await signInAsAdmin(page);
  activityFundName = await getActivityFundName();

  const target = (await listCategories(FOUNDATION_ENTITY_ID)).find(
    (c) => c.name === FOUNDATION_TARGET_NAME && c.fundKind === "charitable" && c.flow === "income",
  );
  expect(target, `Foundation income category "${FOUNDATION_TARGET_NAME}" must exist`).toBeTruthy();
  foundationTargetId = target!.id;

  const created = await page.request.fetch("/api/admin/ledger/categories", {
    method: "POST",
    data: {
      entityId: CLUB_ENTITY_ID,
      fiscalYear: 2026,
      fundKind: "activity",
      flow: "income",
      name: QA_CATEGORY,
    },
  });
  expect(created.ok(), `fixture category create failed: ${created.status()} ${await created.text()}`).toBe(true);
  categoryId = (await created.json()).id;
});

test.afterAll(async () => {
  try {
    for (const id of new Set([giftId, ...savedGiftIds].filter(Boolean))) {
      await page.request.fetch(`/api/admin/ledger/transactions/${id}`, {
        method: "DELETE",
        data: { reason: "QA e2e cleanup: ledger-category-mirror.spec.ts fixture gift" },
      });
    }
    const donors = await page.request.get(`/api/admin/ledger/donors?search=${encodeURIComponent(QA_DONOR)}`);
    if (donors.ok()) {
      const body = await donors.json();
      const list = (Array.isArray(body) ? body : (body.donors ?? [])) as Array<{ id: string; name: string }>;
      for (const d of list.filter((x) => x.name === QA_DONOR)) {
        await page.request.fetch(`/api/admin/ledger/donors/${d.id}`, { method: "DELETE" });
      }
    }
    if (categoryId) {
      await patchCategory(categoryId, { mirrorsCategoryId: null });
      await patchCategory(categoryId, { isActive: false });
    }
  } finally {
    expect(nativeDialogFired, "a native browser dialog fired during the suite").toBe(false);
    await page.close();
  }
});

test.describe("category counterpart (mirror) on the category screen", () => {
  test("should set a Foundation counterpart from the Counterpart action and show it under the category", async () => {
    // Arrange
    await page.goto("/admin/ledger/settings/categories");
    await expect(categoryRow(QA_CATEGORY)).toBeVisible();

    // Act
    await categoryRow(QA_CATEGORY).getByRole("button", { name: /Counterpart/ }).click();
    const picker = page.locator("#mirror-target");
    await expect(picker).toBeVisible();
    await picker.selectOption({ value: foundationTargetId });
    const saved = page.waitForResponse(
      (res) => res.request().method() === "PATCH" && res.url().includes(`/api/admin/ledger/categories/${categoryId}`),
    );
    await page.getByRole("button", { name: /^Save/ }).click();
    expect((await saved).status()).toBe(200);

    // Assert — the chip names the Foundation category, and the server stored it
    await page.reload();
    await expect(categoryRow(QA_CATEGORY)).toContainText(`Counterpart: ${FOUNDATION_TARGET_NAME}`);
    const stored = (await listCategories(CLUB_ENTITY_ID)).find((c) => c.id === categoryId);
    expect(stored?.mirrorsCategoryId).toBe(foundationTargetId);
  });

  test("should show the flags read-only with the Foundation's values while a counterpart is set, and refuse a flag edit from the API", async () => {
    // Arrange
    await page.goto("/admin/ledger/settings/categories");

    // Act
    await categoryRow(QA_CATEGORY).getByRole("button", { name: /Edit flags/ }).click();
    const dialog = page.getByRole("dialog");

    // Assert — both flags are read from the Foundation category and cannot be changed here
    await expect(dialog).toContainText("Read from the Foundation category");
    const boxes = dialog.locator("input[type=checkbox]");
    await expect(boxes).toHaveCount(2);
    await expect(boxes.nth(0)).toBeDisabled();
    await expect(boxes.nth(1)).toBeDisabled();
    await page.keyboard.press("Escape");

    const refused = await patchCategory(categoryId, { countsAsGiving: false });
    expect(refused.status()).toBe(400);
    expect((await refused.json()).code).toBe("mirrored_flag_read_only");
  });

  test("should refuse a Club category, itself and an unknown id as a counterpart with a plain-language 4xx, never a 500", async () => {
    // Arrange
    const clubCategories = await listCategories(CLUB_ENTITY_ID);
    const otherClub = clubCategories.find((c) => c.id !== categoryId && c.fundKind === "activity" && c.flow === "income");
    expect(otherClub, "a second Club Public Funds income category must exist").toBeTruthy();

    // Act
    const self = await patchCategory(categoryId, { mirrorsCategoryId: categoryId });
    const club = await patchCategory(categoryId, { mirrorsCategoryId: otherClub!.id });
    const unknown = await patchCategory(categoryId, { mirrorsCategoryId: "11111111-1111-4111-8111-111111111111" });

    // Assert
    expect(self.status()).toBe(400);
    expect((await self.json()).code).toBe("target_is_self");
    expect(club.status()).toBe(400);
    expect((await club.json()).code).toBe("target_not_foundation_income");
    expect(unknown.status()).toBe(404);
    expect((await unknown.json()).code).toBe("mirror_target_not_found");
  });

  test("should show the Foundation-bound hint on the create form, with a receipt needed from $250", async () => {
    // Arrange
    await page.goto("/admin/ledger/activity");
    await page.getByRole("button", { name: "Record Transaction" }).click();
    const dialog = page.getByRole("dialog").first();
    await dialog.locator("#txn-fund").selectOption({ label: activityFundName });
    await dialog.locator("#txn-category").selectOption({ label: QA_CATEGORY });

    // Act / Assert — $300 needs a receipt
    await dialog.locator("#txn-amount").fill("300");
    await expect(dialog).toContainText("Foundation-bound");
    await expect(dialog).toContainText(`"${FOUNDATION_TARGET_NAME}"`);
    await expect(dialog).toContainText("a written receipt will be needed");

    // Act / Assert — $249.99 does not (the same $250 line the pending-acknowledgments list uses)
    await dialog.locator("#txn-amount").fill("249.99");
    await expect(dialog).toContainText("No written acknowledgment is required");
    await page.keyboard.press("Escape");
  });
});

test.describe("donor on a Public Funds gift", () => {
  test("should not save the gift when the create-donor form is submitted, then save it with the new donor on Record Transaction — regression for the donor-picker submit-bubbling bug", async () => {
    // Arrange
    page.on("request", (req) => {
      if (req.method() === "POST" && new URL(req.url()).pathname === "/api/admin/ledger/transactions") {
        earlyTransactionPosts.push(req.url());
      }
    });
    page.on("response", async (res) => {
      if (
        res.request().method() === "POST" &&
        new URL(res.url()).pathname === "/api/admin/ledger/transactions" &&
        res.status() === 201
      ) {
        const id = (await res.json().catch(() => null))?.id;
        if (typeof id === "string") savedGiftIds.push(id);
      }
    });
    await page.goto("/admin/ledger/activity");
    await page.getByRole("button", { name: "Record Transaction" }).click();
    const dialog = page.getByRole("dialog").first();
    await dialog.locator("#txn-fund").selectOption({ label: activityFundName });
    await dialog.locator("#txn-category").selectOption({ label: QA_CATEGORY });
    await dialog.locator("#txn-amount").fill("300");
    await dialog.locator("#txn-party").fill(QA_PARTY);

    // Act — create a donor inside the picker (its form submits inside the transaction <form>'s React tree)
    await dialog.getByRole("button", { name: "Choose donor" }).click();
    const picker = page.getByRole("dialog").last();
    await picker.getByRole("button", { name: "Create new donor" }).click();
    await picker.locator("#donor-name").fill(QA_DONOR);
    await picker.locator("#donor-email").fill(`qa-e2e-${RUN}@example.invalid`);
    await picker.getByRole("button", { name: "Add", exact: true }).click();
    await picker.locator("button[type=submit]").first().click();
    await expect(dialog).toContainText(QA_DONOR);

    // Assert — the donor is chosen but NO transaction has been posted yet
    expect(earlyTransactionPosts, "the create-donor submit saved the gift early").toHaveLength(0);

    // Act — now actually record the gift
    const posted = page.waitForResponse(
      (res) => res.request().method() === "POST" && new URL(res.url()).pathname === "/api/admin/ledger/transactions",
    );
    await dialog.getByRole("button", { name: "Record Transaction" }).click();
    const response = await posted;
    expect(response.status()).toBe(201);
    giftId = (await response.json()).id;

    // Assert — exactly one POST, and the donor is linked on the saved row
    expect(earlyTransactionPosts).toHaveLength(1);
    const row = await page.request.get(`/api/admin/ledger/transactions/${giftId}/move`);
    expect(row.ok()).toBe(true);
    expect((await row.json()).transaction.donorId).toBeTruthy();
  });

  test("should label the gift on the donor page as not yet a Foundation gift and leave the donor's total at zero", async () => {
    // Arrange
    const move = await page.request.get(`/api/admin/ledger/transactions/${giftId}/move`);
    const donorId = (await move.json()).transaction.donorId as string;

    // Act
    await page.goto(`/admin/ledger/donors/${donorId}`);

    // Assert — a Public Funds gift is not counted as giving until it reaches the Foundation
    await expect(page.getByText("Foundation gifts only")).toBeVisible();
    await expect(page.getByText(`${activityFundName}, not yet a Foundation gift`)).toBeVisible();
    await expect(page.getByRole("button", { name: /^Acknowledge/ })).toHaveCount(0);
    await expect(page.getByText("$0.00").first()).toBeVisible();
  });

  test("should clear the counterpart so the hint says the gift stays in the public fund", async () => {
    // Arrange / Act
    const cleared = await patchCategory(categoryId, { mirrorsCategoryId: null });
    expect(cleared.status()).toBe(200);
    await page.goto("/admin/ledger/activity");
    await page.getByRole("button", { name: "Record Transaction" }).click();
    const dialog = page.getByRole("dialog").first();
    await dialog.locator("#txn-fund").selectOption({ label: activityFundName });
    await dialog.locator("#txn-category").selectOption({ label: QA_CATEGORY });

    // Assert
    await expect(dialog).toContainText("no Foundation counterpart");
    await expect(dialog).toContainText(`staying in ${activityFundName}`);
    await page.keyboard.press("Escape");
  });
});
