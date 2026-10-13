import { expect, test } from "@playwright/test";
import { createNote, editor, openSidebar, waitForStoredContent } from "./notes-helpers";

test("sidebar previews preserve the first twenty words and blank note fallback", async ({ page, isMobile }) => {
  const id = await createNote(page);
  const words = Array.from({ length: 24 }, (_, index) => `word${index + 1}`);
  const separators = [" ", "\n", "\t", "\u00a0", "\u2003"];
  const content = `  ${words.map((word, index) => word + separators[index % separators.length]).join("")}  `;
  await editor(page).fill(content);
  await waitForStoredContent(page, id, content);
  await openSidebar(page, isMobile);
  const noteLink = page.locator(`a[href="/${id}"]`);
  await expect(noteLink).toHaveText(words.slice(0, 20).join(" "));
  if (isMobile) await noteLink.click();
  await editor(page).fill(" \t\n\u00a0\u2003 ");
  await waitForStoredContent(page, id, " \t\n\u00a0\u2003 ");
  await openSidebar(page, isMobile);
  await expect(noteLink).toHaveText(id);
});
