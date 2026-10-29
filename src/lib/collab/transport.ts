import type { ConvexReactClient } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import type { StoredUpdate } from "@/lib/local-db";

export type SnapshotResult = FunctionReturnType<typeof api.collab.snapshot>;
export type StepsResult = FunctionReturnType<typeof api.collab.stepsSince>;
export type PushResult = FunctionReturnType<typeof api.collab.pushUpdates>;
export type HeadResult = FunctionReturnType<typeof api.collab.head>;

export interface PushArgs {
  noteId: string;
  epoch: string;
  clientId: string;
  baseVersion: number;
  updates: StoredUpdate[];
}

/* The server operations a collaboration session needs. */
export interface CollabTransport {
  snapshot(noteId: string): Promise<SnapshotResult>;
  stepsSince(noteId: string, epoch: string, since: number): Promise<StepsResult>;
  push(args: PushArgs): Promise<PushResult>;
  watchHead(noteId: string, onHead: (head: HeadResult) => void): () => void;
}

export function convexTransport(client: ConvexReactClient): CollabTransport {
  return {
    snapshot: (noteId) => client.query(api.collab.snapshot, { noteId }),
    stepsSince: (noteId, epoch, since) => client.query(api.collab.stepsSince, { noteId, epoch, since }),
    push: (args) => client.mutation(api.collab.pushUpdates, args),
    watchHead(noteId, onHead) {
      const watch = client.watchQuery(api.collab.head, { noteId });
      const deliver = () => {
        try {
          const head = watch.localQueryResult();
          if (head) onHead(head);
        } catch {
          // A failed query is retried by the client; keep the last known state.
        }
      };
      const unsubscribe = watch.onUpdate(deliver);
      deliver();
      return unsubscribe;
    },
  };
}
