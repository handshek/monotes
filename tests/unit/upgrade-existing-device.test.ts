// @vitest-environment jsdom
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { describe, expect, it } from "vitest";
import { getDB, LOCAL_OWNER } from "../../src/lib/local-db";
import { setCurrentOwner } from "../../src/lib/current-owner";
import { bringLocalNotes, confirmSignIn, countLocalUserNotes, resolveConflict } from "../../src/lib/local-notes";
import { api } from "../../convex/_generated/api";
import { setup, signIn } from "./backend-helpers";

/*
 * A device that used Monotes before owners and revisions existed opens the
 * new version. Its database is built here with the exact schema the app
 * shipped before (versions 1 to 4), with the rows that code could write.
 */
function openPreviousRelease() {
  const db = new Dexie("monotes-db");
  db.version(1).stores({ notes: "id,updatedAt,accessKey" });
  db.version(2).stores({ notes: "id,updatedAt,accessKey,cloudStatus" });
  db.version(3).stores({ notes: "id,updatedAt,cloudStatus" });
  db.version(4).stores({
    notes: "id,updatedAt,cloudStatus",
    collabClients: "[noteId+clientId],noteId",
    recoveries: "++id,noteId",
  });
  return db;
}

const A = "user_a";

describe("an existing device opens the new release", () => {
  it("keeps every note's text reachable, and keeps both texts when the cloud differs", async () => {
    localStorage.clear();
    setCurrentOwner(LOCAL_OWNER);
    const old = openPreviousRelease();
    await old.table("notes").bulkPut([
      // Synced, with edits newer than the cloud that never uploaded.
      { id: "newer_here", content: "edited here, never uploaded", updatedAt: 200, cloudStatus: "synced" },
      // Synced, while another device moved the cloud on.
      { id: "newer_there", content: "old text here", updatedAt: 100, cloudStatus: "synced" },
      { id: "ai", content: "ai text", updatedAt: 100, cloudStatus: "ai-enabled" },
      { id: "connected", content: "live text", updatedAt: 100, cloudStatus: "synced", collab: { epoch: "e1", version: 3, baseText: "live text", baseUpdatedAt: 100 } },
      // Synced here, but the account's cloud has no copy (deleted, or another account's).
      { id: "unbacked", content: "unbacked text", updatedAt: 100, cloudStatus: "synced" },
      { id: "plain", content: "local text", updatedAt: 100, cloudStatus: "local" },
    ]);
    const originals = new Map((await old.table("notes").toArray()).map((n) => [n.id, n.content]));

    // An old tab stays open while the new release opens in another.
    const db = getDB();
    await db.open();
    const oldWrite = await old
      .table("notes")
      // What the previous release's createNewNote writes.
      .add({ id: "from_old_tab", content: "", updatedAt: 0, cloudStatus: "local" })
      .then(() => "saved")
      .catch((error: Error) => `failed: ${error.name}`);
    expect(oldWrite).toBe("saved");
    expect((await db.notes.get("from_old_tab"))?.owner).toBeUndefined();

    // A confirmed sign-in; the account's cloud holds these notes.
    await confirmSignIn(A, { listNoteIds: async () => ["newer_here", "newer_there", "ai", "connected"] });
    const owners = Object.fromEntries((await db.notes.toArray()).map((n) => [n.id, n.owner]));
    // The old tab's note is adopted on sign-in, and claimed if the cloud has it.
    expect(owners).toMatchObject({ newer_here: A, newer_there: A, ai: A, connected: A, unbacked: LOCAL_OWNER, plain: LOCAL_OWNER, from_old_tab: LOCAL_OWNER });

    // First contact with legacy cloud rows (revision 0, from before revisions).
    await resolveConflict("newer_here", { content: "cloud text, older", updatedAt: 150, revision: 0 });
    await resolveConflict("newer_there", { content: "cloud text, newer", updatedAt: 150, revision: 0 });
    const notes = new Map((await db.notes.toArray()).map((n) => [n.id, n]));
    const kept = await db.recoveries.toArray();
    expect(notes.get("newer_here")?.content).toBe("edited here, never uploaded");
    expect(await db.pendingUploads.get("newer_here")).toBeTruthy();
    expect(kept).toContainEqual(expect.objectContaining({ noteId: "newer_here", text: "cloud text, older" }));
    expect(notes.get("newer_there")?.content).toBe("cloud text, newer");
    expect(kept).toContainEqual(expect.objectContaining({ noteId: "newer_there", text: "old text here" }));

    // The rest are reachable: the Local user's notes come in through the offer.
    expect(await countLocalUserNotes()).toBe(3);
    await bringLocalNotes(A);
    const all = [...(await db.notes.toArray()).map((n) => n.content), ...(await db.recoveries.toArray()).map((r) => r.text)];
    for (const [id, text] of originals) expect(all, id).toContain(text);
    expect((await db.notes.toArray()).every((n) => n.owner === A)).toBe(true);
  });
});

describe("a note without an owner", () => {
  it("joins the Local user the next time the database opens", async () => {
    const db = getDB();
    await db.open();
    await db.notes.put({ id: "orphan", content: "from an old tab", updatedAt: 1, cloudStatus: "local" } as never);
    db.close();
    await db.open();
    expect(await db.notes.get("orphan")).toMatchObject({ owner: LOCAL_OWNER, unclaimed: true });
  });
});

describe("the new upload against a cloud row from before revisions", () => {
  it("never overwrites it blind: first contact conflicts, then the upload lands on revision 0", async () => {
    const t = setup();
    const { userId, as } = await signIn(t);
    await t.run((ctx) => ctx.db.insert("notes", { userId, noteId: "n", content: "cloud text", updatedAt: 150 }));

    const first = await as.mutation(api.notes.uploadNote, { noteId: "n", content: "device text", updatedAt: 200, baseRevision: null });
    const second = await as.mutation(api.notes.uploadNote, { noteId: "n", content: "device text", updatedAt: 200, baseRevision: 0 });
    // A tab still running the previous release saves through the old mutation.
    await as.mutation(api.notes.syncNote, { noteId: "n", content: "old tab text", updatedAt: 250 });
    const row = await t.run((ctx) => ctx.db.query("notes").first());

    expect(first).toMatchObject({ status: "conflict", cloud: { content: "cloud text", revision: 0 } });
    expect(second).toEqual({ status: "ok", revision: 1 });
    expect(row?.revision).toBe(2);
  });
});
