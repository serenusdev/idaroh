import { expect, test } from "@playwright/test";

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.describe("authentication boundary", () => {
  test("redirects an anonymous browser to login", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("button", { name: "Masuk ke Sistem" })).toBeVisible();
  });

  test("allows an active seeded user to reach the dashboard", async ({ page }) => {
    test.skip(!email || !password, "E2E credentials are not configured");

    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await expect(page.locator("form[data-hydrated='true']")).toBeVisible();
    await page.getByLabel("Alamat Email").fill(email!);
    await page.getByLabel("Kata Sandi").fill(password!);
    await page.getByRole("button", { name: "Masuk ke Sistem" }).click();

    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Beranda Santri" })).toBeVisible();
  });
});
