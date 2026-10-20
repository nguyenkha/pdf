import { defineConfig, devices } from "@playwright/test";
// Corpus and memory checks: run `node scripts/make-corpus.mjs` first.
export default defineConfig({
  testDir: "tests/memory",
  timeout: 300_000,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4173" },
  webServer: {
    command: "pnpm preview --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173/en/",
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: "iphone-webkit", use: { ...devices["iPhone 13"], browserName: "webkit" } },
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
