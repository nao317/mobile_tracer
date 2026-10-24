import { expect, test } from "@playwright/test";

test("the home page displays the welcome content", async ({ page }) => {
  const response = await page.goto("/");

  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle("New React Router App");
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByText("What's next?")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "React Router Docs" }),
  ).toHaveAttribute("href", "https://reactrouter.com/docs");
  await expect(page.getByRole("link", { name: "Join Discord" })).toHaveAttribute(
    "href",
    "https://rmx.as/discord",
  );
});

test("an unknown URL displays the 404 page", async ({ page }) => {
  const response = await page.goto("/not-a-real-page");

  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
  await expect(
    page.getByText("The requested page could not be found."),
  ).toBeVisible();
});
