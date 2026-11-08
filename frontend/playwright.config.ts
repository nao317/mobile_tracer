import { defineConfig, devices } from "@playwright/test";

const externalURL = process.env.PLAYWRIGHT_BASE_URL;
const useAuthFixture =
  !externalURL &&
  !process.env.API_INTERNAL_URL &&
  process.env.TEST_FIREBASE_BROWSER !== "1";
const authFixtureURL = "http://127.0.0.1:18781";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: externalURL || "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: externalURL
    ? undefined
    : [
        ...(useAuthFixture
          ? [
              {
                command: "node e2e/fixtures/auth-api.mjs",
                url: `${authFixtureURL}/health`,
              },
            ]
          : []),
        {
          command: "npm run build && npm run start",
          url: "http://127.0.0.1:4173",
          env: {
            HOST: "127.0.0.1",
            PORT: "4173",
            APP_ENV: "development",
            ENABLE_UI_PREVIEW: "1",
            ...(useAuthFixture ? { API_INTERNAL_URL: authFixtureURL } : {}),
          },
          stdout: "ignore",
          timeout: 120_000,
        },
      ],
});
