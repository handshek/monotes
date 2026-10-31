"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import Image from "next/image";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  useSidebar,
} from "@/components/sidebar";
import { Button } from "@/components/sodium/ui/button";
import { Kbd } from "@/components/sodium/ui/kbd";
import {
  Item,
  ItemActions,
  ItemGroup,
  ItemLink,
  ItemTitle,
} from "@/components/sodium/ui/item";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/sodium/ui/dropdown-menu";
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
import {
  Icon,
  Add,
  Logout,
  OverflowMenuHorizontal,
  Search,
  SidebarToggle,
  TrashCan,
  User,
} from "@/components/sodium/icon";
import { toast } from "@/components/sodium/ui/toast";
import { createNewNote, listOwnerNotes } from "@/lib/local-notes";
import { setCurrentOwner, useCurrentOwner } from "@/lib/current-owner";
import { getDB, LOCAL_OWNER } from "@/lib/local-db";
import { useLiveQuery } from "dexie-react-hooks";
import { generateSlug } from "@/lib/ids";
import { summarizeNote, UNTITLED_NOTE } from "@/lib/note-summary";
import { Authenticated, Unauthenticated, useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useRouter, usePathname } from "next/navigation";
import { api } from "../../../convex/_generated/api";
import { useNoteSync } from "@/contexts/note-sync-context";
import NotesSearchDialog from "./notes-search-dialog";
import LocalNotesOffer from "./local-notes-offer";
import { forgetLocalNote } from "@/lib/collab/store";

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
  const deleteCloudNote = useMutation(api.collab.deleteCloudNote);

  // Use Dexie's liveQuery for automatic reactivity
  const owner = useCurrentOwner();
  const notes =
    useLiveQuery(
      async () => (owner ? listOwnerNotes(owner) : []),
      [owner],
    ) || [];

  const handleSignOut = async () => {
    try {
      await signOut();
      // The only thing that takes a device back to the Local user.
      setCurrentOwner(LOCAL_OWNER);
      router.push("/");
      toast("Signed out. Your notes stay on this device and come back when you sign in.");
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
      toast.fail("Could not create note. Please try again.");
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
        ':is([role="dialog"], [role="alertdialog"]):is([data-state="open"], [data-open]):not([data-sidebar="sidebar"])',
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
    const note = await getDB().notes.get(id);
    if (note?.collab) {
      // Agent access ends only once the server confirms the deletion, so a
      // shared note is never removed from this device before that.
      if (!navigator.onLine) {
        toast.fail("Connect to the internet to delete a note shared with agents.");
        return;
      }
      try {
        const result = await deleteCloudNote({ noteId: id });
        if (result.status === "signed_out") {
          toast.fail("Sign in to delete a note shared with agents.");
          return;
        }
      } catch {
        toast.fail("Couldn’t delete this note. Try again.");
        return;
      }
      await forgetLocalNote(id);
    } else {
      if (note && note.cloudStatus !== "local") {
        try {
          await deleteCloudNote({ noteId: id });
        } catch {
          toast.warn("Deleted on this device. The cloud copy couldn’t be removed yet.");
        }
      }
      await getDB().notes.delete(id);
    }
    if (currentNoteId === id) {
      router.push("/");
    }
  };

  return (
    <>
      <Sidebar>
        <SidebarHeader>
          <Button
            variant="ghost"
            size="icon-sm"
            className="-ms-1"
            onClick={toggleSidebar}
            aria-label="Toggle sidebar"
          >
            <Icon icon={SidebarToggle} />
          </Button>
          <span className="min-w-0 truncate">Monotes</span>
        </SidebarHeader>
        <SidebarContent>
          <div className="flex flex-col border-b border-line py-1">
            <Button
              variant="ghost"
              className="w-full justify-start"
              onClick={onCreateNew}
            >
              <Icon icon={Add} />
              New Note
            </Button>
            <Button
              ref={searchTrigger}
              variant="ghost"
              className="w-full justify-start"
              onClick={onSearch}
              aria-keyshortcuts="Meta+K Control+K"
            >
              <Icon icon={Search} />
              <span className="min-w-0 truncate">Search</span>
              <span aria-hidden="true" className="ms-auto pointer-coarse:hidden">
                <Kbd keys="mod+k" />
              </span>
            </Button>
          </div>
          {/* With no notes the page itself says so and offers the first one; the sidebar stays quiet. */}
          {notes.length > 0 && (
            <h2 className="px-inset pt-3 pb-1 type-micro text-text-3">Notes</h2>
          )}
          {notes.length === 0 ? null : (
            <ItemGroup variant="plain" aria-label="Notes">
              {notes.map((n) => {
                const selected = currentNoteId === n.id;
                return (
                  <Item key={n.id} size="sm" selected={selected} className="group/note">
                    <ItemTitle className="min-w-0 flex-1">
                      <ItemLink
                        href={`/${n.id}`}
                        aria-current={selected ? "page" : undefined}
                        onClick={(e) => handleNoteClick(e, n.id)}
                      >
                        <NoteRowLabel content={n.content} />
                      </ItemLink>
                    </ItemTitle>
                    <ItemActions>
                      <DropdownMenu modal={false}>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Options"
                              className="md:opacity-0 md:group-hover/note:opacity-100 md:group-focus-within/note:opacity-100 md:data-popup-open:opacity-100"
                            />
                          }
                        >
                          <Icon icon={OverflowMenuHorizontal} />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent side="bottom" align="start">
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => setNoteToDelete(n.id)}
                          >
                            <Icon icon={TrashCan} />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </ItemActions>
                  </Item>
                );
              })}
            </ItemGroup>
          )}
        </SidebarContent>
        <SidebarFooter>
          <Unauthenticated>
            <div className="flex flex-col gap-2">
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => router.push("/signin")}
              >
                Sign in
              </Button>
              <p className="type-caption text-text-2">
                Sign in to sync notes to the cloud
              </p>
            </div>
          </Unauthenticated>
          <Authenticated>
            <LocalNotesOffer />
            {currentUser && (
              <div className="flex w-full items-center gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden border border-line bg-page text-text-2">
                    {currentUser.image ? (
                      <Image
                        src={currentUser.image}
                        alt={displayName}
                        width={32}
                        height={32}
                        className="size-full object-cover"
                      />
                    ) : (
                      <Icon icon={User} />
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="type-micro text-text-3">Signed in as</span>
                    <span
                      className="truncate type-body-sm text-text-1"
                      title={displayName}
                    >
                      {displayName}
                    </span>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Sign out"
                  onClick={handleSignOut}
                  aria-label="Sign out"
                >
                  <Icon icon={Logout} />
                </Button>
              </div>
            )}
          </Authenticated>
        </SidebarFooter>
      </Sidebar>
      <Dialog
        role="alertdialog"
        open={noteToDelete !== null}
        onOpenChange={(open) => !open && setNoteToDelete(null)}
      >
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Delete this note?</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <DialogDescription>
              This action cannot be undone. This will permanently delete
              your note locally and from our servers.
            </DialogDescription>
          </DialogBody>
          <DialogFooter>
            <DialogClose>Cancel</DialogClose>
            <DialogAction
              variant="destructive"
              onAction={() => {
                if (noteToDelete) return handleDeleteNote(noteToDelete);
              }}
            >
              Yes, delete note
            </DialogAction>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <NotesSearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onSelect={openNote}
        returnFocusRef={searchReturnFocus}
      />
    </>
  );
}

/** A note's title in ink, then the start of its text, muted, on the same line. */
function NoteRowLabel({ content }: { content: string | undefined }) {
  const { title, preview } = summarizeNote(content);
  if (!title) return <span className="text-text-3">{UNTITLED_NOTE}</span>;
  return (
    <>
      <span className="text-text-1">{title}</span>
      {preview && (
        <>
          {" "}
          <span className="text-text-3">{preview}</span>
        </>
      )}
    </>
  );
}
