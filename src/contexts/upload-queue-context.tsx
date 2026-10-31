"use client";

import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { useConvex, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { toast } from "@/components/sodium/ui/toast";
import { useCurrentOwner } from "@/lib/current-owner";
import { confirmSignIn } from "@/lib/local-notes";
import { convexNoteCloud } from "@/lib/note-cloud";
import { UploadQueue, type UploadStatus } from "@/lib/upload-queue";

interface UploadQueueValue {
  queue: UploadQueue;
  /* The account whose old notes have been claimed, so what's left is really the Local user's. */
  claimedAccount: string | null;
}

const UploadQueueContext = createContext<UploadQueueValue | undefined>(undefined);

export function UploadQueueProvider({ children }: { children: ReactNode }) {
  const convex = useConvex();
  const cloud = useMemo(() => convexNoteCloud(convex), [convex]);
  const queue = useMemo(
    () => new UploadQueue(cloud, {
      onDeletedElsewhere: (noteId) => toast("This note was deleted from your cloud account. It’s Local only here.", { id: `note-deleted-${noteId}` }),
    }),
    [cloud],
  );
  const owner = useCurrentOwner();
  const account = useQuery(api.user.currentUser)?._id ?? null;
  const [claimedAccount, setClaimedAccount] = useState<string | null>(null);

  useEffect(() => queue.start(), [queue]);

  // Runs when the confirmed account changes, not when the owner does: a sign-out
  // moves the owner while the last answer from the server is still arriving.
  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    void confirmSignIn(account, cloud).then(() => {
      if (!cancelled) setClaimedAccount(account);
    });
    return () => { cancelled = true; };
  }, [account, cloud]);

  useEffect(() => queue.setAccount(account === owner ? account : null), [queue, account, owner]);

  const value = useMemo(
    () => ({ queue, claimedAccount: claimedAccount === account ? account : null }),
    [queue, claimedAccount, account],
  );
  return <UploadQueueContext.Provider value={value}>{children}</UploadQueueContext.Provider>;
}

function useUploadQueueValue() {
  const value = useContext(UploadQueueContext);
  if (!value) throw new Error("useUploadQueue must be used within an UploadQueueProvider");
  return value;
}

export function useUploadQueue() {
  return useUploadQueueValue().queue;
}

export function useClaimedAccount() {
  return useUploadQueueValue().claimedAccount;
}

export function useUploadStatus(noteId: string): UploadStatus {
  const queue = useUploadQueue();
  const read = () => queue.statusOf(noteId);
  return useSyncExternalStore(queue.subscribe, read, read);
}
