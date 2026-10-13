import { expect, test } from "@playwright/test";
import { capture, editor } from "./notes-helpers";

test("the direct new-note route creates exactly one durable note", async ({ page }, testInfo) => {
  await page.goto("/new");
  const welcome = page.getByRole("dialog", { name: "Welcome to Monotes" });
  await expect(welcome).toBeVisible();
  await welcome.getByRole("checkbox", { name: "Do not show again" }).check();
  await welcome.getByRole("button", { name: "Okay", exact: true }).click();
  await expect(editor(page)).toBeVisible();
  const notePath = new URL(page.url()).pathname;
  expect(notePath).not.toBe("/new");
  await page.goto("/");
  const notes = page.getByRole("region", { name: "Your Notes", exact: true });
  await capture(page, testInfo, "notes-after-direct-creation");
  await expect(notes.getByRole("link")).toHaveCount(1);
  await expect(notes.getByRole("link")).toHaveAttribute("href", notePath);
});

for (const entry of ["home", "direct"] as const) {
  test(`a failed ${entry} note creation reports the failure`, async ({ page }, testInfo) => {
    await page.addInitScript(() => {
      const originalAdd = IDBObjectStore.prototype.add;
      IDBObjectStore.prototype.add = function (value: unknown, key?: IDBValidKey) {
        const request = originalAdd.call(this, value, key);
        if (this.name === "notes") this.transaction.abort();
        return request;
      };
    });
    await page.goto(entry === "home" ? "/" : "/new");
    if (entry === "home") {
      await page.getByRole("button", { name: "Create new note", exact: true }).click();
    }
    await expect(page.getByText("Could not create note. Please try again.", { exact: true })).toBeVisible();
    if (entry === "direct") {
      await page.getByRole("link", { name: "Back to notes", exact: true }).click();
    }
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("region", { name: "Your Notes", exact: true }).getByRole("link")).toHaveCount(0);
    await capture(page, testInfo, "failed-creation-keeps-list-intact");
  });
}
