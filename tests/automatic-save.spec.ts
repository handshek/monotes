import { expect, test } from "@playwright/test";
import type { NoteContent } from "../src/lib/local-db";
import { capture, createNote, editor, readStoredNote, waitForStoredContent } from "./notes-helpers";

const initialContent = "The original shared content before the tabs diverge.";
const pendingContent = "The stale tab's automatic draft must not disappear silently.";
const newerContent = "The logically newer edit already committed by another tab.";

test("automatic stale-save settlement explains replacement of the pending draft", async ({ page, context }, testInfo) => {
  const id = await createNote(page);
  await editor(page).fill(initialContent);
  await waitForStoredContent(page, id, initialContent);
  await expect.poll(() => page.evaluate((noteId) => sessionStorage.getItem(`monotes-draft:${noteId}`), id)).toBeNull();

  const otherTab = await context.newPage();
  await otherTab.goto(`/${id}`);
  await expect(editor(otherTab)).toHaveText(initialContent);
  // Force a stale revision deterministically; this is not a measurement of production race frequency.
  await otherTab.evaluate(() => {
    const originalNow = Date.now;
    Date.now = () => originalNow() + 60_000;
    const originalPostMessage = BroadcastChannel.prototype.postMessage;
    BroadcastChannel.prototype.postMessage = function (message: unknown) {
      if (this.name === "x-storagemutated-1") return;
      originalPostMessage.call(this, message);
    };
  });
  await editor(otherTab).fill(newerContent);
  await waitForStoredContent(otherTab, id, newerContent);
  const storedBefore = await readStoredNote(page, id) as NoteContent;
  await expect(editor(page)).toHaveText(initialContent);
  await capture(page, testInfo, "stale-editor-before-automatic-save");

  // Observe the actual session draft without changing its value or interrupting the real save.
  await page.evaluate((noteId) => {
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      originalSetItem.call(this, key, value);
      if (this === sessionStorage && key === `monotes-draft:${noteId}`) {
        originalSetItem.call(this, "monotes-audit-captured-draft", value);
      }
    };
  }, id);
  await editor(page).fill(pendingContent);
  const capturedDraft = await page.evaluate(() => JSON.parse(sessionStorage.getItem("monotes-audit-captured-draft") ?? "null"));
  expect(capturedDraft?.content).toBe(pendingContent);
  expect(capturedDraft.localRevision.clock).toBeLessThan(storedBefore.localRevision!.clock);
  await expect(editor(page)).toHaveText(newerContent);
  await waitForStoredContent(page, id, newerContent);
  await expect.poll(() => page.evaluate((noteId) => sessionStorage.getItem(`monotes-draft:${noteId}`), id)).toBeNull();
  const updated = page.getByText("Updated from another tab", { exact: true });
  await expect.soft(updated).toBeVisible();
  await capture(page, testInfo, "automatic-stale-save-result");
  await testInfo.attach("automatic-save.json", {
    body: JSON.stringify({
      injection: { remoteClockOffsetMs: 60_000, suppressedChannel: "x-storagemutated-1" },
      storedBefore,
      capturedDraft,
      storedAfter: await readStoredNote(page, id),
      editorContent: await editor(page).innerText(),
      pendingAfter: await page.evaluate((noteId) => sessionStorage.getItem(`monotes-draft:${noteId}`), id),
      updatedVisible: await updated.isVisible(),
      successVisible: await page.getByText("Saved", { exact: true }).isVisible(),
      failureVisible: await page.getByRole("alert").filter({ hasText: "Changes aren’t saved to this device." }).isVisible(),
    }, null, 2), contentType: "application/json",
  });
  await page.reload();
  await expect(editor(page)).toHaveText(newerContent);
});
