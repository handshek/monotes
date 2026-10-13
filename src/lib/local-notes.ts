import { getDB, type NoteContent } from "./local-db";
import { compareNoteRevisions, createDraft, type NoteDraft } from "./local-drafts";

export async function getNote(slug: string): Promise<NoteContent | null> {
  const existingNote = await getDB().notes.get(slug);
  return existingNote ?? null;
}

export async function saveNote(draft: NoteDraft): Promise<NoteContent | null> {
  const db = getDB();
  return db.transaction("rw", db.notes, async () => {
    const existing = await db.notes.get(draft.id);
    if (!existing || compareNoteRevisions(existing, draft) >= 0) {
      return existing ?? null;
    }
    const updated = { ...existing, ...draft };
    await db.notes.put(updated);
    return updated;
  });
}

export async function createNewNote(slug: string): Promise<NoteContent> {
  const empty: NoteContent = {
    id: slug,
    content: "",
    updatedAt: 0,
    cloudStatus: "local",
  };
  const note = { ...empty, ...createDraft(empty, "") };
  await getDB().notes.add(note);
  return note;
}

export async function listNotes(): Promise<NoteContent[]> {
  return getDB().notes.orderBy("updatedAt").reverse().toArray();
}
