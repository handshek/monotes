import { ChangeSet, Text } from "@codemirror/state";
import { readCurrentOwner } from "@/lib/current-owner";
import { getDB, type CollabClientRecord, type NoteContent, type RecoveryRecord } from "@/lib/local-db";

export async function listClients(noteId: string): Promise<CollabClientRecord[]> {
  return getDB().collabClients.where("noteId").equals(noteId).toArray();
}

let derivedClock = 0;
function nextDerivedClock() {
  derivedClock = Math.max(Date.now(), derivedClock + 1);
  return derivedClock;
}

/*
 * Atomically store a client's confirmed state and queue, and refresh the
 * note row used by the sidebar and search. If anything other than this
 * collaboration layer wrote the row since (for example an older open tab),
 * its text is kept as a recovery copy before the row is replaced.
 */
export async function saveClientState(record: CollabClientRecord, visibleText: string): Promise<void> {
  const db = getDB();
  await db.transaction("rw", db.collabClients, db.notes, db.recoveries, async () => {
    await db.collabClients.put(record);
    const note = await db.notes.get(record.noteId);
    if (!note || !note.collab || note.collab.epoch !== record.epoch) return;
    const foreignWrite = note.localRevision?.actor !== "collab" || note.localRevision.clock !== note.collab.derivedClock;
    if (foreignWrite && note.content !== visibleText && note.content !== record.text) {
      await db.recoveries.add({ noteId: record.noteId, text: note.content, reason: "older_window", createdAt: Date.now() });
    }
    if (note.content === visibleText && !foreignWrite) return;
    const clock = nextDerivedClock();
    await db.notes.put({
      ...note,
      content: visibleText,
      updatedAt: clock,
      localRevision: { clock, actor: "collab" },
      collab: { ...note.collab, derivedClock: clock },
    });
  });
}

export async function deleteClient(noteId: string, clientId: string) {
  await getDB().collabClients.delete([noteId, clientId]);
}

export async function addRecovery(noteId: string, text: string, reason: RecoveryRecord["reason"]) {
  if (!text.trim()) return;
  await getDB().recoveries.add({ noteId, text, reason, createdAt: Date.now() });
}

export async function deleteRecovery(id: number) {
  await getDB().recoveries.delete(id);
}

/* Text a queued client would show: its confirmed text plus its own updates. */
export function queuedText(record: CollabClientRecord): string | null {
  try {
    let doc = textOf(record.text);
    for (const update of record.unconfirmed) doc = ChangeSet.fromJSON(JSON.parse(update.changes)).apply(doc);
    return doc.toString();
  } catch {
    return null;
  }
}

function textOf(text: string) {
  return Text.of(text.split(/\r\n?|\n/));
}

/*
 * Mark a local note as connected, starting from the server's text. If the
 * device copy differs, it is kept as a recovery copy rather than discarded.
 */
export async function markConnected(noteId: string, epoch: string, serverText: string, updatedAt: number) {
  const db = getDB();
  await db.transaction("rw", db.notes, db.recoveries, async () => {
    const note = await db.notes.get(noteId);
    if (note && note.content !== serverText && note.content.trim() && !note.collab) {
      await db.recoveries.add({ noteId, text: note.content, reason: "before_connect", createdAt: Date.now() });
    }
    const clock = nextDerivedClock();
    const base: NoteContent = note ?? { id: noteId, owner: readCurrentOwner(), content: "", updatedAt, cloudStatus: "synced" };
    await db.notes.put({
      ...base,
      content: serverText,
      updatedAt: Math.max(updatedAt, clock),
      cloudStatus: "synced",
      localRevision: { clock, actor: "collab" },
      collab: { epoch, derivedClock: clock },
    });
  });
}

/* Copy a legacy cloud note onto this device so it can be opened. */
export async function hydrateCloudNote(noteId: string, content: string, updatedAt: number) {
  const db = getDB();
  await db.transaction("rw", db.notes, async () => {
    if (await db.notes.get(noteId)) return;
    await db.notes.add({ id: noteId, owner: readCurrentOwner(), content, updatedAt, cloudStatus: "synced" });
  });
}

export async function forgetLocalNote(noteId: string) {
  const db = getDB();
  await db.transaction("rw", db.notes, db.collabClients, db.recoveries, async () => {
    await db.notes.delete(noteId);
    await db.collabClients.where("noteId").equals(noteId).delete();
    await db.recoveries.where("noteId").equals(noteId).delete();
  });
}
