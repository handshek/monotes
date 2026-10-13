"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import CodeMirror, { EditorSelection } from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { vim, Vim } from "@replit/codemirror-vim";
import { toast } from "sonner";
import { editorThemeExtensions } from "./notes-theme";
import { useLocalNote } from "@/hooks/useLocalNote";
import { useDebouncedCloudSync } from "@/lib/sync-engine";
import { useNoteSync } from "@/contexts/note-sync-context";
import NotesMetadataBar from "./notes-metadata-bar";
import WelcomeDialog from "./welcome-dialog";
import { useEditorSettings } from "@/contexts/editor-settings-context";
import { useDistractionFree } from "@/contexts/distraction-free-context";

interface NotesEditorProps {
  noteId: string;
}

export default function NotesEditor({ noteId }: NotesEditorProps) {
  const id = noteId ?? "local-default";
  const { note, setMarkdown, saveNow, saveError, loadError } = useLocalNote(id);
  const { syncNow, isSyncing, syncComplete } = useDebouncedCloudSync(
    note ? id : "",
    note?.content ?? "",
    note?.cloudStatus ?? "local"
  );
  const { registerSync, unregisterSync } = useNoteSync();
  const { settings } = useEditorSettings();
  const { triggerDistraction } = useDistractionFree();

  // Track applied Vim mappings to cleanup later
  const appliedMappings = useRef<{ lhs: string; mode: string }[]>([]);

  const saveAndSync = useCallback(async () => {
    await saveNow();
    await syncNow();
  }, [saveNow, syncNow]);

  useEffect(() => {
    registerSync(id, saveAndSync);
    return () => {
      unregisterSync();
    };
  }, [id, saveAndSync, registerSync, unregisterSync]);

  const handleSave = useCallback(() => {
    void saveAndSync().then(
      () => toast.success("Saved"),
      () => toast.error("Couldn’t save note")
    );
    return true;
  }, [saveAndSync]);

  // Handle Vim commands
  useEffect(() => {
    if (!settings.vimMode) return;

    // Clean up previous mappings
    appliedMappings.current.forEach(({ lhs, mode }) => {
      try {
        Vim.unmap(lhs, mode);
      } catch {
        // Ignore unmap errors
      }
    });
    appliedMappings.current = [];

    Vim.defineEx("write", "w", handleSave);

    const lines = settings.vimCommands.split("\n");
    lines.forEach((line) => {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 3) return;

      const [cmd, lhs, ...rhsParts] = parts;
      const rhs = rhsParts.join(" ");
      let mode = "normal";

      if (cmd.startsWith("i")) mode = "insert";
      else if (cmd.startsWith("v")) mode = "visual";
      else if (cmd.startsWith("n")) mode = "normal";

      // Map keys
      if (cmd.includes("nore")) {
        Vim.noremap(lhs, rhs, mode);
      } else {
        Vim.map(lhs, rhs, mode);
      }

      appliedMappings.current.push({ lhs, mode });
    });
  }, [settings.vimMode, settings.vimCommands, handleSave]);

  const extensions = useMemo(() => {
    const exts = [
      markdown(),
      ...editorThemeExtensions(),
      EditorView.scrollMargins.of(() => ({ top: 200, bottom: 200 })),
      keymap.of([{ key: "Mod-s", run: handleSave, preventDefault: true }]),
      EditorState.tabSize.of(settings.tabSize),
    ];

    if (settings.vimMode) {
      exts.push(vim());
    }

    return exts;
  }, [handleSave, settings.vimMode, settings.tabSize]);

  if (note === null) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        <div className="mb-4">❌ Note not found</div>
        <div>This note doesn’t exist locally. Create a new one instead.</div>
      </div>
    );
  }

  if (!note) {
    return loadError ? <p role="alert" className="py-12 text-center">{loadError}</p> : null;
  }

  return (
    <div className="editor-shell" style={{ fontSize: settings.fontSize }}>
      <WelcomeDialog />
      <div className="py-12">
        <NotesMetadataBar
          lastEdited={note?.updatedAt}
          cloudStatus={note?.cloudStatus}
          noteId={noteId}
          isSyncing={isSyncing}
          syncComplete={syncComplete}
        />
        {saveError && (
          <div role="alert" className="mb-4 text-sm text-destructive">
            {saveError}{" "}
            <button type="button" className="underline" onClick={handleSave}>Retry</button>
          </div>
        )}
        <CodeMirror
          placeholder={"Start typing"}
          className="cm-container md:max-w-4xl"
          value={note?.content ?? ""}
          onChange={(value) => {
            setMarkdown(value);
            triggerDistraction();
          }}
          extensions={extensions}
          basicSetup={{
            lineNumbers: settings.lineNumbers,
            foldGutter: settings.lineNumbers,
            highlightActiveLine: settings.highlightActiveLine,
            bracketMatching: false,
            autocompletion: false,
            highlightSelectionMatches: false,
          }}
          onCreateEditor={(view) => {
            view.focus();
            const pos = view.state.doc.length;
            view.dispatch({
              selection: EditorSelection.cursor(pos),
              effects: EditorView.scrollIntoView(pos, { y: "center" }),
            });
          }}
        />
      </div>
    </div>
  );
}
