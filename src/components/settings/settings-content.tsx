"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/sodium/ui/tabs";
import EditorSettings from "./editor-settings";
import AppearanceSettings from "./appearance-settings";
import GeneralSettings from "./general-settings";

const SETTINGS_TAB_STORAGE_KEY = "monotes-settings-tab";

const SETTINGS_TABS = [
  { value: "general", label: "General" },
  { value: "appearance", label: "Appearance" },
  { value: "editor", label: "Editor" },
] as const;

type TabType = (typeof SETTINGS_TABS)[number]["value"];

interface SettingsContentProps {
  /** The overlay's scrolling body: DialogBody on desktop, SheetBody on a phone. */
  Body: React.ComponentType<React.ComponentProps<"div">>;
  /** The overlay's description, read out with its title. */
  description: React.ReactNode;
}

export function SettingsContent({ Body, description }: SettingsContentProps) {
  const [activeTab, setActiveTab] = useState<TabType>("general");

  useEffect(() => {
    const lastOpenedTab = sessionStorage.getItem(
      SETTINGS_TAB_STORAGE_KEY,
    ) as TabType;
    if (lastOpenedTab) {
      setActiveTab(lastOpenedTab);
    }
  }, []);

  const handleTabChange = (value: string) => {
    setActiveTab(value as TabType);
    sessionStorage.setItem(SETTINGS_TAB_STORAGE_KEY, value);
  };

  return (
    <Tabs
      value={activeTab}
      onValueChange={handleTabChange}
      className="min-h-0 flex-1 gap-0"
    >
      <TabsList className="shrink-0">
        {SETTINGS_TABS.map(({ value, label }) => (
          <TabsTrigger key={value} value={value}>
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
      <Body>
        {description}
        <TabsContent value="general">
          <GeneralSettings />
        </TabsContent>
        <TabsContent value="appearance">
          <AppearanceSettings />
        </TabsContent>
        <TabsContent value="editor">
          <EditorSettings />
        </TabsContent>
      </Body>
    </Tabs>
  );
}
