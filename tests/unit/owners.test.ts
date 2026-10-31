// @vitest-environment jsdom
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { beforeEach, describe, expect, it } from "vitest";
import { getDB, LOCAL_OWNER, type NoteContent } from "../../src/lib/local-db";
import { readCurrentOwner, setCurrentOwner } from "../../src/lib/current-owner";
import {
  bringLocalNotes,
  confirmSignIn,
  countLocalUserNotes,
  createNewNote,
  getNote,
  listOwnerNotes,
} from "../../src/lib/local-notes";
import { hydrateCloudNote, markConnected } from "../../src/lib/collab/store";

const A = "user_a";
const B = "user_b";
const note = (id: string, owner: string, extra: Partial<NoteContent> = {}): NoteContent => ({
  id,
  owner,
  content: `text of ${id}`,
  updatedAt: 1,
  cloudStatus: "local",
  ...extra,
});
const cloudHolding = (...ids: string[]) => ({ listNoteIds: async () => ids });

beforeEach(async () => {
  localStorage.clear();
  setCurrentOwner(LOCAL_OWNER);
  await getDB().delete();
  await getDB().open();
});

describe("separate spaces", () => {
  it("lists only the owner's notes, newest first", async () => {
    await getDB().notes.bulkPut([
      note("a1", A, { updatedAt: 1 }),
      note("a2", A, { updatedAt: 2 }),
      note("b1", B),
      note("l1", LOCAL_OWNER),
    ]);
    expect((await listOwnerNotes(A)).map((n) => n.id)).toEqual(["a2", "a1"]);
    expect((await listOwnerNotes(LOCAL_OWNER)).map((n) => n.id)).toEqual(["l1"]);
  });

  it("reads another owner's note as missing without deleting it", async () => {
    await getDB().notes.put(note("a1", A));
    expect(await getNote("a1")).toBeNull();
    setCurrentOwner(A);
    expect((await getNote("a1"))?.id).toBe("a1");
  });

  it("stamps the current owner at every creation site", async () => {
    setCurrentOwner(A);
    await createNewNote("n1");
    await hydrateCloudNote("n2", "cloud", 1);
    await markConnected("n3", "epoch", "server", 1);
    const rows = await getDB().notes.bulkGet(["n1", "n2", "n3"]);
    expect(rows.map((row) => row?.owner)).toEqual([A, A, A]);
  });

  it("owns a Local only note made while signed in", async () => {
    setCurrentOwner(A);
    const created = await createNewNote("n1");
    expect(created).toMatchObject({ owner: A, cloudStatus: "local" });
  });
});

describe("current owner", () => {
  it("defaults to the Local user", () => {
    expect(readCurrentOwner()).toBe(LOCAL_OWNER);
  });

  it("moves on a confirmed sign-in and stays until changed", async () => {
    await confirmSignIn(A, cloudHolding());
    expect(readCurrentOwner()).toBe(A);
    expect(localStorage.getItem("monotes-owner")).toBe(A);
  });

  it("still moves when the claim can't run", async () => {
    await confirmSignIn(A, { listNoteIds: () => Promise.reject(new Error("offline")) });
    expect(readCurrentOwner()).toBe(A);
  });
});

describe("upgrade", () => {
  async function upgradeFromV5(rows: Omit<NoteContent, "owner">[]) {
    await getDB().delete();
    getDB().close();
    const old = new Dexie("monotes-db");
    old.version(5).stores({
      notes: "id,updatedAt,cloudStatus",
      collabClients: "[noteId+clientId],noteId",
      recoveries: "++id,noteId",
      pendingUploads: "noteId",
    });
    await old.table("notes").bulkPut(rows);
    old.close();
    await getDB().open();
  }
  const v5 = (id: string, cloudStatus: NoteContent["cloudStatus"]) => ({ id, content: `text of ${id}`, updatedAt: 1, cloudStatus });

  it("gives every older note to the Local user", async () => {
    await upgradeFromV5([v5("kept", "local"), v5("synced", "synced")]);
    expect((await listOwnerNotes(LOCAL_OWNER)).map((n) => n.id).sort()).toEqual(["kept", "synced"]);
  });

  it("lets an account claim the notes it holds a cloud copy of", async () => {
    await upgradeFromV5([v5("mine", "synced"), v5("other", "synced"), v5("kept", "local")]);
    await confirmSignIn(A, cloudHolding("mine"));
    expect((await listOwnerNotes(A)).map((n) => n.id)).toEqual(["mine"]);
    expect((await listOwnerNotes(A))[0].unclaimed).toBeUndefined();
    expect((await listOwnerNotes(LOCAL_OWNER)).map((n) => n.id).sort()).toEqual(["kept", "other"]);
  });

  it("leaves other accounts' notes claimable", async () => {
    await upgradeFromV5([v5("theirs", "synced")]);
    await confirmSignIn(A, cloudHolding());
    await confirmSignIn(B, cloudHolding("theirs"));
    expect((await listOwnerNotes(B)).map((n) => n.id)).toEqual(["theirs"]);
  });

  it("never claims a note written by the Local user after the upgrade", async () => {
    await getDB().notes.put(note("new", LOCAL_OWNER));
    await confirmSignIn(A, cloudHolding("new"));
    expect(await listOwnerNotes(A)).toEqual([]);
  });

  it("loses nothing when an upgraded device is signed out", async () => {
    await upgradeFromV5([v5("mine", "synced")]);
    expect((await getNote("mine"))?.content).toBe("text of mine");
  });
});

describe("first sign-in offer", () => {
  it("brings notes in as Local only and uploads nothing", async () => {
    await getDB().notes.bulkPut([note("l1", LOCAL_OWNER), note("old", LOCAL_OWNER, { cloudStatus: "synced", unclaimed: true })]);
    await getDB().pendingUploads.put({ noteId: "old", clock: 1 });
    expect(await countLocalUserNotes()).toBe(2);
    expect(await bringLocalNotes(A)).toBe(2);
    const rows = await listOwnerNotes(A);
    expect(rows.map((n) => n.cloudStatus)).toEqual(["local", "local"]);
    expect(rows.every((n) => n.unclaimed === undefined)).toBe(true);
    expect(await getDB().pendingUploads.count()).toBe(0);
    expect(await countLocalUserNotes()).toBe(0);
  });

  it("leaves a connected note out of the offer", async () => {
    await getDB().notes.put(note("c1", LOCAL_OWNER, { collab: { epoch: "e" } }));
    expect(await countLocalUserNotes()).toBe(0);
    expect(await bringLocalNotes(A)).toBe(0);
  });
});
