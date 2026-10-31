import Dexie from "dexie";
import { getDB, LOCAL_OWNER, type NoteContent } from "./local-db";
import { readCurrentOwner, setCurrentOwner } from "./current-owner";
import type { NoteCloud } from "./note-cloud";
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
    const updated = { ...existing, ...draft };
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

/* Record that the first upload worked. Text typed meanwhile still needs sending. */
export async function markSynced(uploaded: NoteContent): Promise<void> {
  const db = getDB();
  await db.transaction("rw", db.notes, db.pendingUploads, async () => {
    const note = await db.notes.get(uploaded.id);
    if (!note) return;
    await db.notes.update(uploaded.id, { cloudStatus: "synced" });
    if (note.content !== uploaded.content) {
      await db.pendingUploads.put({ noteId: note.id, clock: note.localRevision?.clock ?? note.updatedAt });
    }
  });
}

/* The cloud holds this text, unless the note has changed since it was read. */
export async function clearPendingUpload(uploaded: NoteContent): Promise<void> {
  const db = getDB();
  await db.transaction("rw", db.notes, db.pendingUploads, async () => {
    const note = await db.notes.get(uploaded.id);
    if (!note || note.content === uploaded.content) await db.pendingUploads.delete(uploaded.id);
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
