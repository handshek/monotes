import { defineConfig, devices } from "@playwright/test";

/*
 * Collaboration browser tests. They need the isolated local backend and app
 * started by scripts/collab-e2e.sh, which sets MONOTES_BASE_URL.
 */
const baseURL = process.env.MONOTES_BASE_URL ?? "http://127.0.0.1:3108";
const evidenceDir = process.env.MONOTES_EVIDENCE_DIR ?? ".audit/collab/latest";

export default defineConfig({
  testDir: "./tests/collab-e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
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
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } },
    },
  ],
});
