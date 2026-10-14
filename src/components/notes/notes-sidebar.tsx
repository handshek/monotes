"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
  SidebarRail,
  SidebarFooter,
  SidebarMenuAction,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { PinLeftIcon, PlusIcon } from "@radix-ui/react-icons";
import { User, LogOut, Search, MoreHorizontal, Trash } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { createNewNote } from "@/lib/local-notes";
import { getDB } from "@/lib/local-db";
import { useLiveQuery } from "dexie-react-hooks";
import { generateSlug } from "@/lib/ids";
import { toast } from "sonner";
import { Authenticated, Unauthenticated, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useRouter, usePathname } from "next/navigation";
import { api } from "../../../convex/_generated/api";
import { useNoteSync } from "@/contexts/note-sync-context";
import { cn } from "@/lib/utils";
import NotesSearchDialog from "./notes-search-dialog";

export default function NotesSidebar() {
  const { toggleSidebar, setOpenMobile } = useSidebar();
  const router = useRouter();
  const pathname = usePathname();
  const { signOut } = useAuthActions();
  const currentUser = useQuery(api.user.currentUser);
  const { syncNow } = useNoteSync();
  const [searchOpen, setSearchOpen] = useState(false);
  const searchTrigger = useRef<HTMLButtonElement>(null);
  const searchReturnFocus = useRef<HTMLElement | null>(null);
  const [noteToDelete, setNoteToDelete] = useState<string | null>(null);

  // Use Dexie's liveQuery for automatic reactivity
  const notes =
    useLiveQuery(
      () => getDB().notes.orderBy("updatedAt").reverse().toArray(),
      [],
    ) || [];

  const handleSignOut = async () => {
    try {
      await signOut();
      router.push("/");
    } catch (error) {
      console.error("Failed to sign out:", error);
    }
  };

  const onCreateNew = async () => {
    try {
      const slug = generateSlug();
      const note = await createNewNote(slug);
      setOpenMobile(false);
      router.push(`/${note.id}`);
    } catch {
      toast.error("Could not create note. Please try again.");
    }
  };

  const onSearch = () => {
    searchReturnFocus.current = searchTrigger.current;
    setOpenMobile(false);
    setSearchOpen(true);
  };

  useEffect(() => {
    const handleSearchShortcut = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== "k" ||
        !(event.metaKey || event.ctrlKey) ||
        event.altKey || event.shiftKey || event.isComposing
      ) return;

      if (!searchOpen && document.querySelector(
        '[role="dialog"][data-state="open"]:not([data-sidebar="sidebar"]), [role="alertdialog"][data-state="open"]',
      )) return;

      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      if (searchOpen) {
        setSearchOpen(false);
      } else {
        searchReturnFocus.current = document.activeElement instanceof HTMLElement
          ? document.activeElement : null;
        setOpenMobile(false);
        setSearchOpen(true);
      }
    };
    document.addEventListener("keydown", handleSearchShortcut, true);
    return () => document.removeEventListener("keydown", handleSearchShortcut, true);
  }, [searchOpen, setOpenMobile]);

  const displayName = currentUser?.name || currentUser?.email || "User";
  const currentNoteId = pathname?.replace(/^\//, "") || null;

  const openNote = async (targetNoteId: string) => {
    setOpenMobile(false);
    const currentNoteIdFromPath = pathname?.replace(/^\//, "") || null;
    if (targetNoteId === currentNoteIdFromPath) return;

    if (currentNoteIdFromPath && syncNow) {
      try {
        await syncNow();
      } catch (error) {
        console.error("Sync failed before navigation:", error);
      }
    }
    router.push(`/${targetNoteId}`);
  };

  const handleNoteClick = (
    event: MouseEvent<HTMLAnchorElement>,
    targetNoteId: string,
  ) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    void openNote(targetNoteId);
  };

  const handleDeleteNote = async (id: string) => {
    await getDB().notes.delete(id);
    if (currentNoteId === id) {
      router.push("/");
    }
  };

  return (
    <>
      <Sidebar>
        <SidebarHeader>
          <div className="flex items-center justify-between px-1.5 py-1.5">
            <Button
              variant="ghost"
              size="icon-lg"
              className="size-7"
              onClick={toggleSidebar}
              aria-label="Toggle sidebar"
            >
              <PinLeftIcon className="size-4" />
            </Button>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm">Monotes</span>
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton onClick={onCreateNew}>
                    <PlusIcon className="size-4 mr-2" />
                    <span>New Note</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton ref={searchTrigger} onClick={onSearch} aria-keyshortcuts="Meta+K Control+K">
                    <Search className="size-4 mr-2" />
                    <span className="truncate">Search</span>
                    <kbd aria-hidden="true" className="ml-auto rounded border px-1 text-[10px] text-muted-foreground">⌘ K / Ctrl K</kbd>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel className="text-foreground">
              Notes
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {notes.map((n) => (
                  <SidebarMenuItem key={n.id}>
                    <SidebarMenuButton asChild>
                      <Link
                        href={`/${n.id}`}
                        onClick={(e) => handleNoteClick(e, n.id)}
                        className={cn(
                          "[&:hover_span]:text-foreground group",
                          currentNoteId === n.id &&
                            "bg-accent [&>span]:text-foreground border",
                        )}
                      >
                        <span className="truncate text-sidebar-foreground/70 transition-colors">
                          {n.content?.trim()
                            ? n.content.trim().split(/\s+/, 20).join(" ")
                            : n.id}
                        </span>
                      </Link>
                    </SidebarMenuButton>
                    <DropdownMenu modal={false}>
                      <DropdownMenuTrigger asChild className="cursor-pointer">
                        <SidebarMenuAction showOnHover>
                          <MoreHorizontal />
                          <span className="sr-only">Options</span>
                        </SidebarMenuAction>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        className="w-36"
                        side="bottom"
                        align="start"
                        collisionPadding={10}
                      >
                        <DropdownMenuItem onSelect={() => setNoteToDelete(n.id)}>
                          <Trash className="text-destructive" />
                          <span className="text-destructive">Delete</span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </SidebarMenuItem>
                ))}
                {notes.length === 0 && (
                  <div className="text-xs text-muted-foreground px-2 py-1.5">
                    No notes yet.
                  </div>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
            <AlertDialog
              open={noteToDelete !== null}
              onOpenChange={(open) => !open && setNoteToDelete(null)}
            >
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This action cannot be undone. This will permanently delete
                    your note locally and from our servers.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      if (noteToDelete) {
                        handleDeleteNote(noteToDelete);
                      }
                    }}
                    className="bg-destructive text-destructive-foreground"
                  >
                    Yes, delete note
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="py-4 border-t border-secondary">
          <Unauthenticated>
            <div className="flex flex-col gap-2">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => router.push("/signin")}
              >
                Sign In
              </Button>
              <p className="text-xs text-muted-foreground px-2">
                Sign in to sync notes to the cloud
              </p>
            </div>
          </Unauthenticated>
          <Authenticated>
            {currentUser && (
              <div className="flex items-center gap-2 w-full">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div className="flex items-center justify-center size-8 rounded-full bg-sidebar-accent shrink-0 overflow-hidden">
                    {currentUser.image ? (
                      <Image
                        src={currentUser.image}
                        alt={displayName}
                        width={32}
                        height={32}
                        className="size-full object-cover"
                      />
                    ) : (
                      <User className="size-4" />
                    )}
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-[10px] text-muted-foreground leading-none">
                      Signed In as
                    </span>
                    <span
                      className="text-sm font-medium truncate text-ellipsis"
                      title={displayName}
                    >
                      {displayName}
                    </span>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  title="Sign out"
                  className="size-8 shrink-0"
                  onClick={handleSignOut}
                  aria-label="Sign out"
                >
                  <LogOut className="size-4 text-destructive" />
                </Button>
              </div>
            )}
          </Authenticated>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <NotesSearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onSelect={openNote}
        returnFocusRef={searchReturnFocus}
      />
    </>
  );
}
