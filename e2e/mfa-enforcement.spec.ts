import { expect, test, type Page } from "@playwright/test";
import { totp } from "../scripts/spike/_shared.mjs";

// These variables must point to a disposable non-production Supabase user that
// already has a verified TOTP factor. The spec is intentionally skipped until an
// operator supplies those values; it never creates users or prints credentials.
const mfaAccount = {
  email: process.env.E2E_MFA_EMAIL,
  password: process.env.E2E_MFA_PASSWORD,
  secret: process.env.E2E_MFA_TOTP_SECRET,
};
const adminMfaAccount = {
  email: process.env.E2E_MFA_ADMIN_EMAIL,
  password: process.env.E2E_MFA_ADMIN_PASSWORD,
  secret: process.env.E2E_MFA_ADMIN_TOTP_SECRET,
};

function configured(account: typeof mfaAccount) {
  return Boolean(account.email && account.password && account.secret);
}

async function loginAndCompleteChallenge(
  page: Page,
  account: typeof mfaAccount,
) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Alamat Email").fill(account.email!);
  await page.getByLabel("Kata Sandi").fill(account.password!);
  await page.getByRole("button", { name: "Masuk ke Sistem" }).click();

  await expect(page).toHaveURL(/\/mfa(?:\?|$)/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Verifikasi Dua Langkah" })).toBeVisible();
  await page.getByLabel("Kode Autentikasi").fill(totp(account.secret!, { timestamp: Date.now() + 1_000 }));
  await page.getByRole("button", { name: "Verifikasi" }).click();
  await expect(page).not.toHaveURL(/\/mfa(?:\?|$)/, { timeout: 15_000 });
}

test.describe("MFA automated enforcement — authenticated browser flow", () => {
  test("L1 challenge leads to protected access only after AAL2", async ({ page }) => {
    test.skip(!configured(mfaAccount), "Disposable MFA E2E credentials are not configured");

    await loginAndCompleteChallenge(page, mfaAccount);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Beranda Santri" })).toBeVisible();
  });

  test("admin MFA badge reports factor evidence without claiming live AAL2", async ({ page }) => {
    test.skip(!configured(adminMfaAccount), "Disposable admin MFA E2E credentials are not configured");

    await loginAndCompleteChallenge(page, adminMfaAccount);
    await page.goto("/admin/users", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("MFA: verified", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("AAL2", { exact: true })).toHaveCount(0);
  });
});
