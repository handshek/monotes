import type { NoteCloud } from "../../src/lib/note-cloud";

interface CloudRow {
  content: string;
  updatedAt: number;
}

/* In-memory authority for ordinary notes. The contract suite keeps it honest. */
export class MemoryCloud implements NoteCloud {
  rows = new Map<string, CloudRow>();
  uploads: string[] = [];
  failNext = 0;
  /* Holds uploads open until released, like a request still in flight. */
  gate: Promise<void> | null = null;

  async upload(note: { id: string; content: string; updatedAt: number }) {
    await this.gate;
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error("network");
    }
    this.uploads.push(note.content);
    this.rows.set(note.id, { content: note.content, updatedAt: note.updatedAt });
  }

  async listNoteIds() {
    return [...this.rows.keys()];
  }
}
