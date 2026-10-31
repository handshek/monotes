"use client";

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useConvex, useConvexAuth } from "convex/react";
import { convexNoteCloud } from "@/lib/note-cloud";
import { UploadQueue } from "@/lib/upload-queue";

const UploadQueueContext = createContext<UploadQueue | undefined>(undefined);

export function UploadQueueProvider({ children }: { children: ReactNode }) {
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const queue = useMemo(() => new UploadQueue(convexNoteCloud(convex)), [convex]);

  useEffect(() => queue.start(), [queue]);
  useEffect(() => queue.setSignedIn(isAuthenticated), [queue, isAuthenticated]);

  return <UploadQueueContext.Provider value={queue}>{children}</UploadQueueContext.Provider>;
}

export function useUploadQueue() {
  const queue = useContext(UploadQueueContext);
  if (!queue) throw new Error("useUploadQueue must be used within an UploadQueueProvider");
  return queue;
}
