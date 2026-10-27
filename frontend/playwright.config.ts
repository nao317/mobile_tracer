import { defineConfig, devices } from "@playwright/test";

const externalURL = process.env.PLAYWRIGHT_BASE_URL;

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
  webServer: externalURL ? undefined : {
    command: "npm run build && npm run start",
    url: "http://127.0.0.1:4173",
    env: { HOST: "127.0.0.1", PORT: "4173" },
    stdout: "pipe",
    timeout: 120_000,
  },
});
