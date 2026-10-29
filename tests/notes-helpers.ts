import { expect, type Page, type TestInfo } from "@playwright/test";

export const editor = (page: Page) => page.locator('.cm-content[contenteditable="true"]');

// A toast's visible title. Failure toasts are also announced through a separate role="alert" element, so the
// lookup stays inside the visible stack.
export const toastTitle = (page: Page, title: string) =>
  page.getByRole("region", { name: "Notifications" }).getByText(title, { exact: true });

export async function createNote(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Create new note", exact: true }).click();
  await expect(page).toHaveURL(/\/[a-zA-Z0-9_-]+$/);
  const welcome = page.getByRole("dialog", { name: "Welcome to Monotes" });
  if (!(await page.evaluate(() => localStorage.getItem("monotes-welcome-dismissed")))) {
    await expect(welcome).toBeVisible();
    await welcome.getByRole("checkbox", { name: "Do not show again" }).check();
    await welcome.getByRole("button", { name: "Okay", exact: true }).click();
  }
  await expect(editor(page)).toBeVisible();
  return new URL(page.url()).pathname.slice(1);
}

export async function readStoredNote(page: Page, id: string) {
  return page.evaluate(async (noteId) => {
    return new Promise<{ id: string; content: string; cloudStatus: string } | null>(
      (resolve, reject) => {
        const request = indexedDB.open("monotes-db");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction("notes", "readonly");
          const get = transaction.objectStore("notes").get(noteId);
          get.onsuccess = () => resolve(get.result ?? null);
          get.onerror = () => reject(get.error);
          transaction.oncomplete = () => db.close();
        };
      },
    );
  }, id);
}

export async function waitForStoredContent(page: Page, id: string, content: string) {
  await expect.poll(async () => (await readStoredNote(page, id))?.content).toBe(content);
}

export async function openSidebar(page: Page, isMobile: boolean) {
  if (isMobile) {
    // A drawer that was just dismissed stays on the page until its exit transition ends.
    await expect(page.getByRole("dialog", { name: "Sidebar", exact: true })).toBeHidden();
    await page.getByRole("button", { name: "Toggle sidebar", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Sidebar", exact: true })).toBeVisible();
  }
}

export async function capture(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  await testInfo.attach(name, { path, contentType: "image/png" });
}
