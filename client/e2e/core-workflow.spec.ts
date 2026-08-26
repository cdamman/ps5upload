import { expect, test } from "@playwright/test";

test("guides a disconnected user through primary navigation and recovery", async ({
  page,
}) => {
  // Each Playwright context starts with empty storage, so no console host is
  // selected and this journey cannot issue a PS5-targeted operation. Vite
  // serves any same-origin /api probe as inert app HTML in this test setup.
  await page.goto("/home", { waitUntil: "domcontentloaded" });

  // The sidebar pins Home and nothing else until the user stars screens in
  // More, so a fresh profile sees exactly one favourite plus the More
  // escape hatch. (The nav landmark keeps its "Primary" name deliberately —
  // "Favorites" is the visible heading, not the landmark's accessible name.)
  const primary = page.getByRole("navigation", { name: "Primary" });
  await expect(primary.getByRole("link", { name: "Home" })).toBeVisible();
  await expect(primary.getByText("Star screens in More")).toBeVisible();
  for (const notPinned of ["Games", "Files", "Console", "Tasks"]) {
    await expect(primary.getByRole("link", { name: notPinned })).toHaveCount(0);
  }

  await expect(
    page.getByRole("heading", { name: "Connect a PS5 to get started" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Connect PS5" })).toBeVisible();
  await expect(page.getByText("Connect to your PS5 to see live telemetry.")).toBeVisible();
  await expect(
    page.locator('[aria-disabled="true"]').filter({ hasText: "Upload" }),
  ).toBeVisible();

  // Everything unpinned stays one click away through More.
  await page.getByRole("link", { name: "More" }).click();
  await page.getByRole("link", { name: "Tasks" }).click();
  await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Tasks", pressed: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /history/i })).toBeVisible();
  await expect(page.getByText("No activity yet")).toBeVisible();

  await page.getByRole("link", { name: "More" }).click();
  await expect(page.getByRole("heading", { name: "More" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Install Package" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
});
