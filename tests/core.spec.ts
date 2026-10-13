import { expect, test } from "@playwright/test";
import { capture, createNote, editor, readStoredNote, waitForStoredContent } from "./notes-helpers";

test("create, edit, reload, and search local notes", async ({ page, isMobile }, testInfo) => {
  const firstId = await createNote(page);
  await editor(page).fill("Morning atlas\nA quiet place for ideas.");
  await waitForStoredContent(page, firstId, "Morning atlas\nA quiet place for ideas.");
  await page.reload();
  await expect(editor(page)).toHaveText("Morning atlasA quiet place for ideas.");
  if (!isMobile) await editor(page).press("i");
  await editor(page).press("ControlOrMeta+End");
  await editor(page).press("Enter");
  await editor(page).pressSequentially("The revised trail.", { delay: 30 });
  await waitForStoredContent(page, firstId, "Morning atlas\nA quiet place for ideas.\nThe revised trail.");
  await page.reload();
  await expect(editor(page)).toContainText("The revised trail.");
  await capture(page, testInfo, "saved-and-reloaded-note");

  const secondId = await createNote(page);
  await editor(page).fill("Evening journal\nA different collection.");
  await waitForStoredContent(page, secondId, "Evening journal\nA different collection.");
  await page.goto("/");
  await page.getByRole("textbox", { name: "Search notes", exact: true }).fill("REVISED trail");
  const results = page.getByRole("region", { name: "Search results (1)", exact: true });
  await expect(results.getByRole("link")).toHaveCount(1);
  await expect(results.getByRole("link")).toContainText("Morning atlas");
  await capture(page, testInfo, "search-finds-edited-content");
  await results.getByRole("link").click();
  await expect(editor(page)).toContainText("The revised trail.");
  await page.goto("/");
  await page.getByRole("textbox", { name: "Search notes", exact: true }).fill("unfindable-cobalt-phrase");
  await expect(page.getByText('No notes matching "unfindable-cobalt-phrase".', { exact: true })).toBeVisible();
});

test("offline edits persist locally and survive reconnect and reload", async ({ page, context }, testInfo) => {
  const id = await createNote(page);
  await editor(page).fill("Travel notebook\nWritten while connected.");
  await waitForStoredContent(page, id, "Travel notebook\nWritten while connected.");
  await context.setOffline(true);
  await editor(page).fill("Travel notebook\nWritten while offline.");
  await waitForStoredContent(page, id, "Travel notebook\nWritten while offline.");
  await expect(editor(page)).toContainText("Written while offline.");
  expect((await readStoredNote(page, id))?.cloudStatus).toBe("local");
  await capture(page, testInfo, "offline-edit-stored");
  await context.setOffline(false);
  await page.reload();
  await expect(editor(page)).toHaveText("Travel notebookWritten while offline.");
  await capture(page, testInfo, "offline-edit-after-reconnect");
});
