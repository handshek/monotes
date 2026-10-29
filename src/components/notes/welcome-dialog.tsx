"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogAction,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/sodium/ui/dialog";
import { Checkbox } from "@/components/sodium/ui/checkbox";

const WELCOME_DISMISSED_KEY = "monotes-welcome-dismissed";

const FEATURES = [
  {
    title: "Local-first notes",
    body: "Your notes are stored locally on your device using IndexedDB. They work offline and load instantly, with no server required for basic usage.",
  },
  {
    title: "Cloud sync",
    body: "Sign in to sync your notes across devices. Changes are automatically saved and synced in the background while you type.",
  },
  {
    title: "Vim mode",
    body: "Enable Vim keybindings in settings for a keyboard-driven editing experience. Custom key mappings are supported via the editor settings.",
  },
  {
    title: "Distraction-free mode",
    body: "The UI fades away while you type, keeping you focused on your writing. Interface elements reappear when you pause.",
  },
  {
    title: "Markdown editor",
    body: "Write in Markdown with syntax highlighting powered by CodeMirror. Customize font size, tab width, and line numbers in settings.",
  },
];

export default function WelcomeDialog() {
  const [open, setOpen] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  useEffect(() => {
    const dismissed = localStorage.getItem(WELCOME_DISMISSED_KEY);
    if (!dismissed) {
      setOpen(true);
    }
  }, []);

  const handleClose = () => {
    if (dontShowAgain) {
      localStorage.setItem(WELCOME_DISMISSED_KEY, "true");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Welcome to Monotes</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <DialogDescription>A Markdown notebook that keeps your notes on this device first.</DialogDescription>
          <dl className="mt-1 flex flex-col">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="rule-row flex flex-col gap-1 py-3">
                <dt className="type-label text-text-1">{feature.title}</dt>
                <dd className="type-body-sm text-text-2">{feature.body}</dd>
              </div>
            ))}
          </dl>
        </DialogBody>
        <DialogFooter defaultAction="primary">
          <label className="me-auto flex cursor-pointer items-center gap-3 type-label-sm text-text-2">
            <Checkbox checked={dontShowAgain} onCheckedChange={(checked) => setDontShowAgain(checked)} />
            Do not show again
          </label>
          <DialogAction onAction={handleClose}>Okay</DialogAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
