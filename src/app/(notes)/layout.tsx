"use client";

import NotesSidebar from "@/components/notes/notes-sidebar";
import { SidebarProvider, SidebarInset } from "@/components/sidebar";
import { NoteSyncProvider } from "@/contexts/note-sync-context";
import { UploadQueueProvider } from "@/contexts/upload-queue-context";
import { DistractionFreeProvider } from "@/contexts/distraction-free-context";

export default function NotesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <DistractionFreeProvider>
      <UploadQueueProvider>
        <NoteSyncProvider>
          <SidebarProvider>
            <NotesSidebar />
            <SidebarInset>{children}</SidebarInset>
          </SidebarProvider>
        </NoteSyncProvider>
      </UploadQueueProvider>
    </DistractionFreeProvider>
  );
}
