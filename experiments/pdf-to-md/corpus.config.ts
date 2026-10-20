import base from "./playwright.config";
import { defineConfig } from "@playwright/test";
export default defineConfig({
  ...base,
  testMatch: "public-corpus.spec.ts",
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
