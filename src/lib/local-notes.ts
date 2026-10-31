import Dexie from "dexie";
import { getDB, LOCAL_OWNER, type NoteContent, type RecoveryRecord } from "./local-db";
import { readCurrentOwner, setCurrentOwner } from "./current-owner";
import type { CloudVersion, NoteCloud } from "./note-cloud";
import { compareNoteRevisions, createDraft, type NoteDraft } from "./local-drafts";

/* A note in the current owner's space. Anyone else's reads as missing. */
export async function getNote(slug: string): Promise<NoteContent | null> {
  const note = await getDB().notes.get(slug);
  return note?.owner === readCurrentOwner() ? note : null;
}

export async function listOwnerNotes(owner: string): Promise<NoteContent[]> {
  return getDB().notes
    .where("[owner+updatedAt]")
    .between([owner, Dexie.minKey], [owner, Dexie.maxKey])
    .reverse()
    .toArray();
}

export async function saveNote(draft: NoteDraft): Promise<NoteContent | null> {
  const db = getDB();
  return db.transaction("rw", db.notes, db.recoveries, db.pendingUploads, async () => {
    const existing = await db.notes.get(draft.id);
    if (!existing || compareNoteRevisions(existing, draft) >= 0) {
      return existing ?? null;
    }
    if (existing.collab) {
      // A connected note only changes through collaboration updates. Keep
      // text typed in the old editor separately instead of dropping it.
      if (existing.content !== draft.content) {
        await db.recoveries.add({ noteId: draft.id, text: draft.content, reason: "older_window", createdAt: Date.now() });
      }
      return existing;
    }
    const { basePulls, ...text } = draft;
    const updated = { ...existing, ...text };
    // Cloud text arrived after this typing began, so the editor never showed it.
    if (basePulls !== undefined && basePulls !== (existing.pulls ?? 0) && existing.content !== draft.content) {
      await keepText(existing.id, existing.content, "cloud_version");
    }
    await db.notes.put(updated);
    if (updated.cloudStatus !== "local" && updated.content !== existing.content) {
      await db.pendingUploads.put({ noteId: updated.id, clock: draft.localRevision.clock });
    }
    return updated;
  });
}

export async function createNewNote(slug: string): Promise<NoteContent> {
  const empty: NoteContent = {
    id: slug,
    owner: readCurrentOwner(),
    content: "",
    updatedAt: 0,
    cloudStatus: "local",
  };
  const note = { ...empty, ...createDraft(empty, "") };
  await getDB().notes.add(note);
  return note;
}

const clockOf = (note: NoteContent) => note.localRevision?.clock ?? note.updatedAt;

/* Set text aside once, however many times the same conflict is seen. */
async function keepText(noteId: string, text: string, reason: RecoveryRecord["reason"]) {
  if (!text.trim()) return;
  const db = getDB();
  const kept = await db.recoveries.where("noteId").equals(noteId).filter((record) => record.text === text).count();
  if (!kept) await db.recoveries.add({ noteId, text, reason, createdAt: Date.now() });
}

/* Replace the row with cloud text. The clock moves as little as possible, so a draft already being typed still wins and keeps the cloud text aside. */
function withCloudText(note: NoteContent, cloud: CloudVersion): NoteContent {
  return {
    ...note,
    content: cloud.content,
    updatedAt: cloud.updatedAt,
    cloudRevision: cloud.revision,
    pulls: (note.pulls ?? 0) + 1,
    localRevision: { clock: clockOf(note) + 1, actor: "" },
  };
}

/* Record that the cloud accepted a note. Text typed meanwhile still needs sending. */
export async function recordUpload(uploaded: NoteContent, revision: number): Promise<void> {
  const db = getDB();
  await db.transaction("rw", db.notes, db.pendingUploads, async () => {
    const note = await db.notes.get(uploaded.id);
    if (!note) {
      await db.pendingUploads.delete(uploaded.id);
      return;
    }
    await db.notes.update(note.id, {
      cloudStatus: "synced",
      cloudRevision: Math.max(revision, note.cloudRevision ?? 0),
    });
    if (note.content === uploaded.content) await db.pendingUploads.delete(note.id);
    else await db.pendingUploads.put({ noteId: note.id, clock: clockOf(note) });
  });
}

/* Bring cloud text into a note with no unuploaded edits. */
export async function pullCloudText(noteId: string, cloud: CloudVersion): Promise<void> {
  const db = getDB();
  await db.transaction("rw", db.notes, db.pendingUploads, async () => {
    const note = await db.notes.get(noteId);
    if (!note || note.collab || note.cloudStatus === "local") return;
    if ((note.cloudRevision ?? -1) >= cloud.revision || (await db.pendingUploads.get(noteId))) return;
    await db.notes.put(note.content === cloud.content ? { ...note, cloudRevision: cloud.revision } : withCloudText(note, cloud));
  });
}

/*
 * The cloud holds text this device hasn't seen. The person's edits stay and
 * the cloud text is kept aside, then the edits upload from that revision. The
 * exception is first contact, when the two have no shared history: the newer
 * text wins and the other is kept aside.
 */
export async function resolveConflict(noteId: string, cloud: CloudVersion): Promise<void> {
  const db = getDB();
  await db.transaction("rw", db.notes, db.recoveries, db.pendingUploads, async () => {
    const note = await db.notes.get(noteId);
    if (!note || note.collab) return;
    if (note.content === cloud.content) {
      await db.notes.update(noteId, { cloudRevision: cloud.revision });
      await db.pendingUploads.delete(noteId);
      return;
    }
    if (note.cloudRevision === undefined && cloud.updatedAt > note.updatedAt) {
      await keepText(noteId, note.content, "before_cloud_version");
      await db.notes.put({ ...withCloudText(note, cloud), cloudStatus: "synced" });
      await db.pendingUploads.delete(noteId);
      return;
    }
    await keepText(noteId, cloud.content, "cloud_version");
    await db.notes.update(noteId, { cloudRevision: cloud.revision, cloudStatus: "synced" });
    await db.pendingUploads.put({ noteId, clock: clockOf(note) });
  });
}

/* The note was deleted from the cloud elsewhere. It lives on here, as Local only. */
export async function becomeLocalOnly(noteId: string): Promise<boolean> {
  const db = getDB();
  return db.transaction("rw", db.notes, db.pendingUploads, async () => {
    await db.pendingUploads.delete(noteId);
    const note = await db.notes.get(noteId);
    if (!note || note.collab || note.cloudStatus === "local") return false;
    const local: NoteContent = { ...note, cloudStatus: "local" };
    delete local.cloudRevision;
    await db.notes.put(local);
    return true;
  });
}

/*
 * An account claims the notes from before owners existed that it holds a
 * cloud copy of. The rest stay the Local user's, still claimable by whichever
 * account really wrote them.
 */
export async function claimNotes(account: string, cloudIds: string[]): Promise<void> {
  const db = getDB();
  const ids = new Set(cloudIds);
  await db.notes
    .where("[owner+updatedAt]")
    .between([LOCAL_OWNER, Dexie.minKey], [LOCAL_OWNER, Dexie.maxKey])
    .filter((note) => note.unclaimed === true && ids.has(note.id))
    .modify((note) => {
      note.owner = account;
      delete note.unclaimed;
    });
}

/* A confirmed sign-in: show that account, and claim its notes from before owners existed. */
export async function confirmSignIn(account: string, cloud: Pick<NoteCloud, "listNoteIds">) {
  if (readCurrentOwner() !== account) setCurrentOwner(account);
  try {
    await claimNotes(account, await cloud.listNoteIds());
  } catch {
    // Claimed on the next confirmed sign-in; the notes are safe meanwhile.
  }
}

const canBringIn = (note: NoteContent) => !note.collab;

export async function countLocalUserNotes(): Promise<number> {
  return (await listOwnerNotes(LOCAL_OWNER)).filter(canBringIn).length;
}

/*
 * Bring the Local user's notes into an account. They stay Local only, so
 * nothing is uploaded, including an old Synced note no signed-in account
 * claimed: its cloud copy, if any, is in someone else's account.
 */
export async function bringLocalNotes(account: string): Promise<number> {
  const db = getDB();
  return db.transaction("rw", db.notes, db.pendingUploads, async () => {
    const notes = (await listOwnerNotes(LOCAL_OWNER)).filter(canBringIn);
    for (const note of notes) {
      const brought: NoteContent = { ...note, owner: account, cloudStatus: "local" };
      delete brought.unclaimed;
      await db.notes.put(brought);
      await db.pendingUploads.delete(note.id);
    }
    return notes.length;
  });
}
