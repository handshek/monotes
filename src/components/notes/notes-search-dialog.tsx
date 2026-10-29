"use client";

import { useRef, useState, type RefObject } from "react";
import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/sodium/ui/dialog";
import {
  Command,
  CommandFooter,
  CommandHint,
  CommandInput,
  CommandItem,
  CommandList,
  CommandLoading,
} from "@/components/sodium/ui/command";
import { HighlightedText } from "@/components/highlighted-text";
import { summarizeNote, UNTITLED_NOTE } from "@/lib/note-summary";
import { useNoteSearch } from "@/hooks/useNoteSearch";

interface NotesSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (id: string) => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}

function SearchResults({
  onSelect,
  inputRef,
}: {
  onSelect: (id: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const { notes, query, isLoading } = useNoteSearch(searchQuery);

  return (
    <Command shouldFilter={false} label="Search notes" loop>
      <CommandInput
        ref={inputRef}
        placeholder="Search notes..."
        value={searchQuery}
        onValueChange={setSearchQuery}
      />
      {isLoading ? (
        <CommandLoading>Loading notes...</CommandLoading>
      ) : notes.length === 0 ? (
        <p role="status" className="px-inset py-6 text-center type-body-sm text-text-2">
          {query ? `No notes matching "${query}".` : "No notes yet."}
        </p>
      ) : null}
      <CommandList
        aria-label={query ? `Search results (${notes.length})` : "Recent notes"}
        aria-busy={searchQuery.trim() !== query}
      >
        {!isLoading &&
          notes.map((note) => (
            <CommandItem
              key={note.id}
              value={note.id}
              onSelect={onSelect}
              // Previews run to three lines, so rows keep their height and the list scrolls instead.
              className="shrink-0 items-stretch type-body-sm"
            >
              <Link
                href={`/${note.id}`}
                tabIndex={-1}
                onClick={(event) => {
                  // A modified click opens the note in a new tab and leaves this one, and the search, as they are.
                  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
                    event.stopPropagation();
                    return;
                  }
                  event.preventDefault();
                }}
                className="-mx-(--menu-px) flex min-w-0 flex-1 border-b border-line-faint px-(--menu-px) py-2"
              >
                {query ? (
                  <span className="line-clamp-3 break-words whitespace-pre-wrap">
                    {note.content.trim() ? (
                      <HighlightedText content={note.content} query={query} contextLines={1} />
                    ) : (
                      UNTITLED_NOTE
                    )}
                  </span>
                ) : (
                  <NoteRowSummary content={note.content} />
                )}
              </Link>
            </CommandItem>
          ))}
      </CommandList>
      <CommandFooter>
        <CommandHint keys="up+down">Navigate</CommandHint>
        <CommandHint keys="enter">Open</CommandHint>
        <span className="ms-auto">
          <CommandHint keys="esc">Close</CommandHint>
        </span>
      </CommandFooter>
    </Command>
  );
}

export default function NotesSearchDialog({
  open,
  onOpenChange,
  onSelect,
  returnFocusRef,
}: NotesSearchDialogProps) {
  const selectedNote = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  const selectNote = (id: string) => {
    selectedNote.current = true;
    onOpenChange(false);
    onSelect(id);
  };

  // A chosen note takes focus in its editor; otherwise focus goes back to what opened the search.
  const focusAfterClose = () => {
    const opener = returnFocusRef.current;
    const target = selectedNote.current
      ? document.querySelector<HTMLElement>('.cm-content[contenteditable="true"]')
      : opener?.isConnected ? opener : document.querySelector<HTMLElement>('nav button[aria-label="Toggle sidebar"]');
    selectedNote.current = false;
    return target ?? true;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-slot="command-dialog"
        size="lg"
        className="top-[20dvh] flex max-h-[min(calc(var(--row)*12),calc(80dvh-var(--space-8)))] translate-y-0 flex-col"
        initialFocus={input}
        finalFocus={focusAfterClose}
      >
        <DialogHeader>
          <DialogTitle>Search notes</DialogTitle>
        </DialogHeader>
        <DialogDescription className="sr-only">
          Search your notes without leaving the current note. Use the arrow keys to choose a note and Enter to open it.
        </DialogDescription>
        <SearchResults onSelect={selectNote} inputRef={input} />
      </DialogContent>
    </Dialog>
  );
}

/** Without a query a result reads as the note's title, then the start of its text. */
function NoteRowSummary({ content }: { content: string }) {
  const { title, preview } = summarizeNote(content, 40);
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate text-text-1">{title ?? UNTITLED_NOTE}</span>
      {preview && <span className="line-clamp-2 break-words text-text-2">{preview}</span>}
    </span>
  );
}
