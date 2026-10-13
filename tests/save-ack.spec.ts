import { expect, test } from "@playwright/test";
import { capture, createNote, editor, readStoredNote, waitForStoredContent } from "./notes-helpers";

const draftContent = "This tab's pending draft needs an honest save result.";
const newerContent = "The newer edit committed by the other tab.";

test("manual save does not acknowledge a pending draft displaced by another tab", async ({ page, context }, testInfo) => {
  const id = await createNote(page);
  await editor(page).fill("The shared starting point.");
  await waitForStoredContent(page, id, "The shared starting point.");

  await page.evaluate((noteId) => {
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      const request = originalPut.call(this, value, key);
      if (this.name === "notes" && (value as { id?: string }).id === noteId) {
        IDBObjectStore.prototype.put = originalPut;
        this.transaction.abort();
      }
      return request;
    };
  }, id);
  await editor(page).fill(draftContent);
  await expect(page.getByRole("alert").filter({
    hasText: "Changes aren’t saved to this device.",
  })).toBeVisible();
  await waitForStoredContent(page, id, "The shared starting point.");

  const otherTab = await context.newPage();
  await otherTab.goto(`/${id}`);
  await expect(editor(otherTab)).toHaveText("The shared starting point.");
  // Delay observation of the other tab while keeping both tabs’ real IndexedDB writes.
  await otherTab.evaluate(() => {
    const originalPostMessage = BroadcastChannel.prototype.postMessage;
    BroadcastChannel.prototype.postMessage = function (message: unknown) {
      if (this.name === "x-storagemutated-1") return;
      originalPostMessage.call(this, message);
    };
  });
  await editor(otherTab).fill(newerContent);
  await waitForStoredContent(otherTab, id, newerContent);
  await expect(editor(page)).toHaveText(draftContent);
  const pendingBefore = await page.evaluate((noteId) => JSON.parse(
    sessionStorage.getItem(`monotes-draft:${noteId}`) ?? "null",
  ), id);
  await capture(page, testInfo, "pending-draft-before-manual-save");

  await editor(page).press("ControlOrMeta+s");
  const success = page.getByText("Saved", { exact: true });
  const failure = page.getByText("Couldn’t save note", { exact: true });
  const updated = page.getByText("Updated from another tab", { exact: true });
  await expect(success.or(failure).or(updated)).toBeVisible();
  await capture(page, testInfo, "manual-save-after-newer-tab-commit");
  const observed = {
    pendingBefore,
    storedAfter: await readStoredNote(page, id),
    editorContent: await editor(page).innerText(),
    successVisible: await success.isVisible(),
    failureVisible: await failure.isVisible(),
    updatedVisible: await updated.isVisible(),
    pendingDraft: await page.evaluate((noteId) => JSON.parse(
      sessionStorage.getItem(`monotes-draft:${noteId}`) ?? "null",
    ), id),
  };
  await testInfo.attach("save-ack-observed.json", {
    body: JSON.stringify(observed, null, 2), contentType: "application/json",
  });
  await waitForStoredContent(page, id, newerContent);
  await page.reload();
  await expect(editor(page)).toHaveText(newerContent);
  await capture(page, testInfo, "newer-note-after-reload");
  expect(observed.successVisible).toBe(false);
  expect(observed.updatedVisible).toBe(true);
  expect(observed.failureVisible).toBe(false);
});

test("manual save acknowledges text that is actually durable", async ({ page }, testInfo) => {
  const id = await createNote(page);
  const content = "This manual save stores the exact words shown here.";
  await editor(page).fill(content);
  await editor(page).press("ControlOrMeta+s");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await expect(page.getByText("Updated from another tab", { exact: true })).not.toBeVisible();
  await expect(page.getByText("Couldn’t save note", { exact: true })).not.toBeVisible();
  await waitForStoredContent(page, id, content);
  await capture(page, testInfo, "ordinary-manual-save-acknowledged");
  await page.reload();
  await expect(editor(page)).toHaveText(content);
});
