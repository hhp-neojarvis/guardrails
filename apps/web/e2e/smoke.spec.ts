import { test, expect } from "@playwright/test";

test("homepage loads with correct heading", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h1")).toHaveText("Guardrails");
});

test("homepage displays tagline", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Media Executor Guardrails Tool")).toBeVisible();
});

test("page has correct title", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Guardrails|Vite/);
});
