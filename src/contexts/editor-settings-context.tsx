"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import { useIsTouchDevice } from "@/hooks/use-touch-device";
import {
  DEFAULT_NOTE_MEASURE,
  isNoteMeasure,
  type NoteMeasure,
} from "@/lib/note-measure";

export interface EditorSettings {
  vimMode: boolean;
  vimCommands: string;
  fontSize: number;
  highlightActiveLine: boolean;
  lineNumbers: boolean;
  tabSize: number;
  /** How wide the note column runs, in characters, or "full". */
  measure: NoteMeasure;
}

const DEFAULT_SETTINGS: EditorSettings = {
  vimMode: true,
  vimCommands: "",
  fontSize: 14,
  highlightActiveLine: false,
  lineNumbers: false,
  tabSize: 4,
  measure: DEFAULT_NOTE_MEASURE,
};

const STORAGE_KEY = "monotes-editor-settings";

interface EditorSettingsContextType {
  settings: EditorSettings;
  updateSetting: <K extends keyof EditorSettings>(
    key: K,
    value: EditorSettings[K]
  ) => void;
  isLoading: boolean;
}

const EditorSettingsContext = createContext<
  EditorSettingsContextType | undefined
>(undefined);

export function EditorSettingsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [settings, setSettings] = useState<EditorSettings>(DEFAULT_SETTINGS);
  const [mounted, setMounted] = useState(false);
  const isTouchDevice = useIsTouchDevice();

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        const next = { ...DEFAULT_SETTINGS, ...parsed };
        if (!isNoteMeasure(next.measure)) next.measure = DEFAULT_NOTE_MEASURE;
        setSettings(next);
      } catch (e) {
        console.error("Failed to parse editor settings", e);
      }
    }
    setMounted(true);
  }, []);

  const updateSetting = useCallback(
    <K extends keyof EditorSettings>(key: K, value: EditorSettings[K]) => {
      setSettings((prev) => {
        const next = { ...prev, [key]: value };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        return next;
      });
    },
    []
  );

  // Compute effective settings, disabling vim mode on touch devices
  const effectiveSettings = useMemo(
    () => ({
      ...settings,
      vimMode: settings.vimMode && !isTouchDevice,
    }),
    [settings, isTouchDevice]
  );

  return (
    <EditorSettingsContext.Provider
      value={{
        settings: effectiveSettings,
        updateSetting,
        isLoading: !mounted,
      }}
    >
      {children}
    </EditorSettingsContext.Provider>
  );
}

export function useEditorSettings() {
  const context = useContext(EditorSettingsContext);
  if (!context) {
    throw new Error(
      "useEditorSettings must be used within an EditorSettingsProvider. " +
        "Ensure you've wrapped your app (or the relevant branch) with the provider."
    );
  }
  return context;
}
