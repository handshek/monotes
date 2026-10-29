import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.MONOTES_BASE_URL ?? "http://127.0.0.1:3107";
const evidenceDir = process.env.MONOTES_EVIDENCE_DIR ?? ".audit/overnight/latest";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  outputDir: `${evidenceDir}/test-results`,
  reporter: [
    ["list"],
    ["json", { outputFile: `${evidenceDir}/report.json` }],
    ["html", { outputFolder: `${evidenceDir}/html`, open: "never" }],
  ],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      testIgnore: "**/mobile.spec.ts",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "mobile-webkit",
      use: { ...devices["iPhone 13"] },
    },
  ],
  webServer: process.env.MONOTES_BASE_URL
    ? undefined
    : {
        command: "bun run build && bun run start --hostname 127.0.0.1 --port 3107",
        url: baseURL,
        reuseExistingServer: false,
        timeout: 180_000,
      },
});
