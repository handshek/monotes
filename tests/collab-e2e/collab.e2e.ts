import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { capture, createNote, editor, waitForStoredContent } from "../notes-helpers";

/*
 * Real-browser collaboration: the production app, editor and session code
 * against an isolated local Convex backend (see scripts/collab-e2e.sh).
 * The agent is played by plain HTTP requests to the Monotes agent API.
 */

const liveEditor = (page: Page) => page.locator('.cm-content[data-collab="true"]');
const sharingStatus = (page: Page) => page.getByRole("status", { name: "Sharing status" });

async function signIn(page: Page, label: string, email = `${label}-${Date.now()}@example.test`) {
  await page.goto("/signin");
  await page.getByLabel("Test email").fill(email);
  await page.getByRole("button", { name: "Test sign in" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: "Sign out" })).toBeAttached();
  return email;
}

/* Share the open note with agents and wait for the dialog to reopen in the live editor. */
async function allowAgents(page: Page) {
  await page.getByRole("button", { name: "Agent access", exact: true }).click();
  await page.getByRole("dialog", { name: "Agent access" }).getByRole("button", { name: "Allow agents on this note" }).click();
  await expect(liveEditor(page)).toBeVisible();
  const dialog = page.getByRole("dialog", { name: "Agent access" });
  await expect(dialog.getByRole("heading", { name: "Agent setup" })).toBeVisible();
  return dialog;
}

/* Connect the open note through the manual key path and grant access. Returns the key. */
async function shareWithAgent(page: Page, access: "edit" | "read" = "edit") {
  const dialog = await allowAgents(page);
  await dialog.getByText("Set up manually with a key instead").click();
  await dialog.getByRole("button", { name: "Create agent key" }).click();
  const token = (await dialog.getByLabel("Agent key").textContent())?.trim() ?? "";
  expect(token).toMatch(/^mna_/);
  await dialog.getByRole("button", { name: "I’ve saved the key" }).click();
  await dialog.getByRole("combobox", { name: "Access for Claude Code" }).selectOption(access);
  await expect(dialog.getByRole("combobox", { name: "Access for Claude Code" })).toHaveValue(access);
  await page.keyboard.press("Escape");
  await expect(sharingStatus(page)).toHaveText("Live");
  return token;
}

function agentApi(request: APIRequestContext, token: string) {
  const headers = { Authorization: `Bearer ${token}` };
  return {
    read: async (id: string) => {
      const response = await request.get(`/api/agent/v1/notes/${id}`, { headers });
      return { status: response.status(), json: await response.json() };
    },
    edit: async (id: string, body: unknown) => {
      const response = await request.patch(`/api/agent/v1/notes/${id}`, {
        headers: { ...headers, "Content-Type": "application/json" },
        data: body,
      });
      return { status: response.status(), json: await response.json() };
    },
  };
}

async function editorText(page: Page) {
  return page.evaluate(() => {
    const lines = Array.from(document.querySelectorAll('.cm-content[data-collab="true"] .cm-line'));
    return lines.map((line) => line.textContent ?? "").join("\n");
  });
}

const START = "# Release plan\n\n## Testing\nTBD\n\n## Notes\n";

test("a person types in Vim while their agent edits another section", async ({ page, request }, testInfo) => {
  await signIn(page, "vim");
  const id = await createNote(page);
  await editor(page).fill(START);
  await waitForStoredContent(page, id, START);
  const token = await shareWithAgent(page);
  const agent = agentApi(request, token);

  // The agent reads first; its edit lands only after the person has typed more.
  const before = await agent.read(id);
  expect(before.status).toBe(200);
  expect(before.json.note.content).toBe(START);

  await liveEditor(page).click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("G");
  await page.keyboard.press("i");
  const sentence = "Typed by a person while the agent works.";
  const typing = page.keyboard.type(sentence, { delay: 45 });
  const agentEdit = (async () => {
    await page.waitForTimeout(500);
    return agent.edit(id, {
      version: before.json.note.version,
      requestId: `vim-${Date.now()}`,
      edits: [{ type: "replace", old: "## Testing\nTBD", new: "## Testing\n- Parser unit tests" }],
    });
  })();
  const [, edited] = await Promise.all([typing, agentEdit]);
  expect(edited.status).toBe(200);

  await expect(liveEditor(page)).toContainText("- Parser unit tests");
  await expect(liveEditor(page)).toContainText(sentence);
  const mark = page.locator(".cm-agent-edit").first();
  await expect(mark).toHaveAttribute("title", "Edited by Claude Code");
  await expect(page.getByText("Claude Code edited this note")).toBeVisible();

  // Still in insert mode: these keys insert text instead of running commands.
  await page.keyboard.type(" ok");
  await expect(liveEditor(page)).toContainText(`${sentence} ok`);
  await expect(page.locator(".cm-fat-cursor")).toHaveCount(0);
  await capture(page, testInfo, "agent-edit-while-typing-in-vim");

  // Undo in normal mode takes back only the person's own typing; the agent's
  // section is not in this editor's history. Redo brings the typing back.
  await page.keyboard.press("Escape");
  for (let i = 0; i < 10 && (await editorText(page)).includes("Typed by a person"); i++) {
    await page.keyboard.press("u");
  }
  await expect.poll(() => editorText(page)).not.toContain("Typed by a person");
  await expect(liveEditor(page)).toContainText("## Testing- Parser unit tests");
  for (let i = 0; i < 10 && !(await editorText(page)).includes(`${sentence} ok`); i++) {
    await page.keyboard.press("Control+r");
  }
  await expect.poll(() => editorText(page)).toContain(`${sentence} ok`);
  await expect(liveEditor(page)).toContainText("- Parser unit tests");

  await expect(sharingStatus(page)).toHaveText("Live");
  const expected = "# Release plan\n\n## Testing\n- Parser unit tests\n\n## Notes\nTyped by a person while the agent works. ok";
  await expect.poll(() => editorText(page)).toBe(expected);
  await expect.poll(async () => (await agent.read(id)).json.note.content).toBe(expected);

  await page.reload();
  await expect(liveEditor(page)).toBeVisible();
  await expect.poll(() => editorText(page)).toBe(expected);
});

test("typing not yet confirmed by the server survives a reload exactly once", async ({ page, context, request }) => {
  await signIn(page, "reload");
  const id = await createNote(page);
  await editor(page).fill("Start\n");
  await waitForStoredContent(page, id, "Start\n");
  const token = await shareWithAgent(page);

  await context.setOffline(true);
  await liveEditor(page).click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("G");
  await page.keyboard.press("i");
  await page.keyboard.type("written offline", { delay: 20 });
  await expect(sharingStatus(page)).toHaveText("Offline · saved on this device");
  await expect
    .poll(() =>
      page.evaluate(
        (noteId) =>
          new Promise<number>((resolve, reject) => {
            const open = indexedDB.open("monotes-db");
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
              const db = open.result;
              const all = db.transaction("collabClients").objectStore("collabClients").getAll();
              all.onsuccess = () => {
                const rows = all.result.filter((row: { noteId: string }) => row.noteId === noteId);
                resolve(rows.reduce((total: number, row: { unconfirmed: unknown[] }) => total + row.unconfirmed.length, 0));
                db.close();
              };
            };
          }),
        id,
      ),
    )
    .toBeGreaterThan(0);

  await context.setOffline(false);
  await page.reload();
  await expect(liveEditor(page)).toBeVisible();
  await expect.poll(() => editorText(page)).toBe("Start\nwritten offline");
  await expect(sharingStatus(page)).toHaveText("Live");
  await expect.poll(async () => (await agentApi(request, token).read(id)).json.note.content).toBe("Start\nwritten offline");
});

test("a stale agent edit that overlaps newer typing is refused and access can be removed", async ({ page, request }) => {
  await signIn(page, "conflict");
  const id = await createNote(page);
  await editor(page).fill("alpha\nbeta\n");
  await waitForStoredContent(page, id, "alpha\nbeta\n");
  const token = await shareWithAgent(page);
  const agent = agentApi(request, token);
  const read = await agent.read(id);

  await liveEditor(page).click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("g");
  await page.keyboard.press("g");
  await page.keyboard.press("j");
  await page.keyboard.press("A");
  await page.keyboard.type(" by hand");
  await expect.poll(async () => (await agent.read(id)).json.note.content).toBe("alpha\nbeta by hand\n");

  const stale = await agent.edit(id, {
    version: read.json.note.version,
    requestId: `conflict-${Date.now()}`,
    edits: [{ type: "replace", old: "beta", new: "BETA" }],
  });
  expect(stale.status).toBe(409);
  expect(stale.json.error.code).toBe("conflict");
  await expect.poll(() => editorText(page)).toBe("alpha\nbeta by hand\n");

  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Agent access", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Agent access" });
  await dialog.getByRole("combobox", { name: "Access for Claude Code" }).selectOption("none");
  await expect.poll(async () => (await agent.read(id)).status).toBe(404);
});

test("two tabs and an agent converge on the same text", async ({ page, context, request }) => {
  await signIn(page, "tabs");
  const id = await createNote(page);
  await editor(page).fill("shared\n");
  await waitForStoredContent(page, id, "shared\n");
  const token = await shareWithAgent(page);
  const second = await context.newPage();
  await second.goto(`/${id}`);
  await expect(liveEditor(second)).toBeVisible();
  await expect(sharingStatus(second)).toHaveText("Live");

  for (const [tab, text] of [[page, "first tab"], [second, "second tab"]] as const) {
    await liveEditor(tab).click();
    await tab.keyboard.press("Escape");
    await tab.keyboard.press("G");
    await tab.keyboard.press("o");
    await tab.keyboard.type(text, { delay: 15 });
  }
  const agent = agentApi(request, token);
  const read = await agent.read(id);
  expect((await agent.edit(id, { version: read.json.note.version, requestId: `tabs-${Date.now()}`, edits: [{ type: "replace", old: "shared", new: "shared by all" }] })).status).toBe(200);

  await expect.poll(() => editorText(page)).toContain("shared by all");
  await expect.poll(async () => editorText(second)).toBe(await editorText(page));
  const final = await editorText(page);
  expect(final).toContain("first tab");
  expect(final).toContain("second tab");
  await expect.poll(async () => (await agent.read(id)).json.note.content).toBe(final);
});

test("a note shared on one device opens on another, and a failed local copy can be retried", async ({ page, browser, request }) => {
  const email = await signIn(page, "device");
  const id = await createNote(page);
  await editor(page).fill("From the first device\n");
  await waitForStoredContent(page, id, "From the first device\n");
  const token = await shareWithAgent(page);

  // A second device whose note writes fail until the test allows them.
  // The failure is installed before any app script runs on every page.
  const faulty = await browser.newContext();
  try {
    await faulty.addInitScript(() => {
      const failing = window as typeof window & { __failNoteWrites?: boolean };
      failing.__failNoteWrites = true;
      localStorage.setItem("monotes-welcome-dismissed", "true");
      for (const method of ["put", "add"] as const) {
        const original = IDBObjectStore.prototype[method];
        IDBObjectStore.prototype[method] = function (this: IDBObjectStore, ...args: Parameters<typeof original>) {
          if (failing.__failNoteWrites && this.name === "notes") throw new DOMException("Injected failure", "UnknownError");
          return original.apply(this, args);
        };
      }
    });
    const device = await faulty.newPage();
    await signIn(device, "device", email);
    await device.goto(`/${id}`);
    const alert = device.getByRole("alert").filter({ hasText: "couldn’t open this note from your cloud account" });
    await expect(alert).toBeVisible();
    // Nothing was written: no empty local note stands in for the shared one.
    const stored = await device.evaluate(
      (noteId) =>
        new Promise<unknown>((resolve, reject) => {
          const open = indexedDB.open("monotes-db");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const get = open.result.transaction("notes").objectStore("notes").get(noteId);
            get.onsuccess = () => resolve(get.result ?? null);
          };
        }),
      id,
    );
    expect(stored).toBeNull();
    await device.evaluate(() => {
      (window as typeof window & { __failNoteWrites?: boolean }).__failNoteWrites = false;
    });
    await alert.getByRole("button", { name: "Try again" }).click();
    await expect(liveEditor(device)).toBeVisible();
    await expect.poll(() => editorText(device)).toBe("From the first device\n");
    expect((await agentApi(request, token).read(id)).json.note.content).toBe("From the first device\n");
  } finally {
    await faulty.close();
  }
});

/* ---- One-time pairing, driven through the UI and the skill's own commands ---- */

const SKILL = path.join(__dirname, "../../public/agent-skill/SKILL.md");

/* The first shell block after a heading in the served skill. */
async function skillCommand(heading: string) {
  const skill = await readFile(SKILL, "utf8");
  const section = skill.slice(skill.indexOf(heading));
  const match = /```sh\n([\s\S]*?)```/.exec(section);
  if (!match) throw new Error(`no command after ${heading}`);
  return match[1];
}

function bash(command: string, configDir: string) {
  return new Promise<string>((resolve) => {
    execFile("bash", ["-c", command], { env: { ...process.env, MONOTES_CONFIG_DIR: configDir } }, (_error, stdout, stderr) =>
      resolve(`${stdout}${stderr}`),
    );
  });
}

async function setupMessageCode(dialog: Locator) {
  const message = (await dialog.getByLabel("Setup message").textContent()) ?? "";
  const code = /Pairing code: (mnp_[A-Za-z0-9_-]{27})/.exec(message)?.[1];
  if (!code) throw new Error("no pairing code in the setup message");
  return { message, code };
}

async function redeemCode(request: APIRequestContext, code: string) {
  const response = await request.post("/api/agent/v1/pair", { data: { code } });
  const text = await response.text();
  const key = /^MONOTES_AGENT_KEY=(mna_\S+)$/m.exec(text)?.[1] ?? "";
  return { status: response.status(), key };
}

test("connect an agent with one message: code accepted, read verified, then it edits", async ({ page, context, request, baseURL }, testInfo) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseURL });
  await signIn(page, "pair");
  const id = await createNote(page);
  await editor(page).fill(START);
  await waitForStoredContent(page, id, START);
  const dialog = await allowAgents(page);
  await expect(dialog.getByRole("button", { name: /Codex/ })).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByText("What may it do with")).toContainText("Release plan");
  await capture(page, testInfo, "pairing-choose");

  await dialog.getByRole("button", { name: "Create setup message" }).click();
  const { message, code } = await setupMessageCode(dialog);
  expect(message).toContain(`${baseURL}/${id}`);
  expect(message).toContain(`${baseURL}/agent-skill/SKILL.md`);
  await dialog.getByRole("button", { name: "Copy message" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(message);
  await expect(dialog.getByRole("status", { name: "Connection progress" })).toContainText("Waiting for Codex to use the code");
  await capture(page, testInfo, "pairing-waiting");

  // The agent runs the skill's connect command against the real app.
  const configDir = await mkdtemp(path.join(tmpdir(), "monotes-agent-"));
  try {
    // Fill the placeholders the way the skill says: single-quoted, apostrophes as '"'"'.
    const quote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;
    const connect = (await skillCommand("## Connect with a pairing code"))
      .replace("'ORIGIN'", quote(baseURL ?? ""))
      .replace("'CODE'", quote(code));
    const saved = await bash(connect, configDir);
    expect(saved).toContain("Saved Monotes access as");
    const [file] = await readdir(configDir);
    expect(file).toMatch(/^127\.0\.0\.1-3108-[a-z0-9]+\.env$/);
    expect((await stat(path.join(configDir, file))).mode & 0o777).toBe(0o600);
    const accessFile = await readFile(path.join(configDir, file), "utf8");
    expect(saved).not.toContain(/MONOTES_AGENT_KEY=(\S+)/.exec(accessFile)?.[1] ?? "never");
    await expect(dialog.getByRole("status", { name: "Connection progress" })).toContainText("Code accepted at");
    await expect(dialog.getByRole("status", { name: "Connection progress" })).toContainText("Waiting for Codex to read");

    // Its first read, with the skill's read command, is what makes it connected.
    const read = (await skillCommand("2. **Read it.**"))
      .replace("~/.config/monotes/<file>", path.join(configDir, file))
      .replace("<id>", id);
    expect(await bash(read, configDir)).toContain('"content":"# Release plan');
    await expect(dialog.getByText("✓ Codex is connected")).toBeVisible();
    await expect(dialog.getByText(/It can read and edit “Release plan”/)).toBeVisible();
    await capture(page, testInfo, "pairing-connected");

    await dialog.getByRole("region", { name: "Connect an agent" }).getByRole("button", { name: "Copy request" }).click();
    const request_ = await page.evaluate(() => navigator.clipboard.readText());
    expect(request_).toContain(`~/.config/monotes/${file}`);
    expect(request_).toContain(`${baseURL}/${id}`);
    expect(request_).not.toMatch(/mnp_|mna_/);

    const key = /MONOTES_AGENT_KEY=(\S+)/.exec(accessFile)?.[1] ?? "";
    const agent = agentApi(request, key);
    const current = await agent.read(id);
    const edit = await agent.edit(id, {
      version: current.json.note.version,
      requestId: `pair-edit-${Date.now()}`,
      edits: [{ type: "replace", old: "## Testing\nTBD", new: "## Testing\n- Written by the paired agent" }],
    });
    expect(edit.status).toBe(200);
    await expect(liveEditor(page)).toContainText("Written by the paired agent");
    // The code was used once and can't hand out access again.
    expect((await redeemCode(request, code)).status).toBe(404);
  } finally {
    await rm(configDir, { recursive: true, force: true });
  }
});

test("a resumed setup keeps its agent and access, and cancelling removes only its own connection", async ({ page, request }) => {
  await signIn(page, "resume");
  const id = await createNote(page);
  await editor(page).fill("# Plan\n");
  await waitForStoredContent(page, id, "# Plan\n");
  let dialog = await allowAgents(page);
  await dialog.getByRole("button", { name: /Claude Code/ }).click();
  await dialog.getByRole("radio", { name: /^Can read/ }).check();
  await dialog.getByRole("button", { name: "Create setup message" }).click();
  const first = await setupMessageCode(dialog);
  expect(first.message).toContain("so you can read it");

  await page.keyboard.press("Escape");
  await page.reload();
  await expect(liveEditor(page)).toBeVisible();
  await page.getByRole("button", { name: "Agent access", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Agent access" });
  await expect(dialog.getByText("Paste this into")).toContainText("Claude Code");
  await dialog.getByRole("button", { name: "New code" }).click();
  await expect.poll(async () => (await setupMessageCode(dialog)).code).not.toBe(first.code);
  const second = await setupMessageCode(dialog);
  expect(second.message).toContain("so you can read it");
  expect((await redeemCode(request, first.code)).status).toBe(404);

  const { status, key } = await redeemCode(request, second.code);
  expect(status).toBe(200);
  const agent = agentApi(request, key);
  const read = await agent.read(id);
  expect(read.json.note.access).toBe("read");
  const denied = await agent.edit(id, { version: read.json.note.version, requestId: `resume-${Date.now()}`, edits: [{ type: "append", text: "x" }] });
  expect(denied.status).toBe(403);
  const row = dialog.getByRole("list", { name: "Agents with access to this note" });
  await expect(row).toContainText("Claude Code");
  await expect(dialog.getByRole("combobox", { name: "Access for Claude Code" })).toHaveValue("read");

  // A second setup whose code was used but which never read the note can be cancelled outright.
  await dialog.getByRole("button", { name: "Done" }).click();
  await dialog.getByRole("button", { name: "Connect another agent" }).click();
  await dialog.getByRole("button", { name: /Codex/ }).click();
  await dialog.getByRole("button", { name: "Create setup message" }).click();
  const third = await setupMessageCode(dialog);
  const lost = await redeemCode(request, third.code);
  expect(lost.status).toBe(200);
  await expect(dialog.getByRole("status", { name: "Connection progress" })).toContainText("Code accepted at");
  await dialog.getByRole("button", { name: "Cancel setup" }).click();
  await expect(dialog.getByRole("button", { name: "Create setup message" })).toBeVisible();
  expect((await agentApi(request, lost.key).read(id)).status).toBe(401);
  expect((await agent.read(id)).status).toBe(200);
});

test("an agent that first reads another shared note can leave the setup without losing access", async ({ page, request }) => {
  await signIn(page, "elsewhere");
  const alpha = await createNote(page);
  await editor(page).fill("# Alpha\n");
  await waitForStoredContent(page, alpha, "# Alpha\n");
  let dialog = await allowAgents(page);
  await dialog.getByRole("button", { name: "Create setup message" }).click();
  const { code } = await setupMessageCode(dialog);
  const { status, key } = await redeemCode(request, code);
  expect(status).toBe(200);
  await page.keyboard.press("Escape");

  // Share a second note with the same agent, which reads that note first.
  const beta = await createNote(page);
  await editor(page).fill("# Beta\n");
  await waitForStoredContent(page, beta, "# Beta\n");
  await page.getByRole("button", { name: "Agent access", exact: true }).click();
  await page.getByRole("dialog", { name: "Agent access" }).getByRole("button", { name: "Allow agents on this note" }).click();
  await expect(liveEditor(page)).toBeVisible();
  dialog = page.getByRole("dialog", { name: "Agent access" });
  await dialog.getByRole("list", { name: "Your other agents" }).getByRole("combobox", { name: "Access for Codex" }).selectOption("read");
  await expect(dialog.getByRole("list", { name: "Agents with access to this note" })).toContainText("Codex");
  const agent = agentApi(request, key);
  expect((await agent.read(beta)).status).toBe(200);
  await page.keyboard.press("Escape");

  // Back on the first note, the setup says what is true and can be left.
  await page.goto(`/${alpha}`);
  await expect(liveEditor(page)).toBeVisible();
  await page.getByRole("button", { name: "Agent access", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Agent access" });
  await expect(dialog.getByText("Codex already works with Monotes")).toBeVisible();
  await expect(dialog.getByText("isn’t confirmed")).toBeVisible();
  await dialog.getByRole("region", { name: "Connect an agent" }).getByRole("button", { name: "Done" }).click();
  await expect(dialog.getByRole("button", { name: "Connect another agent" })).toBeVisible();

  await page.reload();
  await expect(liveEditor(page)).toBeVisible();
  await page.getByRole("button", { name: "Agent access", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Agent access" });
  await expect(dialog.getByRole("button", { name: "Connect another agent" })).toBeVisible();
  await expect(dialog.getByText("Connected · hasn’t read this note yet")).toBeVisible();
  expect((await agent.read(beta)).status).toBe(200);
  expect((await agent.read(alpha)).status).toBe(200);
});

test("the agent setup fits a phone screen", async ({ page }, testInfo) => {
  await signIn(page, "narrow");
  await page.setViewportSize({ width: 390, height: 844 });
  const id = await createNote(page);
  await editor(page).fill("# Phone note\n");
  await waitForStoredContent(page, id, "# Phone note\n");
  const dialog = await allowAgents(page);
  const noHorizontalOverflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  expect(await noHorizontalOverflow()).toBe(true);
  const create = dialog.getByRole("button", { name: "Create setup message" });
  await create.scrollIntoViewIfNeeded();
  await expect(create).toBeInViewport();
  await create.click();
  const copy = dialog.getByRole("button", { name: "Copy message" });
  await copy.scrollIntoViewIfNeeded();
  await expect(copy).toBeInViewport();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();
  expect(await noHorizontalOverflow()).toBe(true);
  const message = dialog.getByLabel("Setup message");
  expect(await message.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await capture(page, testInfo, "pairing-phone-waiting");
});

