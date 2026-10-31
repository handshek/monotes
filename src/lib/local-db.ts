import Dexie, { Table } from "dexie";

export const LOCAL_OWNER = "local";

export interface LocalRevision {
  clock: number;
  actor: string;
}

export interface NoteContent {
  id: string;
  // A signed-in account's id, or LOCAL_OWNER. See docs/adr/0001.
  owner: string;
  // Set on notes from before owners existed, until an account claims them.
  unclaimed?: true;
  content: string;
  updatedAt: number;
  localRevision?: LocalRevision;
  cloudStatus: "local" | "syncing" | "synced" | "ai-enabled";
  // Set once the note is connected for live agent editing. The row's content
  // is then a copy derived from collaboration state, never its source.
  collab?: CollabMarker;
}

export interface CollabMarker {
  epoch: string;
  // Clock of the last derived write; any other writer is detected.
  derivedClock?: number;
}

export interface StoredUpdate {
  seq: number;
  changes: string;
}

/*
 * One tab's collaboration client for one note: the text and version last
 * confirmed by the server plus the updates it has not confirmed yet. Written
 * atomically before any of those updates is sent.
 */
export interface CollabClientRecord {
  noteId: string;
  clientId: string;
  epoch: string;
  version: number;
  text: string;
  confirmedSeq: number;
  unconfirmed: StoredUpdate[];
  updatedAt: number;
}

export interface RecoveryRecord {
  id?: number;
  noteId: string;
  text: string;
  reason:
    | "other_window"
    | "older_window"
    | "unmerged"
    | "deleted"
    | "before_connect"
    | "unsaved_typing"
    | "unsent";
  createdAt: number;
}

/*
 * A Synced note has text the cloud may not hold. Written in the same
 * transaction as the row, so an upload can't be forgotten by leaving the note,
 * reloading or going offline.
 */
export interface PendingUpload {
  noteId: string;
  clock: number;
}

class MonotesLocalDB extends Dexie {
  notes!: Table<NoteContent, string>;
  pendingUploads!: Table<PendingUpload, string>;
  collabClients!: Table<CollabClientRecord, [string, string]>;
  recoveries!: Table<RecoveryRecord, number>;

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

    // Version 4: per-tab collaboration queues and recovery copies.
    this.version(4).stores({
      notes: "id,updatedAt,cloudStatus",
      collabClients: "[noteId+clientId],noteId",
      recoveries: "++id,noteId",
    });

    // Version 5: durable markers for uploads the cloud hasn't confirmed.
    this.version(5).stores({
      pendingUploads: "noteId",
    });

    // Version 6: every note belongs to an owner. Older notes start with the
    // Local user and are claimed by an account that holds a cloud copy of them.
    this.version(6)
      .stores({
        notes: "id,updatedAt,cloudStatus,[owner+updatedAt]",
      })
      .upgrade((tx) => {
        return tx
          .table("notes")
          .toCollection()
          .modify((note) => {
            note.owner = LOCAL_OWNER;
            note.unclaimed = true;
          });
      });
  }
}

let indexDBInstance: MonotesLocalDB | null = null;
export function getDB(): MonotesLocalDB {
  if (!indexDBInstance) indexDBInstance = new MonotesLocalDB();
  return indexDBInstance;
}
