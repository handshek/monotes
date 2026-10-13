import { expect, test } from "@playwright/test";
import { capture, createNote, editor, openSidebar, waitForStoredContent } from "./notes-helpers";

test("last edit survives reload before the former 500ms autosave delay", async ({ page }, testInfo) => {
  const id = await createNote(page);
  await editor(page).fill("Original saved thought.");
  await waitForStoredContent(page, id, "Original saved thought.");
  await editor(page).fill("The final thought must survive reload.");
  const editCompletedAt = Date.now();
  const reload = page.reload();
  const reloadStartedAt = Date.now();
  await reload;
  await testInfo.attach("reload-timing", {
    body: JSON.stringify({ millisecondsAfterEdit: reloadStartedAt - editCompletedAt }),
    contentType: "application/json",
  });
  expect(reloadStartedAt - editCompletedAt).toBeLessThan(500);
  await capture(page, testInfo, "immediate-reload-result");
  await expect(editor(page)).toHaveText("The final thought must survive reload.");
  await waitForStoredContent(page, id, "The final thought must survive reload.");
});

test("sidebar Search opens a focused search and finds the current note", async ({ page, isMobile }, testInfo) => {
  const id = await createNote(page);
  await editor(page).fill("Cobalt lighthouse search target.");
  await waitForStoredContent(page, id, "Cobalt lighthouse search target.");
  await openSidebar(page, isMobile);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await capture(page, testInfo, "after-sidebar-search");
  const search = page.getByRole("textbox", { name: "Search notes", exact: true });
  await expect(search).toBeVisible();
  await expect(search).toBeFocused();
  await search.fill("lighthouse");
  const results = page.getByRole("region", { name: "Search results (1)", exact: true });
  await expect(results.getByRole("link")).toContainText("Cobalt lighthouse search target.");
  await results.getByRole("link").click();
  await expect(editor(page)).toHaveText("Cobalt lighthouse search target.");
});


test("a cross-tab edit reverted to the original content remains reverted after reload", async ({ page, context }, testInfo) => {
  const id = await createNote(page);
  await editor(page).fill("Original shared thought.");
  await waitForStoredContent(page, id, "Original shared thought.");
  const otherTab = await context.newPage();
  await otherTab.goto(`/${id}`);
  await expect(editor(otherTab)).toHaveText("Original shared thought.");
  await editor(page).fill("Replacement from the first tab.");
  await expect(editor(otherTab)).toHaveText("Replacement from the first tab.");
  await editor(otherTab).fill("Original shared thought.");
  await expect(editor(page)).toHaveText("Original shared thought.");
  // Both former 500ms save timers must expire before checking the final stored value.
  await page.waitForTimeout(750);
  await otherTab.reload();
  await capture(otherTab, testInfo, "cross-tab-reversion-after-reload");
  await expect(editor(otherTab)).toHaveText("Original shared thought.");
  await waitForStoredContent(otherTab, id, "Original shared thought.");
});


test("a new note survives reload immediately after its first edit", async ({ page }, testInfo) => {
  const id = await createNote(page);
  await editor(page).fill("A new thought must survive its first reload.");
  await page.reload();
  await capture(page, testInfo, "new-note-immediate-reload");
  await expect(editor(page)).toHaveText("A new thought must survive its first reload.");
  await waitForStoredContent(page, id, "A new thought must survive its first reload.");
});
