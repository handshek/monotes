import { chromium, webkit, devices, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { createNote, editor, waitForStoredContent } from "../tests/notes-helpers";

const baseURL = process.env.MONOTES_BASE_URL ?? "http://127.0.0.1:3107";
const evidenceDir = process.env.MONOTES_EVIDENCE_DIR ?? ".audit/overnight/offline-shell";
await mkdir(evidenceDir, { recursive: true });
const results = [];

for (const name of ["desktop-chromium", "mobile-webkit"] as const) {
  const browser = await (name === "desktop-chromium" ? chromium : webkit).launch();
  const context = await browser.newContext({
    baseURL,
    ...(name === "desktop-chromium"
      ? { viewport: { width: 1440, height: 900 } }
      : devices["iPhone 13"]),
  });
  try {
    const page = await context.newPage();
    const id = await createNote(page);
    await editor(page).fill("Offline reload characterization note.");
    await waitForStoredContent(page, id, "Offline reload characterization note.");
    await context.setOffline(true);
    let reloadError: string | null = null;
    try {
      await page.reload({ waitUntil: "load", timeout: 10_000 });
    } catch (error) {
      reloadError = error instanceof Error ? error.message : String(error);
    }
    const editorAvailableOffline = await editor(page).isVisible();
    await page.screenshot({ path: `${evidenceDir}/${name}-offline-reload.png`, fullPage: true });
    await context.setOffline(false);
    await page.goto(`/${id}`);
    await expect(editor(page)).toHaveText("Offline reload characterization note.");
    results.push({ name, navigationSucceeded: reloadError === null, editorAvailableOffline, reloadError, contentRecoveredAfterReconnect: true });
  } finally {
    await browser.close();
  }
}

await writeFile(`${evidenceDir}/report.json`, JSON.stringify(results, null, 2) + "\n");
console.log(JSON.stringify(results, null, 2));
