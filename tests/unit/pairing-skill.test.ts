// @vitest-environment node
/*
 * Runs the exact "Connect with a pairing code" command from the served skill
 * against a throwaway local server, using MONOTES_CONFIG_DIR for a temporary
 * folder, and checks what an agent would end up with on disk and on screen.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { credentialFileContents, credentialFileName } from "../../convex/lib/agentAuth";

const SKILL = path.join(__dirname, "../../public/agent-skill/SKILL.md");
const KEY = "mna_" + "K".repeat(43);
const FILE = "127.0.0.1-test-abc123.env";

/* The first shell block after a heading in the served skill. */
async function skillCommand(heading: string) {
  const skill = await readFile(SKILL, "utf8");
  const section = skill.slice(skill.indexOf(heading));
  const match = /```sh\n([\s\S]*?)```/.exec(section);
  if (!match) throw new Error(`no command after ${heading}`);
  return match[1].replace(/^ {3}/gm, "");
}

/* The skill's quoting rule: single-quote the value, writing each apostrophe as '"'"'. */
function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/* Fill the connect command's placeholders, replacing each whole quoted placeholder. */
async function connectCommand(site: string, code: string) {
  const command = await skillCommand("## Connect with a pairing code");
  return command.replace("'ORIGIN'", shellQuote(site)).replace("'CODE'", shellQuote(code));
}

type Reply = { status: number; body: string; headers?: Record<string, string> };
type Seen = { method?: string; url?: string; authorization?: string };

let server: Server;
let origin = "";
let reply: Reply;
let dir = "";
let seen: Seen[] = [];

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "monotes-skill-"));
  seen = [];
  server = createServer((request, response) => {
    let body = "";
    seen.push({ method: request.method, url: request.url, authorization: request.headers.authorization });
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      if (request.method === "GET") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end('{"note":{"id":"Note000001","content":"hello"}}');
        return;
      }
      const ok = request.method === "POST" && request.url === "/api/agent/v1/pair" && body.includes('"code":"mnp_');
      const answer = ok ? reply : { status: 400, body: '{"error":{"code":"bad","message":"bad request"}}' };
      response.writeHead(answer.status, { "Content-Type": "text/plain", ...answer.headers });
      response.end(answer.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  origin = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
});

async function run(code = "mnp_" + "A".repeat(27), site = origin) {
  return runShell(await connectCommand(site, code));
}

function runShell(command: string) {
  return new Promise<{ output: string; exitCode: number }>((resolve) => {
    execFile(
      "bash",
      ["-c", command],
      { env: { ...process.env, MONOTES_CONFIG_DIR: path.join(dir, "monotes") } },
      (error, stdout, stderr) => resolve({ output: `${stdout}${stderr}`, exitCode: typeof error?.code === "number" ? error.code : 0 }),
    );
  });
}

function accessFile(name = FILE) {
  return [
    "# Monotes agent access.",
    `MONOTES_URL=${origin}`,
    `MONOTES_AGENT_KEY=${KEY}`,
    `MONOTES_CREDENTIAL_FILE=${name}`,
    `MONOTES_FIRST_NOTE_URL=${origin}/Note000001`,
    "",
  ].join("\n");
}

describe("the skill's connect command", () => {
  it("saves the access file privately and never prints the key", async () => {
    reply = { status: 200, body: accessFile() };
    const { output } = await run();
    const saved = path.join(dir, "monotes", FILE);
    expect(output).toContain(`Saved Monotes access as ${saved}`);
    expect(output).not.toContain(KEY);
    expect(await readFile(saved, "utf8")).toBe(accessFile());
    expect((await stat(saved)).mode & 0o777).toBe(0o600);
    expect((await stat(path.join(dir, "monotes"))).mode & 0o777).toBe(0o700);
    expect(await readdir(path.join(dir, "monotes"))).toEqual([FILE]);
  });

  it("saves nothing when pairing fails, and shows only the error message", async () => {
    reply = { status: 404, body: '{"error":{"code":"invalid_code","message":"This code was already used, cancelled or expired."}}' };
    const { output } = await run();
    expect(output).toContain("Monotes pairing failed (HTTP 404)");
    expect(output).toContain("already used, cancelled or expired");
    expect(await readdir(path.join(dir, "monotes"))).toEqual([]);
  });

  it("never replaces an existing access file", async () => {
    reply = { status: 200, body: accessFile() };
    await run();
    const saved = path.join(dir, "monotes", FILE);
    await writeFile(saved, "existing working access\n", { mode: 0o600 });
    const { output } = await run();
    expect(output).toContain("Monotes pairing failed");
    expect(output).not.toContain(KEY);
    expect(await readFile(saved, "utf8")).toBe("existing working access\n");
    expect(await readdir(path.join(dir, "monotes"))).toEqual([FILE]);
  });

  it("refuses a response without a valid key or file name", async () => {
    reply = { status: 200, body: accessFile("../escape.env") };
    const { output } = await run();
    expect(output).toContain("Monotes pairing failed (HTTP 200)");
    expect(output).not.toContain(KEY);
    expect(await readdir(path.join(dir, "monotes"))).toEqual([]);
  });

  it("doesn't follow a redirect", async () => {
    reply = { status: 302, body: "", headers: { Location: "https://elsewhere.example/steal" } };
    const { output } = await run();
    expect(output).toContain("Monotes pairing failed (HTTP 302)");
    expect(await readdir(path.join(dir, "monotes"))).toEqual([]);
  });
});

/* The server's own file names and contents pass the skill's strict check, IPv6 loopback included. */
describe("server-generated access files", () => {
  it.each(["http://localhost:3000", "http://127.0.0.1:3108", "http://[::1]:3000", "https://monotes.example"])(
    "names a file the skill accepts for %s",
    (site) => {
      const name = credentialFileName(site, "j57105ame4yschevhp3wng4xrs8gr6nc");
      expect(name).toMatch(/^[a-z0-9][a-z0-9.-]*\.env$/);
      expect(name).not.toContain("..");
    },
  );

  it("saves the real response for an IPv6 loopback address", async () => {
    const ipv6 = createServer((request, response) => {
      request.resume();
      request.on("end", () => {
        response.writeHead(200, { "Content-Type": "text/plain" });
        response.end(ipv6Body);
      });
    });
    let ipv6Body = "";
    try {
      await new Promise<void>((resolve, reject) => {
        ipv6.once("error", reject);
        ipv6.listen(0, "::1", resolve);
      });
    } catch {
      return; // No IPv6 loopback on this machine.
    }
    try {
      const address = ipv6.address();
      if (!address || typeof address === "string") throw new Error("no port");
      const site = `http://[::1]:${address.port}`;
      const fileName = credentialFileName(site, "j57105ame4yschevhp3wng4xrs8gr6nc");
      ipv6Body = credentialFileContents({ siteOrigin: site, token: KEY, fileName, noteId: "Note000001" });
      const { output } = await runShell(await connectCommand(site, "mnp_" + "A".repeat(27)));
      expect(output).toContain(`Saved Monotes access as ${path.join(dir, "monotes", fileName)}`);
      expect(await readdir(path.join(dir, "monotes"))).toEqual([fileName]);
    } finally {
      await new Promise((resolve) => ipv6.close(resolve));
    }
  });
});

/* Pasted values that try to break out of the command. Nothing runs, nothing is sent, nothing is saved. */
describe("the skill's connect command with a malformed address or code", () => {
  const sentinel = () => path.join(dir, "SENTINEL");
  const valid = "mnp_" + "A".repeat(27);
  const cases: [string, () => { site: string; code: string }][] = [
    ["an address with command substitution", () => ({ site: `$(touch ${sentinel()})`, code: valid })],
    ["an address with backticks", () => ({ site: `\`touch ${sentinel()}\``, code: valid })],
    ["an address that tries to close its quotes", () => ({ site: `${origin}'; touch ${sentinel()}; echo '`, code: valid })],
    ["an address on two lines", () => ({ site: `${origin}\nhttps://elsewhere.example`, code: valid })],
    ["a code that tries to close its quotes", () => ({ site: origin, code: `mnp_x'; touch ${sentinel()}; echo '` })],
    ["a code with command substitution", () => ({ site: origin, code: `$(touch ${sentinel()})` })],
  ];
  it.each(cases)("refuses %s", async (_label, values) => {
    reply = { status: 200, body: accessFile() };
    const { site, code } = values();
    const { output } = await run(code, site);
    expect(output).toContain("doesn't look right");
    await expect(stat(sentinel())).rejects.toThrow();
    expect(seen).toEqual([]);
    expect(await readdir(dir)).toEqual([]);
  });
});

/* 200 responses that look almost right. None may be saved, and nothing in them may run. */
describe("the skill's connect command with a hostile response", () => {
  const sentinel = () => path.join(dir, "SENTINEL");
  const cases: [string, () => string][] = [
    ["an added shell line", () => accessFile() + `touch ${sentinel()}\n`],
    ["command substitution in a value", () => accessFile().replace(KEY, `mna_$(touch ${sentinel()})${"K".repeat(20)}`)],
    ["a different address", () => accessFile().replace(`MONOTES_URL=${origin}`, "MONOTES_URL=https://elsewhere.example")],
    ["a duplicated field", () => accessFile() + `MONOTES_URL=${origin}\n`],
    ["an invalid key", () => accessFile().replace(KEY, "mna_short")],
    ["a first note on another site", () => accessFile().replace(`MONOTES_FIRST_NOTE_URL=${origin}`, "MONOTES_FIRST_NOTE_URL=https://elsewhere.example")],
    ["a first note with a bad id", () => accessFile().replace("/Note000001", "/../../etc")],
  ];
  it.each(cases)("refuses %s", async (_label, body) => {
    reply = { status: 200, body: body() };
    const { output } = await run();
    expect(output).toContain("Monotes pairing failed (HTTP 200)");
    expect(output).not.toContain(KEY);
    expect(await readdir(path.join(dir, "monotes"))).toEqual([]);
    await expect(stat(sentinel())).rejects.toThrow();
  });
});

/* Later commands read the saved file as data and send the key only to its validated address. */
describe("the skill's later commands", () => {
  const readCommand = async (file: string) =>
    (await skillCommand("2. **Read it.**")).replace("~/.config/monotes/<file>", file).replace("<id>", "Note000001");

  async function savedFile(contents: string) {
    const file = path.join(dir, "access.env");
    await writeFile(file, contents, { mode: 0o600 });
    return file;
  }

  it("never runs anything in the file, and sends the key only to its address", async () => {
    const sentinel = path.join(dir, "SENTINEL");
    const file = await savedFile(`${accessFile()}touch ${sentinel}\nMONOTES_EXTRA=$(touch ${sentinel})\n`);
    const { output } = await runShell(await readCommand(file));
    expect(output).toContain('"content":"hello"');
    expect(output).not.toContain(KEY);
    await expect(stat(sentinel)).rejects.toThrow();
    expect(seen).toEqual([{ method: "GET", url: "/api/agent/v1/notes/Note000001", authorization: `Bearer ${KEY}` }]);
  });

  it.each([
    ["a duplicated address", () => accessFile() + `MONOTES_URL=${origin}\n`],
    ["a plain-HTTP address that isn't this computer", () => accessFile().replace(`MONOTES_URL=${origin}`, "MONOTES_URL=http://elsewhere.example")],
    ["a malformed key", () => accessFile().replace(KEY, "mna_$(id)")],
  ])("sends nothing when the file has %s", async (_label, contents) => {
    const { output } = await runShell(await readCommand(await savedFile(contents())));
    expect(output).toContain("This Monotes access file isn't valid");
    expect(seen).toEqual([]);
  });
});

