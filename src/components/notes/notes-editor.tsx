"use client";

import { useCallback, useEffect, useMemo, type CSSProperties } from "react";
import CodeMirror, { EditorSelection } from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { vim } from "@replit/codemirror-vim";
import { toast } from "@/components/sodium/ui/toast";
import { editorThemeExtensions, notePlaceholder } from "./notes-theme";
import { useLocalNote } from "@/hooks/useLocalNote";
import { useVimCommands } from "@/hooks/useVimCommands";
import { useDebouncedCloudSync } from "@/lib/sync-engine";
import { getNote } from "@/lib/local-notes";
import { useNoteSync } from "@/contexts/note-sync-context";
import NotesMetadataBar from "./notes-metadata-bar";
import WelcomeDialog from "./welcome-dialog";
import { useEditorSettings } from "@/contexts/editor-settings-context";
import { useDistractionFree } from "@/contexts/distraction-free-context";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/sodium/ui/alert";
import { Button } from "@/components/sodium/ui/button";
import { Document } from "@/components/sodium/icon";
import { Empty, EmptyDescription, EmptyHeader, EmptyIcon, EmptyTitle } from "@/components/sodium/ui/empty-state";

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
      () => toast.fail("Couldn’t save note")
    );
    return true;
  }, [saveAndSync, showUpdatedNotice]);

  useVimCommands(settings.vimMode, settings.vimCommands, handleSave);

  // Built in the browser only: the placeholder is a DOM element (see notePlaceholder).
  const emptyPlaceholder = useMemo(
    () => (typeof document === "undefined" ? "Start typing" : notePlaceholder()),
    [],
  );

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
      <div className="py-12">
        <Empty reason="empty">
          <EmptyIcon icon={Document} />
          <EmptyHeader>
            <EmptyTitle>Note not found</EmptyTitle>
            <EmptyDescription>This note doesn’t exist locally. Create a new one instead.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  if (!note) {
    return loadError ? (
      <div className="py-12">
        <Alert status="fail">
          <AlertTitle>Note didn’t open</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      </div>
    ) : null;
  }

  return (
    <div
      className="editor-shell text-(length:--editor-font-size)"
      style={{ "--editor-font-size": `${settings.fontSize}px` } as CSSProperties}
    >
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
          <Alert status="fail" className="mb-4">
            <AlertTitle>Not saved</AlertTitle>
            <AlertDescription>{saveError}</AlertDescription>
            <AlertAction>
              <Button size="sm" onClick={handleSave}>Retry</Button>
            </AlertAction>
          </Alert>
        )}
        <CodeMirror
          placeholder={emptyPlaceholder}
          className="cm-container"
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
