import type { LocalRevision, NoteContent } from "./local-db";

type VersionedNote = Pick<NoteContent, "updatedAt" | "localRevision">;
export type NoteDraft = Pick<NoteContent, "id" | "content" | "updatedAt"> & {
  localRevision: LocalRevision;
  // The row's `pulls` when typing began. Absent on drafts from older tabs.
  basePulls?: number;
};

const DRAFT_PREFIX = "monotes-draft:";
let actor: string | undefined;
let clock = 0;

export function compareNoteRevisions(left: VersionedNote, right: VersionedNote) {
  const a = left.localRevision ?? { clock: left.updatedAt, actor: "" };
  const b = right.localRevision ?? { clock: right.updatedAt, actor: "" };
  return a.clock - b.clock || (a.actor < b.actor ? -1 : a.actor > b.actor ? 1 : 0);
}

export function createDraft(note: NoteContent, content: string): NoteDraft {
  actor ??= crypto.randomUUID();
  clock = Math.max(Date.now(), clock + 1, (note.localRevision?.clock ?? note.updatedAt) + 1);
  return {
    id: note.id,
    content,
    updatedAt: clock,
    localRevision: { clock, actor },
    basePulls: note.pulls ?? 0,
  };
}

export function readPendingDraft(id: string): NoteDraft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_PREFIX + id);
    if (!raw) return null;
    const draft = JSON.parse(raw) as Partial<NoteDraft> | null;
    if (
      draft?.id !== id ||
      typeof draft.content !== "string" ||
      typeof draft.updatedAt !== "number" ||
      !Number.isSafeInteger(draft.updatedAt) ||
      !draft.localRevision ||
      !Number.isSafeInteger(draft.localRevision.clock) ||
      typeof draft.localRevision.actor !== "string"
    ) return null;
    return {
      id,
      content: draft.content,
      updatedAt: draft.updatedAt,
      localRevision: {
        clock: draft.localRevision.clock,
        actor: draft.localRevision.actor,
      },
      ...(typeof draft.basePulls === "number" ? { basePulls: draft.basePulls } : {}),
    };
  } catch {
    return null;
  }
}

export function writePendingDraft(draft: NoteDraft): boolean {
  try {
    sessionStorage.setItem(DRAFT_PREFIX + draft.id, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function clearPendingDraft(draft: NoteDraft): void {
  try {
    const pending = readPendingDraft(draft.id);
    if (pending && compareNoteRevisions(pending, draft) === 0) {
      sessionStorage.removeItem(DRAFT_PREFIX + draft.id);
    }
  } catch {
    // A committed note remains durable if session storage becomes unavailable.
  }
}
