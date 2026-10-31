import type { ConvexReactClient } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { NoteContent } from "@/lib/local-db";

export type UploadResult = FunctionReturnType<typeof api.notes.uploadNote>;
export type CloudVersion = Extract<UploadResult, { status: "conflict" }>["cloud"];

export interface UploadOptions {
  /* The cloud revision this text was edited from; null before first contact. */
  baseRevision: number | null;
  /* The person chose Sync to cloud, which may reuse a deleted note. */
  explicit?: boolean;
}

/* The server operations ordinary notes need. */
export interface NoteCloud {
  upload(note: Pick<NoteContent, "id" | "content" | "updatedAt">, options: UploadOptions): Promise<UploadResult>;
  /* The note's cloud text, or null if there is none or it is connected. */
  fetch(noteId: string): Promise<CloudVersion | null>;
  /* The ids of the notes in the signed-in account, without their text. */
  listNoteIds(): Promise<string[]>;
}

export function convexNoteCloud(client: Pick<ConvexReactClient, "mutation" | "query">): NoteCloud {
  return {
    upload: (note, { baseRevision, explicit }) =>
      client.mutation(api.notes.uploadNote, {
        noteId: note.id,
        content: note.content,
        updatedAt: note.updatedAt,
        baseRevision,
        explicit,
      }),
    async fetch(noteId) {
      const cloud = await client.query(api.collab.openContent, { noteId });
      if (!cloud || cloud.epoch) return null;
      return { content: cloud.content, updatedAt: cloud.updatedAt, revision: cloud.revision };
    },
    listNoteIds: () => client.query(api.notes.listNoteIds, {}),
  };
}
