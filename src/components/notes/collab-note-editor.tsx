"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConvex } from "convex/react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { collab } from "@codemirror/collab";
import { indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { Compartment, EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { basicSetup } from "@uiw/codemirror-extensions-basic-setup";
import { vim } from "@replit/codemirror-vim";
import { editorThemeExtensions } from "./notes-theme";
import NotesMetadataBar from "./notes-metadata-bar";
import RecoveryNotice from "./recovery-notice";
import WelcomeDialog from "./welcome-dialog";
import { Button } from "@/components/ui/button";
import { useEditorSettings } from "@/contexts/editor-settings-context";
import { useDistractionFree } from "@/contexts/distraction-free-context";
import { useNoteSync } from "@/contexts/note-sync-context";
import { useVimCommands } from "@/hooks/useVimCommands";
import { agentMarks } from "@/lib/collab/agent-marks";
import { CollabSession, type SessionStatus } from "@/lib/collab/session";
import type { RestoreReadiness } from "./note-history-dialog";
import { forgetLocalNote, markConnected } from "@/lib/collab/store";
import { convexTransport } from "@/lib/collab/transport";

interface CollabNoteEditorProps {
  noteId: string;
  epoch: string;
  lastEdited?: number;
  fallbackText: string;
}

type Phase =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "deleted" }
  | { kind: "failed" }
  | { kind: "unavailable"; reason: "offline" | "signed_out" | "missing" };

function setupOptions(settings: ReturnType<typeof useEditorSettings>["settings"]) {
  return basicSetup({
    lineNumbers: settings.lineNumbers,
    foldGutter: settings.lineNumbers,
    highlightActiveLine: settings.highlightActiveLine,
    bracketMatching: false,
    autocompletion: false,
    highlightSelectionMatches: false,
  });
}

export default function CollabNoteEditor({ noteId, epoch, lastEdited, fallbackText }: CollabNoteEditorProps) {
  const convex = useConvex();
  const router = useRouter();
  const transport = useMemo(() => convexTransport(convex), [convex]);
  const { settings } = useEditorSettings();
  const { triggerDistraction } = useDistractionFree();
  const { registerSync, unregisterSync } = useNoteSync();
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const sessionRef = useRef<CollabSession | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const distractionRef = useRef(triggerDistraction);
  distractionRef.current = triggerDistraction;
  const compartments = useRef({
    vim: new Compartment(),
    setup: new Compartment(),
    tabSize: new Compartment(),
    readOnly: new Compartment(),
  });
  const [generation, setGeneration] = useState(0);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [status, setStatus] = useState<SessionStatus | null>(null);

  const handleSave = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return true;
    void session.flush().then(({ savedLocally, pending }) => {
      if (!savedLocally) toast.error("Couldn’t save note");
      else if (pending > 0) toast.success("Saved on this device. Sending when connected.");
      else toast.success("Saved");
    });
    return true;
  }, []);
  const saveRef = useRef(handleSave);
  saveRef.current = handleSave;

  useVimCommands(settings.vimMode, settings.vimCommands, handleSave);

  useEffect(() => {
    registerSync(noteId, async () => {
      await sessionRef.current?.flush();
    });
    return () => unregisterSync();
  }, [noteId, registerSync, unregisterSync]);

  useEffect(() => {
    let cancelled = false;
    let session: CollabSession | null = null;
    let view: EditorView | null = null;
    setPhase({ kind: "loading" });
    const start = async () => {
      const opened = await CollabSession.open(noteId, epoch, transport, {
        onStatus: (next) => {
          if (!cancelled) setStatus(next);
          if (next.connection === "deleted" && !cancelled) setPhase({ kind: "deleted" });
        },
        onAgentEdit: (name) => toast(`${name} edited this note`, { id: `agent-edit-${noteId}` }),
        onReset: () => {
          toast.warning("Some changes couldn’t be merged. Monotes kept them for you to review.");
          if (!cancelled) setGeneration((value) => value + 1);
        },
      });
      if (cancelled) {
        if (opened.kind === "ready") opened.session.dispose();
        return;
      }
      if (opened.kind === "deleted") return setPhase({ kind: "deleted" });
      if (opened.kind === "unavailable") return setPhase({ kind: "unavailable", reason: opened.reason });
      if (opened.kind === "epoch_changed") {
        // The note was connected again elsewhere; switch this device to it.
        // Unsent text from the old connection is kept by the next session.
        await markConnected(noteId, opened.epoch, opened.text, Date.now());
        return;
      }
      session = opened.session;
      const current = settingsRef.current;
      const { vim: vimCompartment, setup, tabSize, readOnly } = compartments.current;
      view = new EditorView({
        parent: containerRef.current ?? undefined,
        state: EditorState.create({
          doc: opened.doc,
          extensions: [
            vimCompartment.of(current.vimMode ? vim() : []),
            placeholder("Start typing"),
            setup.of(setupOptions(current)),
            keymap.of([indentWithTab]),
            markdown(),
            ...editorThemeExtensions(),
            EditorView.scrollMargins.of(() => ({ top: 200, bottom: 200 })),
            keymap.of([{ key: "Mod-s", run: () => saveRef.current(), preventDefault: true }]),
            tabSize.of(EditorState.tabSize.of(current.tabSize)),
            readOnly.of(EditorState.readOnly.of(false)),
            collab({ startVersion: opened.version, clientID: opened.clientId }),
            agentMarks(),
            EditorView.updateListener.of((update) => {
              session?.handleUpdate(update);
              if (update.docChanged && update.transactions.some((tr) => tr.isUserEvent("input") || tr.isUserEvent("delete"))) {
                distractionRef.current();
              }
            }),
            EditorView.contentAttributes.of({ "aria-label": "Note text", "data-collab": "true" }),
          ],
        }),
      });
      viewRef.current = view;
      sessionRef.current = session;
      session.attach(view);
      view.focus();
      const end = view.state.doc.length;
      view.dispatch({
        selection: EditorSelection.cursor(end),
        effects: EditorView.scrollIntoView(end, { y: "center" }),
        annotations: Transaction.addToHistory.of(false),
      });
      setPhase({ kind: "ready" });
    };
    start().catch(() => {
      // Local storage or tab identity failed. Nothing was replaced; show the
      // last saved text and let the person retry.
      session?.dispose();
      view?.destroy();
      session = null;
      view = null;
      if (!cancelled) setPhase({ kind: "failed" });
    });
    return () => {
      cancelled = true;
      session?.dispose();
      view?.destroy();
      if (sessionRef.current === session) sessionRef.current = null;
      if (viewRef.current === view) viewRef.current = null;
    };
  }, [noteId, epoch, transport, generation]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const { vim: vimCompartment, setup, tabSize } = compartments.current;
    view.dispatch({
      effects: [
        vimCompartment.reconfigure(settings.vimMode ? vim() : []),
        setup.reconfigure(setupOptions(settings)),
        tabSize.reconfigure(EditorState.tabSize.of(settings.tabSize)),
      ],
    });
  }, [settings, phase]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: compartments.current.readOnly.reconfigure(EditorState.readOnly.of(phase.kind === "deleted")),
    });
  }, [phase]);

  const appendRecovered = useCallback((text: string) => {
    sessionRef.current?.appendText(text);
  }, []);

  const flushForRestore = useCallback(async (): Promise<RestoreReadiness> => {
    const session = sessionRef.current;
    if (!session) return { ok: false, reason: "unsent" };
    const { pending, problem } = await session.flush();
    if (pending === 0) return { ok: true };
    return { ok: false, reason: problem ?? "unsent" };
  }, []);

  return (
    <div className="editor-shell" style={{ fontSize: settings.fontSize }}>
      <WelcomeDialog />
      <div className="py-12">
        <NotesMetadataBar
          lastEdited={lastEdited}
          cloudStatus="synced"
          noteId={noteId}
          connected={{ status, epoch, flushForRestore }}
        />
        {status?.storageError && (
          <div role="alert" className="mb-4 text-sm text-destructive">
            Changes aren’t saved to this device. Keep this tab open and try saving again.{" "}
            <button type="button" className="underline" onClick={handleSave}>Retry</button>
          </div>
        )}
        {status?.problem === "note_too_long" && (
          <div role="alert" className="mb-4 text-sm text-destructive">
            This note is over 200,000 characters, so your changes are waiting on this device. Shorten it (or undo a
            large paste) and sending resumes by itself.
          </div>
        )}
        {(status?.problem === "too_large" || status?.problem === "queue_too_large") && (
          <div role="alert" className="mb-4 text-sm text-destructive">
            {status.problem === "too_large"
              ? "A change here is too large to send, so newer typing is waiting too."
              : "Your recent changes are too large to send together, so they’re waiting."}{" "}
            A copy is under “Kept text”.{" "}
            <button type="button" className="underline" onClick={() => sessionRef.current?.keepTextAndRestart()}>
              Start again from the shared note
            </button>
          </div>
        )}
        {status?.problem === "rejected" && (
          <div role="alert" className="mb-4 text-sm text-destructive">
            Monotes couldn’t send your recent changes. They’re saved on this device, and a copy is under “Kept text”.{" "}
            <button type="button" className="underline" onClick={() => sessionRef.current?.retrySending()}>
              Try again
            </button>
          </div>
        )}
        {phase.kind === "deleted" && (
          <div role="alert" className="mb-4 rounded-md border p-3 text-sm">
            This note was deleted from your Monotes account, so agents can no longer reach it. Anything you
            hadn’t sent is kept under “Kept text”.{" "}
            <Button
              variant="outline"
              size="sm"
              className="ml-2"
              onClick={async () => {
                await forgetLocalNote(noteId);
                router.push("/");
              }}
            >
              Remove from this device
            </Button>
          </div>
        )}
        <RecoveryNotice noteId={noteId} onAppend={phase.kind === "ready" ? appendRecovered : null} />
        {phase.kind === "failed" && (
          <div role="alert" className="mb-4 rounded-md border p-3 text-sm">
            Monotes couldn’t open live editing for this note in this tab. Your saved text is shown below and nothing
            was changed.{" "}
            <button type="button" className="underline" onClick={() => setGeneration((value) => value + 1)}>
              Try again
            </button>
            {fallbackText && (
              <pre className="mt-3 whitespace-pre-wrap font-[inherit] text-foreground">{fallbackText}</pre>
            )}
          </div>
        )}
        {phase.kind === "unavailable" && (
          <div className="mb-4 rounded-md border p-3 text-sm text-muted-foreground" role="status">
            {phase.reason === "signed_out"
              ? "Sign in to keep editing this note. It’s shared with agents, so changes go through your Monotes account."
              : phase.reason === "offline"
                ? "Connect to the internet to open this note in this tab for the first time."
                : "This note isn’t available in the account you’re signed in to."}{" "}
            <button type="button" className="underline" onClick={() => setGeneration((value) => value + 1)}>
              Try again
            </button>
            {fallbackText && (
              <pre className="mt-3 whitespace-pre-wrap font-[inherit] text-foreground">{fallbackText}</pre>
            )}
          </div>
        )}
        <div ref={containerRef} className="cm-container md:max-w-4xl" />
      </div>
    </div>
  );
}
