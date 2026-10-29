import { expect, test, type Page } from "@playwright/test";
import { capture, createNote, editor, openSidebar, readStoredNote, toastTitle, waitForStoredContent } from "./notes-helpers";

const failedSaveMessage = "Changes aren’t saved to this device. Keep this tab open and try saving again.";

async function abortWritesForNote(page: Page, id: string) {
  await page.evaluate((noteId) => {
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      const request = originalPut.call(this, value, key);
      if (this.name === "notes" && (value as { id?: string }).id === noteId) {
        this.transaction.abort();
        const current = Number(sessionStorage.getItem("monotes-test-aborted-writes") ?? 0);
        sessionStorage.setItem("monotes-test-aborted-writes", String(current + 1));
      }
      return request;
    };
  }, id);
}

async function expectAbortedWrite(page: Page) {
  await expect.poll(() => page.evaluate(() =>
    Number(sessionStorage.getItem("monotes-test-aborted-writes") ?? 0),
  )).toBeGreaterThan(0);
}

async function readSessionDraft(page: Page, id: string) {
  return page.evaluate((noteId) => JSON.parse(
    sessionStorage.getItem(`monotes-draft:${noteId}`) ?? "null",
  ) as { content: string } | null, id);
}

test("an empty newly created note survives reload", async ({ page }, testInfo) => {
  const id = await createNote(page);
  await expect(editor(page).locator(".cm-placeholder")).toBeVisible();
  await page.reload();
  await expect(editor(page).locator(".cm-placeholder")).toBeVisible();
  await capture(page, testInfo, "empty-note-after-reload");
  await waitForStoredContent(page, id, "");
  await page.goto("/");
  const savedNote = page.getByRole("region", { name: "Your Notes", exact: true })
    .getByRole("link").filter({ hasText: "Untitled note" });
  await expect(savedNote).toBeVisible();
  await expect(savedNote).toHaveAttribute("href", `/${id}`);
});

test("failed local saves show failure and recover the draft after reload", async ({ page }, testInfo) => {
  const id = await createNote(page);
  await editor(page).fill("The committed starting point.");
  await waitForStoredContent(page, id, "The committed starting point.");
  await abortWritesForNote(page, id);
  await editor(page).fill("The unsaved thought must survive a failed write.");
  await expectAbortedWrite(page);
  await waitForStoredContent(page, id, "The committed starting point.");
  await editor(page).press("ControlOrMeta+s");
  await capture(page, testInfo, "forced-local-save-failure");
  const saveFailure = page.getByRole("alert").filter({ hasText: failedSaveMessage });
  await expect(saveFailure).toBeVisible();
  await expect(toastTitle(page, "Couldn’t save note")).toBeVisible();
  await expect(page.getByText("Saved", { exact: true })).not.toBeVisible();
  await page.reload();
  await expect(editor(page)).toHaveText("The unsaved thought must survive a failed write.");
  await waitForStoredContent(page, id, "The unsaved thought must survive a failed write.");
  await expect(saveFailure).not.toBeVisible();
  await capture(page, testInfo, "draft-recovered-after-reload");
});

for (const sameContent of [false, true]) {
  test(sameContent
    ? "an older session draft with already-saved content stays quiet"
    : "an older session draft cannot replace a newer edit committed by another tab", async ({ page, context }, testInfo) => {
    const id = await createNote(page);
    await editor(page).fill("The original shared note.");
    await waitForStoredContent(page, id, "The original shared note.");
    await abortWritesForNote(page, id);
    await editor(page).fill("The older interrupted draft.");
    await expectAbortedWrite(page);
    await waitForStoredContent(page, id, "The original shared note.");
    expect((await readSessionDraft(page, id))?.content).toBe("The older interrupted draft.");
    await page.goto("about:blank");

    const otherTab = await context.newPage();
    await otherTab.goto(`/${id}`);
    await expect(editor(otherTab)).toHaveText("The original shared note.");
    const expectedContent = sameContent ? "The older interrupted draft." : "The newer committed thought wins.";
    await editor(otherTab).fill(expectedContent);
    await waitForStoredContent(otherTab, id, expectedContent);

    await page.goto(`/${id}`);
    await expect(editor(page)).toHaveText(expectedContent);
    await expect.poll(() => readSessionDraft(page, id)).toBeNull();
    await waitForStoredContent(page, id, expectedContent);
    const updated = page.getByText("Updated from another tab", { exact: true });
    if (sameContent) await expect(updated).not.toBeVisible();
    else await expect.soft(updated).toBeVisible();
    await capture(page, testInfo, "newer-committed-edit-preserved");
  });
}

test("an older session draft cannot resurrect a note deleted in another tab", async ({ page, context, isMobile }, testInfo) => {
  const id = await createNote(page);
  await editor(page).fill("Delete this shared note.");
  await waitForStoredContent(page, id, "Delete this shared note.");
  await abortWritesForNote(page, id);
  await editor(page).fill("An interrupted draft that must stay deleted.");
  await expectAbortedWrite(page);
  await waitForStoredContent(page, id, "Delete this shared note.");
  expect((await readSessionDraft(page, id))?.content).toBe("An interrupted draft that must stay deleted.");
  await page.goto("about:blank");

  const otherTab = await context.newPage();
  await otherTab.goto(`/${id}`);
  await expect(editor(otherTab)).toHaveText("Delete this shared note.");
  await openSidebar(otherTab, isMobile);
  await otherTab.getByRole("button", { name: "Options", exact: true }).click();
  await otherTab.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await otherTab.getByRole("button", { name: "Yes, delete note", exact: true }).click();
  await expect.poll(() => readStoredNote(otherTab, id)).toBeNull();

  await page.goto(`/${id}`);
  await expect(page.getByText("Note not found", { exact: true })).toBeVisible();
  await expect(editor(page)).not.toBeVisible();
  await expect.poll(() => readSessionDraft(page, id)).toBeNull();
  await expect.poll(() => readStoredNote(page, id)).toBeNull();
  await expect(page.getByText("Updated from another tab", { exact: true })).not.toBeVisible();
  await capture(page, testInfo, "deleted-note-stays-deleted");
});
