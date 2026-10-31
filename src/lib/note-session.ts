import { liveQuery } from "dexie";
import { getNote, saveNote } from "@/lib/local-notes";
import type { LocalRevision, NoteContent } from "@/lib/local-db";
import {
  clearPendingDraft,
  compareNoteRevisions,
  createDraft,
  readPendingDraft,
  writePendingDraft,
  type NoteDraft,
} from "@/lib/local-drafts";

const SAVE_ERROR = "Changes aren’t saved to this device. Keep this tab open and try saving again.";
const LOAD_ERROR = "Couldn’t load this note. Reload to try again.";

/* The device storage one open note needs. */
export interface NoteStore {
  observe(slug: string, onNote: (note: NoteContent | null) => void, onError: () => void): () => void;
  save(draft: NoteDraft): Promise<NoteContent | null>;
}

export const deviceNoteStore: NoteStore = {
  observe(slug, onNote, onError) {
    const subscription = liveQuery(async () => {
      try {
        return { note: await getNote(slug) };
      } catch {
        return null;
      }
    }).subscribe((result) => (result ? onNote(result.note) : onError()));
    return () => subscription.unsubscribe();
  },
  save: saveNote,
};

export interface NoteSnapshot {
  note: NoteContent | null | undefined;
  isLoading: boolean;
  isSaving: boolean;
  saveError: string | null;
  replacedRevision: LocalRevision | null;
  loadError: string | null;
}

/*
 * One open ordinary note: the text typed so far, whether it has reached this
 * device, and what happens when another tab's write gets there first. Knows
 * nothing about React or the cloud; useLocalNote binds it to the editor.
 */
export class NoteSession {
  private stored: NoteContent | null | undefined = undefined;
  private optimistic: NoteContent | null = null;
  private pending: NoteDraft | null = null;
  private isSaving = false;
  private saveError: string | null = null;
  private replacedRevision: LocalRevision | null = null;
  private loadError: string | null = null;
  private recovered = false;
  private listeners = new Set<() => void>();
  private snapshot: NoteSnapshot = { note: undefined, isLoading: true, isSaving: false, saveError: null, replacedRevision: null, loadError: null };

  constructor(readonly slug: string, private store: NoteStore = deviceNoteStore) {}

  open = () => this.store.observe(this.slug, this.observe, this.failLoad);

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = () => this.snapshot;

  setMarkdown = (content: string) => {
    const current = this.currentNote();
    if (!current || current.content === content) return;
    const draft = createDraft(current, content);
    this.pending = draft;
    this.optimistic = { ...current, ...draft };
    this.isSaving = true;
    this.saveError = null;
    writePendingDraft(draft);
    this.publish();
    void this.persist(draft).catch(() => {});
  };

  saveNow = async () => {
    if (!this.currentNote()) throw new Error("Note is unavailable");
    let pending = this.pending;
    let result: "saved" | "updated" = "saved";
    while (pending) {
      this.isSaving = true;
      this.publish();
      const saved = await this.persist(pending);
      if (!saved) throw new Error("This note was deleted");
      result = saved.content === pending.content ? "saved" : "updated";
      pending = this.pending;
    }
    return result;
  };

  private currentNote() {
    const { stored, optimistic } = this;
    if (stored === null) return null;
    return optimistic && (!stored || compareNoteRevisions(optimistic, stored) > 0) ? optimistic : stored;
  }

  /*
   * The one decision about a draft: it is finished once the row is gone or at
   * least as new. If that row holds other text, another tab won.
   */
  private settle(draft: NoteDraft, row: NoteContent | null) {
    if (row && compareNoteRevisions(row, draft) < 0) return false;
    clearPendingDraft(draft);
    if (row && row.content !== draft.content) this.replacedRevision = draft.localRevision;
    return true;
  }

  private settlePending(row: NoteContent | null) {
    if (!this.pending || !this.settle(this.pending, row)) return false;
    this.pending = null;
    this.isSaving = false;
    this.saveError = null;
    return true;
  }

  private observe = (stored: NoteContent | null) => {
    this.stored = stored;
    this.loadError = null;
    if (!this.recovered) {
      this.recovered = true;
      this.recoverDraft(stored);
    }
    this.settlePending(stored);
    if (!stored) this.optimistic = null;
    this.publish();
  };

  private failLoad = () => {
    this.loadError = LOAD_ERROR;
    this.publish();
  };

  /* A draft left in this tab's session by a reload that beat the write. */
  private recoverDraft(stored: NoteContent | null) {
    const recovered = readPendingDraft(this.slug);
    if (!recovered || this.settle(recovered, stored)) return;
    if (this.pending && compareNoteRevisions(this.pending, recovered) >= 0) return;
    this.pending = recovered;
    this.optimistic = { ...stored!, ...recovered };
    this.isSaving = true;
    void this.persist(recovered).catch(() => {});
  }

  private async persist(draft: NoteDraft) {
    try {
      const saved = await this.store.save(draft);
      clearPendingDraft(draft);
      if (this.settlePending(saved)) {
        this.optimistic = saved;
        this.publish();
      }
      return saved;
    } catch (error) {
      if (this.pending && compareNoteRevisions(this.pending, draft) === 0) {
        this.isSaving = false;
        this.saveError = SAVE_ERROR;
        this.publish();
      }
      throw error;
    }
  }

  private publish() {
    const note = this.currentNote();
    this.snapshot = {
      note,
      isLoading: note === undefined && !this.loadError,
      isSaving: this.isSaving,
      saveError: this.saveError,
      replacedRevision: this.replacedRevision,
      loadError: this.loadError,
    };
    for (const listener of this.listeners) listener();
  }
}
