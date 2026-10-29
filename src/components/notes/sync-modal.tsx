"use client";

import {
  Dialog,
  DialogAction,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/sodium/ui/dialog";
import { useSyncNoteToCloud } from "@/lib/sync-engine";
import { toast } from "@/components/sodium/ui/toast";

interface SyncModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  noteId: string;
}

export default function SyncModal({
  open,
  onOpenChange,
  noteId,
}: SyncModalProps) {
  const syncNoteToCloud = useSyncNoteToCloud();

  // The dialog holds itself pending while this runs, closes when it resolves,
  // and shows the rejection's message above the footer when it fails.
  const handleConfirm = async () => {
    try {
      await syncNoteToCloud(noteId);
    } catch (error) {
      console.error("Failed to sync note:", error);
      throw new Error(
        error instanceof Error
          ? error.message
          : "Failed to sync note. Please try again."
      );
    }
    toast.success("Note synced to cloud");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sync note to cloud</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <DialogDescription>
            This will upload your note to the cloud so you can access it from
            other devices. Your note will be synced automatically going forward.
          </DialogDescription>
        </DialogBody>
        <DialogFooter>
          <DialogClose>Cancel</DialogClose>
          <DialogAction onAction={handleConfirm} pendingLabel="Syncing">
            Sync to cloud
          </DialogAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
