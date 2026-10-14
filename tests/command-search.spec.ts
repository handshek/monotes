import { expect, test } from "@playwright/test";
import { capture, createNote, editor, openSidebar, waitForStoredContent } from "./notes-helpers";

test("Cmd and Ctrl K open search without changing the note and Escape restores editing", async ({ page }, testInfo) => {
  const id = await createNote(page);
  const content = "Keep this entire sentence when searching.";
  await editor(page).fill(content);
  for (const modifier of ["Meta", "Control"]) {
    await editor(page).press("Home");
    await editor(page).press(`${modifier}+k`);
    await capture(page, testInfo, `${modifier}-k`);
    const dialog = page.getByRole("dialog", { name: "Search notes", exact: true });
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/${id}$`));
    const input = dialog.getByRole("combobox", { name: "Search notes", exact: true });
    await expect(input).toBeFocused();
    await input.press(`${modifier}+k`);
    await expect(dialog).toBeHidden();
    await expect(editor(page)).toBeFocused();
    await editor(page).press(`${modifier}+k`);
    await expect(input).toBeFocused();
    await input.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(editor(page)).toHaveText(content);
    await expect(editor(page)).toBeFocused();
  }
  await waitForStoredContent(page, id, content);
  await page.goto("/");
  await page.getByRole("textbox", { name: "Search notes", exact: true }).press("ControlOrMeta+k");
  await expect(page.getByRole("dialog", { name: "Search notes", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test("search input is not clipped and each note result has a visible border", async ({ page, isMobile }, testInfo) => {
  await createNote(page);
  await editor(page).fill("Bordered note result. A clearly visible search field.");
  await openSidebar(page, isMobile);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Search notes", exact: true });
  const input = dialog.getByPlaceholder("Search notes...", { exact: true });
  await expect(input).toBeFocused();
  const result = dialog.locator("a");
  await expect(result).toHaveCount(1);
  await capture(page, testInfo, "search-boundaries");
  const clipping = await input.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const ring = style.boxShadow !== "none" && !style.boxShadow.includes("inset") ? 3 : 0;
    const clippedBy: string[] = [];
    let parent = element.parentElement;
    while (parent) {
      const parentStyle = getComputedStyle(parent);
      const bounds = parent.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(parentStyle.overflowY) &&
        (rect.top - ring < bounds.top - 0.5 || rect.bottom + ring > bounds.bottom + 0.5)) {
        clippedBy.push(parent.getAttribute("data-slot") || parent.tagName);
      }
      parent = parent.parentElement;
    }
    return clippedBy;
  });
  await expect.soft(clipping).toEqual([]);
  const border = await result.evaluate((element) => {
    const style = getComputedStyle(element);
    return { width: parseFloat(style.borderTopWidth), style: style.borderTopStyle, color: style.borderTopColor };
  });
  await expect.soft(border.width).toBeGreaterThanOrEqual(1);
  await expect.soft(border.style).toBe("solid");
  await expect.soft(border.color).not.toBe("rgba(0, 0, 0, 0)");
});


test("command input stays visible while long results scroll in a short viewport", async ({ page, isMobile }, testInfo) => {
  for (let i = 0; i < 4; i++) {
    const id = await createNote(page);
    const text = `Note ${i}.\nFirst visible preview line.\nSecond visible preview line.`;
    await editor(page).fill(text);
    await waitForStoredContent(page, id, text);
  }
  await page.setViewportSize({ width: isMobile ? 390 : 1024, height: 480 });
  await openSidebar(page, isMobile);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Search notes", exact: true });
  const input = dialog.getByRole("combobox", { name: "Search notes", exact: true });
  const list = dialog.getByRole("listbox");
  await expect(dialog.getByRole("option")).toHaveCount(4);
  await dialog.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)); });
  const before = await input.boundingBox();
  await input.press("End");
  await expect(dialog.getByRole("option", { selected: true })).toContainText("Note 0.");
  const after = await input.boundingBox();
  expect(after).toEqual(before);
  const scrolling = await list.evaluate(element => ({ scrollHeight: element.scrollHeight, clientHeight: element.clientHeight, scrollTop: element.scrollTop }));
  expect(scrolling.scrollHeight).toBeGreaterThan(scrolling.clientHeight);
  expect(scrolling.scrollTop).toBeGreaterThan(0);
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(480);
  await expect(input).toBeVisible();
  await capture(page, testInfo, "command-short-viewport");
});


test("Tab skips command results while arrow keys choose the note to open", async ({ page }) => {
  const target = await createNote(page);
  await editor(page).fill("First note for arrow selection.");
  await waitForStoredContent(page, target, "First note for arrow selection.");
  await createNote(page);
  await editor(page).fill("Current note for keyboard navigation.");
  await editor(page).press("ControlOrMeta+k");
  const dialog = page.getByRole("dialog", { name: "Search notes", exact: true });
  const input = dialog.getByRole("combobox", { name: "Search notes", exact: true });
  await expect(dialog.getByRole("option")).toHaveCount(2);
  await input.press("Tab");
  await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(input).toBeFocused();
  await input.press("ArrowDown");
  await expect(dialog.getByRole("option", { selected: true })).toContainText("First note");
  await input.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/${target}$`));
});

test("search shortcut respects another open modal", async ({ page, isMobile }) => {
  await createNote(page);
  await page.getByRole("button", { name: "settings", exact: true }).click();
  const settings = page.getByRole("dialog");
  await expect(settings).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByRole("dialog", { name: "Search notes", exact: true })).toBeHidden();
  await expect(settings).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();
  await openSidebar(page, isMobile);
  await page.keyboard.press("ControlOrMeta+k");
  const searchDialog = page.getByRole("dialog", { name: "Search notes", exact: true });
  await expect(searchDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(searchDialog).toBeHidden();
  await openSidebar(page, isMobile);
  await page.getByRole("button", { name: "Options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(searchDialog).toBeHidden();
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
});
