import Dexie, { Table } from "dexie";

export interface LocalRevision {
  clock: number;
  actor: string;
}

export interface NoteContent {
  id: string;
  content: string;
  updatedAt: number;
  localRevision?: LocalRevision;
  cloudStatus: "local" | "syncing" | "synced" | "ai-enabled";
}

class MonotesLocalDB extends Dexie {
  notes!: Table<NoteContent, string>;

  constructor() {
    super("monotes-db");
    this.version(1).stores({
      notes: "id,updatedAt,accessKey",
    });

    // Version 2: Add cloudStatus field
    this.version(2)
      .stores({
        notes: "id,updatedAt,accessKey,cloudStatus",
      })
      .upgrade((tx) => {
        // Migrate existing notes to have cloudStatus: "local"
        return tx
          .table("notes")
          .toCollection()
          .modify((note) => {
            note.cloudStatus = "local";
          });
      });

    // Version 3: Remove accessKey field
    this.version(3)
      .stores({
        notes: "id,updatedAt,cloudStatus",
      })
      .upgrade((tx) => {
        // Remove accessKey from existing notes
        return tx
          .table("notes")
          .toCollection()
          .modify((note) => {
            delete note.accessKey;
          });
      });
  }
}

let indexDBInstance: MonotesLocalDB | null = null;
export function getDB(): MonotesLocalDB {
  if (!indexDBInstance) indexDBInstance = new MonotesLocalDB();
  return indexDBInstance;
}
