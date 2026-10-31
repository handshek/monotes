import type { ConvexReactClient } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { NoteContent } from "@/lib/local-db";

/* The server operations ordinary notes need. */
export interface NoteCloud {
  upload(note: Pick<NoteContent, "id" | "content" | "updatedAt">): Promise<void>;
  /* The ids of the notes in the signed-in account, without their text. */
  listNoteIds(): Promise<string[]>;
}

export function convexNoteCloud(client: Pick<ConvexReactClient, "mutation" | "query">): NoteCloud {
  return {
    async upload(note) {
      await client.mutation(api.notes.syncNote, {
        noteId: note.id,
        content: note.content,
        updatedAt: note.updatedAt,
      });
    },
    listNoteIds: () => client.query(api.notes.listNoteIds, {}),
  };
}
