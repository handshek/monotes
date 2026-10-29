import { describe, expect, it } from "vitest";
import { z } from "zod";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { MAX_CONNECTIONS_PER_USER, MAX_PENDING_PAIRINGS } from "../../convex/lib/agentAuth";
import { agentFetch, createAgent, enableNote, setup, signIn, type Backend, type Owner } from "./backend-helpers";

const NOTE = "Pair000001";
const OTHER_NOTE = "Pair000002";
const SITE = "http://localhost:3000";

const errorBody = z.object({ error: z.object({ code: z.string() }) });

async function startPairing(
  owner: Owner,
  options: { noteId?: string; access?: "read" | "edit"; name?: string; replaces?: Id<"agentPairings"> } = {},
) {
  return owner.action(api.pairing.start, {
    noteId: options.noteId ?? NOTE,
    name: options.name ?? "Codex",
    access: options.access ?? "edit",
    siteOrigin: SITE,
    replaces: options.replaces,
  });
}

async function created(owner: Owner, options: Parameters<typeof startPairing>[1] = {}) {
  const result = await startPairing(owner, options);
  if (result.status !== "created") throw new Error(`pairing not created: ${result.status}`);
  return result;
}

async function redeem(t: Backend, code: string) {
  const response = await t.fetch("/agent/v1/pair", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  return { status: response.status, text: await response.text(), type: response.headers.get("Content-Type") };
}

function parseAccessFile(text: string) {
  const values = new Map(
    text
      .split("\n")
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)] as const),
  );
  return {
    url: values.get("MONOTES_URL"),
    key: values.get("MONOTES_AGENT_KEY") ?? "",
    file: values.get("MONOTES_CREDENTIAL_FILE"),
    firstNote: values.get("MONOTES_FIRST_NOTE_URL"),
  };
}

async function sharedNote() {
  const t = setup();
  const { userId, as: owner } = await signIn(t);
  await enableNote(owner, NOTE, "# Release plan\n");
  await enableNote(owner, OTHER_NOTE, "# Other\n");
  return { t, userId, owner };
}

async function pairingState(owner: Owner, pairingId: Id<"agentPairings">) {
  return (await owner.query(api.pairing.status, { pairingId }))?.state;
}

describe("pairing an agent", () => {
  it("creates one connection with exactly the chosen access to this note, connected only after a real read", async () => {
    const { t, owner } = await sharedNote();
    const pairing = await created(owner, { access: "read", name: "Claude Code" });
    expect(pairing.code).toMatch(/^mnp_[A-Za-z0-9_-]{27}$/);
    expect(await pairingState(owner, pairing.pairingId)).toBe("waiting");

    const response = await redeem(t, pairing.code);
    expect(response.status).toBe(200);
    expect(response.type).toContain("text/plain");
    const file = parseAccessFile(response.text);
    expect(file).toMatchObject({ url: SITE, firstNote: `${SITE}/${NOTE}` });
    expect(file.key).toMatch(/^mna_/);
    expect(file.file).toMatch(/^localhost-3000-[a-z0-9]+\.env$/);
    expect(await pairingState(owner, pairing.pairingId)).toBe("accepted");

    // Nothing stored server-side holds the key or the code.
    const stored = JSON.stringify(await t.run(async (ctx) => [
      await ctx.db.query("agentPairings").collect(),
      await ctx.db.query("agentConnections").collect(),
    ]));
    expect(stored).not.toContain(file.key);
    expect(stored).not.toContain(pairing.code);

    const call = agentFetch(t, file.key);
    expect((await call(`notes/${OTHER_NOTE}`)).status).toBe(404);
    expect(await pairingState(owner, pairing.pairingId)).toBe("accepted");
    const read = await call(`notes/${NOTE}`);
    expect(read.status).toBe(200);
    expect(await pairingState(owner, pairing.pairingId)).toBe("connected");

    const note = z.object({ note: z.object({ version: z.string() }) }).parse(read.json);
    const edit = await call(`notes/${NOTE}`, {
      method: "PATCH",
      body: { version: note.note.version, requestId: "req-pair-read-1", edits: [{ type: "append", text: "x" }] },
    });
    expect(edit.status).toBe(403);

    const grants = await owner.query(api.agents.noteGrants, { noteId: NOTE });
    expect(grants).toEqual([
      expect.objectContaining({ name: "Claude Code", access: "read", state: "connected", kind: "paired", credentialFile: file.file }),
    ]);
    expect(grants?.[0].readThisNoteAt).toEqual(expect.any(Number));
  });

  it("works once: a used code returns nothing again", async () => {
    const { t, owner } = await sharedNote();
    const pairing = await created(owner);
    expect((await redeem(t, pairing.code)).status).toBe(200);
    const again = await redeem(t, pairing.code);
    expect(again.status).toBe(404);
    expect(again.text).not.toContain("mna_");
    expect(errorBody.parse(JSON.parse(again.text)).error.code).toBe("invalid_code");
  });

  it("refuses expired and cancelled codes", async () => {
    const { t, owner } = await sharedNote();
    const expiring = await created(owner);
    await t.run(async (ctx) => ctx.db.patch(expiring.pairingId, { expiresAt: Date.now() - 1 }));
    expect(await pairingState(owner, expiring.pairingId)).toBe("expired");
    expect((await redeem(t, expiring.code)).status).toBe(404);

    const cancelled = await created(owner);
    expect(await owner.mutation(api.pairing.cancel, { pairingId: cancelled.pairingId })).toEqual({ status: "cancelled" });
    expect(await pairingState(owner, cancelled.pairingId)).toBe("cancelled");
    expect((await redeem(t, cancelled.code)).status).toBe(404);
  });

  it("on New code after a lost response, removes only the connection that code made", async () => {
    const { t, owner } = await sharedNote();
    // An agent connected earlier, which must not be touched.
    const earlier = await created(owner, { name: "Earlier agent" });
    const earlierKey = parseAccessFile((await redeem(t, earlier.code)).text).key;
    expect((await agentFetch(t, earlierKey)(`notes/${NOTE}`)).status).toBe(200);

    const lost = await created(owner);
    const lostKey = parseAccessFile((await redeem(t, lost.code)).text).key;
    const replacement = await created(owner, { replaces: lost.pairingId });
    expect(await pairingState(owner, lost.pairingId)).toBe("cancelled");
    expect((await agentFetch(t, lostKey)("me")).status).toBe(401);
    expect(await pairingState(owner, replacement.pairingId)).toBe("waiting");
    expect((await agentFetch(t, earlierKey)(`notes/${NOTE}`)).status).toBe(200);
    const names = (await owner.query(api.agents.noteGrants, { noteId: NOTE }))?.map((grant) => grant.name);
    expect(names).toEqual(["Earlier agent"]);
  });

  it("leaves a connected agent alone when its pairing is cancelled", async () => {
    const { t, owner } = await sharedNote();
    const pairing = await created(owner);
    const key = parseAccessFile((await redeem(t, pairing.code)).text).key;
    await agentFetch(t, key)(`notes/${NOTE}`);
    expect(await owner.mutation(api.pairing.cancel, { pairingId: pairing.pairingId })).toEqual({ status: "already_connected" });
    expect((await agentFetch(t, key)(`notes/${NOTE}`)).status).toBe(200);
  });

  it("can't be redeemed once the note is deleted, and a removed grant blocks the first read", async () => {
    const { t, owner } = await sharedNote();
    const pairing = await created(owner);
    await owner.mutation(api.collab.deleteCloudNote, { noteId: NOTE });
    expect((await redeem(t, pairing.code)).status).toBe(410);

    const other = await created(owner, { noteId: OTHER_NOTE });
    const response = parseAccessFile((await redeem(t, other.code)).text);
    const [grant] = (await owner.query(api.agents.noteGrants, { noteId: OTHER_NOTE })) ?? [];
    await owner.mutation(api.agents.setGrant, { noteId: OTHER_NOTE, connectionId: grant.id, access: "none" });
    expect((await agentFetch(t, response.key)(`notes/${OTHER_NOTE}`)).status).toBe(404);
    expect(await pairingState(owner, other.pairingId)).toBe("access_removed");
  });

  it("stops reporting a connected agent once its access or the note is gone", async () => {
    const { t, owner } = await sharedNote();
    const first = await created(owner);
    const key = parseAccessFile((await redeem(t, first.code)).text).key;
    await agentFetch(t, key)(`notes/${NOTE}`);
    expect(await pairingState(owner, first.pairingId)).toBe("connected");
    const [grant] = (await owner.query(api.agents.noteGrants, { noteId: NOTE })) ?? [];
    await owner.mutation(api.agents.setGrant, { noteId: NOTE, connectionId: grant.id, access: "none" });
    expect(await owner.query(api.pairing.status, { pairingId: first.pairingId })).toMatchObject({
      state: "access_removed",
      connectionId: null,
    });

    const second = await created(owner, { noteId: OTHER_NOTE });
    await agentFetch(t, parseAccessFile((await redeem(t, second.code)).text).key)(`notes/${OTHER_NOTE}`);
    await owner.mutation(api.collab.deleteCloudNote, { noteId: OTHER_NOTE });
    expect(await pairingState(owner, second.pairingId)).toBe("access_removed");
  });

  it("keeps the original agent and access when a code is replaced", async () => {
    const { t, owner } = await sharedNote();
    const first = await created(owner, { name: "Claude Code", access: "read" });
    const replacement = await owner.action(api.pairing.start, {
      noteId: NOTE,
      name: "Codex",
      access: "edit",
      siteOrigin: SITE,
      replaces: first.pairingId,
    });
    if (replacement.status !== "created") throw new Error(replacement.status);
    expect(await owner.query(api.pairing.status, { pairingId: replacement.pairingId })).toMatchObject({
      name: "Claude Code",
      access: "read",
    });
    const key = parseAccessFile((await redeem(t, replacement.code)).text).key;
    const read = z.object({ note: z.object({ version: z.string(), access: z.string() }) }).parse((await agentFetch(t, key)(`notes/${NOTE}`)).json);
    expect(read.note.access).toBe("read");
    const edit = await agentFetch(t, key)(`notes/${NOTE}`, {
      method: "PATCH",
      body: { version: read.note.version, requestId: "req-replaced-01", edits: [{ type: "append", text: "x" }] },
    });
    expect(edit.status).toBe(403);
  });

  it("never gives a new code more access than the person currently allows", async () => {
    const { t, owner } = await sharedNote();
    const other = await created(owner, { name: "Other agent", access: "edit" });
    const otherKey = parseAccessFile((await redeem(t, other.code)).text).key;
    await agentFetch(t, otherKey)(`notes/${NOTE}`);

    const first = await created(owner, { name: "Codex", access: "edit" });
    await redeem(t, first.code);
    const codex = (await owner.query(api.agents.noteGrants, { noteId: NOTE }))?.find((item) => item.name === "Codex");
    await owner.mutation(api.agents.setGrant, { noteId: NOTE, connectionId: codex!.id, access: "read" });
    // The form still says "edit"; the replacement follows the narrowed grant.
    const replacement = await owner.action(api.pairing.start, {
      noteId: NOTE, name: "Codex", access: "edit", siteOrigin: SITE, replaces: first.pairingId,
    });
    if (replacement.status !== "created") throw new Error(replacement.status);
    const key = parseAccessFile((await redeem(t, replacement.code)).text).key;
    const read = z.object({ note: z.object({ version: z.string(), access: z.string() }) }).parse((await agentFetch(t, key)(`notes/${NOTE}`)).json);
    expect(read.note.access).toBe("read");
    const edit = await agentFetch(t, key)(`notes/${NOTE}`, {
      method: "PATCH",
      body: { version: read.note.version, requestId: "req-narrowed-1", edits: [{ type: "append", text: "x" }] },
    });
    expect(edit.status).toBe(403);
    const otherAgent = (await owner.query(api.agents.noteGrants, { noteId: NOTE }))?.find((item) => item.name === "Other agent");
    expect(otherAgent).toMatchObject({ access: "edit", state: "connected" });
  });

  it("doesn't recreate access the person removed before starting over", async () => {
    const { t, owner } = await sharedNote();
    const first = await created(owner);
    const key = parseAccessFile((await redeem(t, first.code)).text).key;
    const [grant] = (await owner.query(api.agents.noteGrants, { noteId: NOTE })) ?? [];
    await owner.mutation(api.agents.setGrant, { noteId: NOTE, connectionId: grant.id, access: "none" });
    expect((await startPairing(owner, { replaces: first.pairingId })).status).toBe("access_removed");
    expect(await pairingState(owner, first.pairingId)).toBe("cancelled");
    expect((await agentFetch(t, key)("me")).status).toBe(401);
    const pending = await t.run((ctx) => ctx.db.query("agentPairings").filter((q) => q.eq(q.field("status"), "pending")).collect());
    expect(pending).toHaveLength(0);
  });

  it("leaves an agent that works through another note connected when its setup is cancelled or replaced", async () => {
    const { t, owner } = await sharedNote();
    const pairing = await created(owner);
    const key = parseAccessFile((await redeem(t, pairing.code)).text).key;
    const [grant] = (await owner.query(api.agents.noteGrants, { noteId: NOTE })) ?? [];
    await owner.mutation(api.agents.setGrant, { noteId: OTHER_NOTE, connectionId: grant.id, access: "read" });
    expect((await agentFetch(t, key)(`notes/${OTHER_NOTE}`)).status).toBe(200);

    // It works, but hasn't read the note this setup was for.
    expect(await owner.query(api.pairing.status, { pairingId: pairing.pairingId })).toMatchObject({
      state: "accepted",
      connectionVerified: true,
    });
    expect(await owner.mutation(api.pairing.cancel, { pairingId: pairing.pairingId })).toEqual({ status: "already_connected" });
    expect(await startPairing(owner, { replaces: pairing.pairingId })).toEqual({
      status: "already_connected",
      pairingId: pairing.pairingId,
    });
    expect((await agentFetch(t, key)(`notes/${OTHER_NOTE}`)).status).toBe(200);
    expect((await agentFetch(t, key)(`notes/${NOTE}`)).status).toBe(200);
    expect(await pairingState(owner, pairing.pairingId)).toBe("connected");
  });

  it("replaces only a setup for the same note, and keeps a connection that won the race", async () => {
    const { t, owner } = await sharedNote();
    const elsewhere = await created(owner, { noteId: OTHER_NOTE });
    expect((await startPairing(owner, { replaces: elsewhere.pairingId })).status).toBe("invalid_replace");
    expect(await pairingState(owner, elsewhere.pairingId)).toBe("waiting");

    const raced = await created(owner);
    const key = parseAccessFile((await redeem(t, raced.code)).text).key;
    await agentFetch(t, key)(`notes/${NOTE}`);
    expect(await startPairing(owner, { replaces: raced.pairingId })).toEqual({
      status: "already_connected",
      pairingId: raced.pairingId,
    });
    expect((await agentFetch(t, key)(`notes/${NOTE}`)).status).toBe(200);
    const pairings = await t.run((ctx) => ctx.db.query("agentPairings").collect());
    expect(pairings).toHaveLength(2);
  });

  it("keeps each owner's pairings and notes to themselves", async () => {
    const { t, owner } = await sharedNote();
    const { as: stranger } = await signIn(t, "Stranger");
    expect((await startPairing(stranger)).status).toBe("not_connected");
    const pairing = await created(owner);
    expect(await stranger.query(api.pairing.status, { pairingId: pairing.pairingId })).toBeNull();
    expect(await stranger.mutation(api.pairing.cancel, { pairingId: pairing.pairingId })).toEqual({ status: "missing" });
    expect(await pairingState(owner, pairing.pairingId)).toBe("waiting");
  });

  it("limits waiting codes, codes per hour and connections per account", async () => {
    const { t, userId, owner } = await sharedNote();
    for (let i = 0; i < MAX_PENDING_PAIRINGS; i++) await created(owner);
    expect((await startPairing(owner)).status).toBe("too_many_pending");

    await t.run(async (ctx) => {
      for (const pairing of await ctx.db.query("agentPairings").collect()) await ctx.db.patch(pairing._id, { status: "cancelled" });
    });
    for (let i = 0; i < 25; i++) {
      const pairing = await created(owner);
      await owner.mutation(api.pairing.cancel, { pairingId: pairing.pairingId });
    }
    expect((await startPairing(owner)).status).toBe("rate_limited");

    await t.run(async (ctx) => {
      for (const pairing of await ctx.db.query("agentPairings").collect()) await ctx.db.patch(pairing._id, { createdAt: 0 });
    });
    const waiting = await created(owner);
    await t.run(async (ctx) => {
      for (let i = 0; i < MAX_CONNECTIONS_PER_USER; i++) {
        await ctx.db.insert("agentConnections", { userId, name: `agent ${i}`, tokenHash: `hash${i}`, tokenPrefix: "mna_x…", createdAt: 0 });
      }
    });
    const full = await redeem(t, waiting.code);
    expect(full.status).toBe(409);
    expect(await pairingState(owner, waiting.pairingId)).toBe("waiting");
    expect((await startPairing(owner)).status).toBe("too_many_connections");
  });

  it("counts active connections correctly after many revoked ones", async () => {
    const { t, userId, owner } = await sharedNote();
    const insertConnections = (count: number, revoked: boolean, prefix: string) =>
      t.run(async (ctx) => {
        for (let i = 0; i < count; i++) {
          await ctx.db.insert("agentConnections", {
            userId, name: `${prefix} ${i}`, tokenHash: `${prefix}${i}`, tokenPrefix: "mna_x…", createdAt: i,
            ...(revoked ? { revokedAt: 1 } : {}),
          });
        }
      });
    await insertConnections(200, true, "old");
    await insertConnections(MAX_CONNECTIONS_PER_USER - 1, false, "live");
    const lastSlot = await created(owner);
    await insertConnections(1, false, "extra");
    expect((await startPairing(owner)).status).toBe("too_many_connections");
    expect((await redeem(t, lastSlot.code)).status).toBe(409);
  });

  it("counts only unexpired waiting codes, however many expired ones came first", async () => {
    const { t, userId, owner } = await sharedNote();
    const note = await t.run(async (ctx) => (await ctx.db.query("notes").first())!._id);
    await t.run(async (ctx) => {
      for (let i = 0; i < 20; i++) {
        await ctx.db.insert("agentPairings", {
          userId, note, noteId: NOTE, epoch: "e", access: "edit", name: "old", siteOrigin: SITE,
          codeHash: `expired${i}`, createdAt: 0, expiresAt: 1, status: "pending",
        });
      }
    });
    for (let i = 0; i < MAX_PENDING_PAIRINGS - 1; i++) await created(owner);
    await created(owner);
    expect((await startPairing(owner)).status).toBe("too_many_pending");
  });

  it("refuses a non-canonical or unsafe site, malformed codes and oversized bodies", async () => {
    const { t, owner } = await sharedNote();
    for (const siteOrigin of ["http://evil.example", "https://a.example/path", "https://user@a.example", "https://a.example:99999"]) {
      expect((await owner.action(api.pairing.start, { noteId: NOTE, name: "Codex", access: "edit", siteOrigin })).status).toBe("invalid_site");
    }
    expect((await redeem(t, "mnp_short")).status).toBe(400);
    const big = await t.fetch("/agent/v1/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "x".repeat(4000) }),
    });
    expect(big.status).toBe(413);
    expect((await t.fetch("/agent/v1/pair", { method: "GET" })).status).toBe(405);
  });

  it("describes manual keys honestly: unused, then used once they make a request", async () => {
    const { t, owner } = await sharedNote();
    const manual = await createAgent(owner, "Manual key");
    const state = async () => (await owner.query(api.agents.noteGrants, { noteId: NOTE }))?.find((item) => item.name === "Manual key");
    expect(await state()).toMatchObject({ state: "unused", kind: "manual", credentialFile: null });
    await agentFetch(t, manual.token)("me");
    expect(await state()).toMatchObject({ state: "used" });
    await owner.mutation(api.agents.setGrant, { noteId: NOTE, connectionId: manual.connectionId, access: "read" });
    await agentFetch(t, manual.token)(`notes/${NOTE}`);
    expect(await state()).toMatchObject({ state: "connected", access: "read" });
  });
});
