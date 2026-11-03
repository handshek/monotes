import type { CloudVersion, NoteCloud, UploadOptions, UploadResult } from "../../src/lib/note-cloud";

interface CloudRow {
  content: string;
  updatedAt: number;
  revision: number;
  deleted?: boolean;
  connected?: boolean;
}

/* In-memory authority for ordinary notes. The contract suite keeps it honest. */
export class MemoryCloud implements NoteCloud {
  rows = new Map<string, CloudRow>();
  uploads: string[] = [];
  failNext = 0;
  signedOut = false;
  /* Holds uploads open until released, like a request still in flight. */
  gate: Promise<void> | null = null;

  async upload(
    note: { id: string; content: string; updatedAt: number },
    { baseRevision, explicit }: UploadOptions,
  ): Promise<UploadResult> {
    await this.gate;
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error("network");
    }
    if (this.signedOut) return { status: "signed_out" };
    const row = this.rows.get(note.id);
    if (!row) return this.write(note, 1);
    if (row.connected) return { status: "connected" };
    if (row.deleted && !explicit) return { status: "deleted" };
    if (!row.deleted) {
      if (row.content === note.content) return { status: "ok", revision: row.revision };
      if (baseRevision !== row.revision) {
        return { status: "conflict", cloud: { content: row.content, updatedAt: row.updatedAt, revision: row.revision } };
      }
    }
    return this.write(note, row.revision + 1);
  }

  async fetch(noteId: string): Promise<CloudVersion | null> {
    const row = this.rows.get(noteId);
    if (!row || row.deleted || row.connected) return null;
    return { content: row.content, updatedAt: row.updatedAt, revision: row.revision };
  }

  async listNoteIds() {
    return [...this.rows].filter(([, row]) => !row.deleted).map(([id]) => id);
  }

  private write(note: { id: string; content: string; updatedAt: number }, revision: number): UploadResult {
    this.uploads.push(note.content);
    this.rows.set(note.id, { content: note.content, updatedAt: note.updatedAt, revision });
    return { status: "ok", revision };
  }
}
