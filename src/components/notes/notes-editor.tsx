"use client";

import { useCallback, useEffect, useMemo } from "react";
import CodeMirror, { EditorSelection } from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { vim } from "@replit/codemirror-vim";
import { toast } from "sonner";
import { editorThemeExtensions } from "./notes-theme";
import { useLocalNote } from "@/hooks/useLocalNote";
import { useVimCommands } from "@/hooks/useVimCommands";
import { useDebouncedCloudSync } from "@/lib/sync-engine";
import { getNote } from "@/lib/local-notes";
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
  const { note, setMarkdown, saveNow, saveError, replacedRevision, loadError } = useLocalNote(id);
  const { syncNow, isSyncing, syncComplete } = useDebouncedCloudSync(
    note ? id : "",
    note?.content ?? "",
    note?.cloudStatus ?? "local"
  );
  const { registerSync, unregisterSync } = useNoteSync();
  const { settings } = useEditorSettings();
  const { triggerDistraction } = useDistractionFree();

  const saveAndSync = useCallback(async () => {
    const result = await saveNow();
    await syncNow();
    return result;
  }, [saveNow, syncNow]);

  useEffect(() => {
    registerSync(id, async () => { await saveAndSync(); });
    return () => {
      unregisterSync();
    };
  }, [id, saveAndSync, registerSync, unregisterSync]);

  // Before connecting for agents, make every keystroke durable and read the
  // stored text so nothing typed in this editor is left behind.
  const prepareConnect = useCallback(async () => {
    await saveNow();
    return (await getNote(id))?.content ?? "";
  }, [saveNow, id]);

  const showUpdatedNotice = useCallback(() => {
    toast("Updated from another tab", { id: `note-update-${id}` });
  }, [id]);

  useEffect(() => {
    if (replacedRevision) showUpdatedNotice();
  }, [replacedRevision, showUpdatedNotice]);

  const handleSave = useCallback(() => {
    void saveAndSync().then(
      (result) => result === "updated"
        ? showUpdatedNotice()
        : toast.success("Saved"),
      () => toast.error("Couldn’t save note")
    );
    return true;
  }, [saveAndSync, showUpdatedNotice]);

  useVimCommands(settings.vimMode, settings.vimCommands, handleSave);

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
          prepareConnect={prepareConnect}
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
