"use client";

import { useState } from "react";
import { useBreakpoint } from "@/hooks/use-breakpoint";
import { Button } from "@/components/sodium/ui/button";
import { Icon, Settings } from "@/components/sodium/icon";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/sodium/ui/dialog";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/sodium/ui/sheet";
import { SettingsContent } from "./settings-content";

const DESCRIPTION = "Customize your settings here.";

// When settings close, focus goes back to the note being edited rather than to this button.
function editorFocusTarget() {
  return document.querySelector<HTMLElement>(".cm-editor .cm-content") ?? true;
}

export default function SettingsTrigger() {
  const [open, setOpen] = useState(false);
  const isMobile = useBreakpoint(768);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label="settings"
        onClick={() => setOpen(true)}
      >
        <Icon icon={Settings} />
      </Button>

      <Sheet open={open && isMobile} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          showCloseButton
          className="h-[calc(100dvh-var(--space-10)*2)]"
          finalFocus={editorFocusTarget}
        >
          <SheetHeader>
            <SheetTitle>Settings</SheetTitle>
          </SheetHeader>
          <SettingsContent
            Body={SheetBody}
            description={
              <SheetDescription className="sr-only">
                {DESCRIPTION}
              </SheetDescription>
            }
          />
        </SheetContent>
      </Sheet>

      <Dialog open={open && !isMobile} onOpenChange={setOpen}>
        <DialogContent
          size="lg"
          className="h-[calc(100dvh-var(--space-10)*4)]"
          finalFocus={editorFocusTarget}
        >
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
          </DialogHeader>
          <SettingsContent
            Body={DialogBody}
            description={
              <DialogDescription className="sr-only">
                {DESCRIPTION}
              </DialogDescription>
            }
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
