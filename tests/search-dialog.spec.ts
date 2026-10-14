import { expect, test } from "@playwright/test";
import { capture, createNote, editor, openSidebar, waitForStoredContent } from "./notes-helpers";

test("search stays inside the current note and dismisses without losing edits", async ({ page, isMobile }, testInfo) => {
  const id = await createNote(page);
  const content = "Cobalt lighthouse. My latest sentence stays here.";
  await editor(page).fill(content);
  await openSidebar(page, isMobile);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await capture(page, testInfo, "search-opening");
  await expect(page).toHaveURL(new RegExp(`/${id}$`));
  const dialog = page.getByRole("dialog", { name: "Search notes", exact: true });
  const search = dialog.getByRole("textbox", { name: "Search notes", exact: true });
  await expect(dialog).toBeVisible();
  if (isMobile) await expect(page.getByRole("dialog", { name: "Sidebar", exact: true })).toBeHidden();
  await expect(search).toBeFocused();
  await search.fill("LIGHTHOUSE");
  await expect(dialog.getByRole("link")).toHaveCount(1);
  await expect(dialog.getByRole("link")).toContainText(content);
  await expect(dialog.locator("mark")).toHaveText("lighthouse");
  await capture(page, testInfo, "search-matches-with-note-open");
  await search.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/${id}$`));
  await expect(editor(page)).toHaveText(content);
  await waitForStoredContent(page, id, content);
  const returnTarget = isMobile
    ? page.locator("nav").getByRole("button", { name: "Toggle sidebar", exact: true })
    : page.getByRole("button", { name: "Search", exact: true });
  await expect(returnTarget).toBeFocused();
  await openSidebar(page, isMobile);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(search).toHaveValue("");
  await expect(search).toBeFocused();
  await dialog.getByRole("link").click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/${id}$`));
  await expect(editor(page)).toHaveText(content);
  await expect(editor(page)).toBeFocused();
});

test("search filters local notes offline and opens a result with keyboard or touch", async ({ page, context, isMobile }, testInfo) => {
  const targetId = await createNote(page);
  await editor(page).fill("Morning atlas\nA copper canyon destination.");
  await waitForStoredContent(page, targetId, "Morning atlas\nA copper canyon destination.");
  const currentId = await createNote(page);
  await editor(page).fill("Current notebook. Keep this thought.");
  await waitForStoredContent(page, currentId, "Current notebook. Keep this thought.");
  await openSidebar(page, isMobile);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Search notes", exact: true });
  const search = dialog.getByRole("textbox", { name: "Search notes", exact: true });
  await expect(search).toBeFocused();
  await context.setOffline(true);
  await search.fill("not-found-cobalt");
  await expect(dialog.getByText('No notes matching "not-found-cobalt".', { exact: true })).toBeVisible();
  await expect(dialog.getByRole("link")).toHaveCount(0);
  await search.fill("   ");
  await expect(dialog.getByRole("link")).toHaveCount(2);
  await search.fill("COPPER canyon");
  await expect(dialog.getByRole("link")).toHaveCount(1);
  await expect(dialog.getByRole("link")).toContainText("A copper canyon destination.");
  await expect(page).toHaveURL(new RegExp(`/${currentId}$`));
  await capture(page, testInfo, "offline-search-result");
  await context.setOffline(false);
  if (isMobile) {
    await dialog.getByRole("link").tap();
  } else {
    const newTabPromise = context.waitForEvent("page");
    await dialog.getByRole("link").click({ modifiers: ["ControlOrMeta"] });
    const newTab = await newTabPromise;
    await expect(newTab).toHaveURL(new RegExp(`/${targetId}$`));
    await expect(editor(newTab)).toHaveText("Morning atlasA copper canyon destination.");
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/${currentId}$`));
    await expect(editor(page)).toHaveText("Current notebook. Keep this thought.");
    await newTab.close();
    await search.focus();
    await search.press("Tab");
    await expect(dialog.getByRole("link")).toBeFocused();
    await page.keyboard.press("Enter");
  }
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/${targetId}$`));
  await expect(editor(page)).toHaveText("Morning atlasA copper canyon destination.");
  await waitForStoredContent(page, currentId, "Current notebook. Keep this thought.");
});
