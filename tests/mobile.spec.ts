import { expect, test } from "@playwright/test";
import { capture, createNote, editor, openSidebar, waitForStoredContent } from "./notes-helpers";

test("mobile note selection closes the drawer and exposes the editor", async ({ page }, testInfo) => {
  const firstId = await createNote(page);
  await editor(page).fill("First mobile note.");
  await waitForStoredContent(page, firstId, "First mobile note.");
  const secondId = await createNote(page);
  await editor(page).fill("Second mobile note.");
  await waitForStoredContent(page, secondId, "Second mobile note.");
  await openSidebar(page, true);
  const drawer = page.getByRole("dialog", { name: "Sidebar", exact: true });
  await drawer.getByRole("link", { name: "First mobile note.", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/${firstId}$`));
  await capture(page, testInfo, "after-mobile-note-selection");
  await expect(drawer).not.toBeVisible();
  await expect(editor(page)).toHaveText("First mobile note.");
  await editor(page).press("ControlOrMeta+End");
  await editor(page).pressSequentially(" Edited after opening.", { delay: 30 });
  await waitForStoredContent(page, firstId, "First mobile note. Edited after opening.");
  await openSidebar(page, true);
  await drawer.getByRole("link", { name: "First mobile note. Edited after opening.", exact: true }).click();
  await expect(drawer).not.toBeVisible();
  await expect(editor(page)).toHaveText("First mobile note. Edited after opening.");
});

test("mobile New Note closes the drawer and allows immediate typing", async ({ page }, testInfo) => {
  const firstId = await createNote(page);
  await editor(page).fill("Existing mobile note.");
  await waitForStoredContent(page, firstId, "Existing mobile note.");
  await openSidebar(page, true);
  const drawer = page.getByRole("dialog", { name: "Sidebar", exact: true });
  await drawer.getByRole("button", { name: "New Note", exact: true }).click();

  await capture(page, testInfo, "after-mobile-note-creation");
  await expect(drawer).not.toBeVisible();
  await editor(page).fill("Created from the mobile drawer.");
  const id = new URL(page.url()).pathname.slice(1);
  await waitForStoredContent(page, id, "Created from the mobile drawer.");
  await page.reload();
  await expect(editor(page)).toHaveText("Created from the mobile drawer.");
});
