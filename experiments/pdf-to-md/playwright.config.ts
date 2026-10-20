import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "browser.spec.ts",
  outputDir: "../../test-results/pdf-to-md",
  workers: 2,
  use: { baseURL: "http://127.0.0.1:4182" },
  webServer: {
    command: "pnpm dev:pdf-to-md",
    url: "http://127.0.0.1:4182/experiments/pdf-to-md/",
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: "chromium", use: devices["Desktop Chrome"] },
    { name: "webkit", use: { ...devices["iPhone 13"], browserName: "webkit" } },
  ],
});
