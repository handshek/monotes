import { expect, test, type Page } from "@playwright/test";
import { capture, createNote, editor, readStoredNote, waitForStoredContent } from "./notes-helpers";

const initialContent = "The shared starting point before the failed save.";
const pendingContent = "The local draft that has not been saved yet.";
const remoteContent = "The newer text committed by another tab.";

async function abortNextNoteWrite(page: Page, noteId: string) {
  await page.evaluate((id) => {
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      const request = originalPut.call(this, value, key);
      if (this.name === "notes" && (value as { id?: string }).id === id) {
        IDBObjectStore.prototype.put = originalPut;
        this.transaction.abort();
      }
      return request;
    };
  }, noteId);
}

async function pendingDraft(page: Page, noteId: string) {
  return page.evaluate((id) => JSON.parse(
    sessionStorage.getItem(`monotes-draft:${id}`) ?? "null",
  ), noteId);
}

for (const sameContent of [false, true]) {
  test(sameContent
    ? "observing the same pending text saved by another tab stays quiet"
    : "observing a newer remote edit explains why a failed pending draft disappeared", async ({ page, context }, testInfo) => {
    const id = await createNote(page);
    await editor(page).fill(initialContent);
    await waitForStoredContent(page, id, initialContent);
    await abortNextNoteWrite(page, id);
    await editor(page).fill(pendingContent);
    const failure = page.getByRole("alert").filter({ hasText: "Changes aren’t saved to this device." });
    await expect(failure).toBeVisible();
    await waitForStoredContent(page, id, initialContent);
    const pendingBefore = await pendingDraft(page, id);
    expect(pendingBefore?.content).toBe(pendingContent);
    await capture(page, testInfo, "failed-local-draft-before-remote-update");

    const otherTab = await context.newPage();
    await otherTab.goto(`/${id}`);
    await expect(editor(otherTab)).toHaveText(initialContent);
    const expectedContent = sameContent ? pendingContent : remoteContent;
    await editor(otherTab).fill(expectedContent);
    await waitForStoredContent(otherTab, id, expectedContent);
    await expect(editor(page)).toHaveText(expectedContent);
    await expect(failure).not.toBeVisible();
    await expect.poll(() => pendingDraft(page, id)).toBeNull();
    await waitForStoredContent(page, id, expectedContent);
    const updated = page.getByText("Updated from another tab", { exact: true });
    // Allow the observed row's effects and toast animation to settle before recording the result.
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    if (!sameContent) {
      await expect.soft(updated).toBeVisible();
    } else {
      await expect(updated).not.toBeVisible();
    }
    await capture(page, testInfo, "observed-remote-save-result");
    await testInfo.attach("observed-save.json", {
      body: JSON.stringify({
        sameContent,
        pendingBefore,
        pendingAfter: await pendingDraft(page, id),
        storedAfter: await readStoredNote(page, id),
        editorContent: await editor(page).innerText(),
        failureVisible: await failure.isVisible(),
        updatedVisible: await updated.isVisible(),
        successVisible: await page.getByText("Saved", { exact: true }).isVisible(),
      }, null, 2),
      contentType: "application/json",
    });
    await page.reload();
    await expect(editor(page)).toHaveText(expectedContent);
  });
}

test("ordinary remote edits without a pending local draft stay quiet", async ({ page, context }, testInfo) => {
  const id = await createNote(page);
  await editor(page).fill(initialContent);
  await waitForStoredContent(page, id, initialContent);
  await expect.poll(() => pendingDraft(page, id)).toBeNull();
  const otherTab = await context.newPage();
  await otherTab.goto(`/${id}`);
  await expect(editor(otherTab)).toHaveText(initialContent);
  await editor(otherTab).fill(remoteContent);
  await waitForStoredContent(otherTab, id, remoteContent);
  await expect(editor(page)).toHaveText(remoteContent);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByText("Updated from another tab", { exact: true })).not.toBeVisible();
  await expect(page.getByText("Saved", { exact: true })).not.toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Changes aren’t saved to this device." })).not.toBeVisible();
  await capture(page, testInfo, "ordinary-remote-edit-stays-quiet");
  await testInfo.attach("ordinary-remote-edit.json", {
    body: JSON.stringify({
      editorContent: await editor(page).innerText(),
      storedAfter: await readStoredNote(page, id),
      pendingDraft: await pendingDraft(page, id),
    }, null, 2), contentType: "application/json",
  });
  await page.reload();
  await expect(editor(page)).toHaveText(remoteContent);
});
