"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function CopyBlock({ text, label }: { text: string; label: string }) {
  return (
    <div className="relative">
      <pre aria-label={label} className="overflow-x-auto rounded-md border bg-muted/40 p-2 pr-16 text-xs">{text}</pre>
      <Button
        size="sm"
        variant="ghost"
        className="absolute right-1 top-1 h-7"
        onClick={() =>
          navigator.clipboard.writeText(text).then(
            () => toast.success("Copied"),
            () => toast.error("Couldn’t copy"),
          )
        }
      >
        Copy
      </Button>
    </div>
  );
}

/* Instructions for giving an existing coding agent a Monotes key and the Monotes skill. */
export function AgentSetupSteps({ token, name }: { token: string; name: string }) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return (
    <div className="space-y-3 text-sm">
      <p className="font-medium">Key for “{name}” — shown only once</p>
      <CopyBlock label="Agent key" text={token} />
      <p className="text-muted-foreground">
        This key can’t open anything yet. It reaches only the notes you allow, and you can remove it any time.
      </p>
      <ol className="list-decimal space-y-3 pl-5">
        <li>
          <p className="mb-1">
            Save the key where your agent’s shell can read it, outside any code repository (for example in a file
            only you can read that your shell profile loads):
          </p>
          <CopyBlock
            label="Environment variables"
            text={`export MONOTES_URL="${origin}"\nexport MONOTES_AGENT_KEY="${token}"`}
          />
        </li>
        <li>
          Restart your agent so it sees the new variables, then allow it on a note from that note’s Agent access menu.
        </li>
        <li>
          <p className="mb-1">
            In your agent’s usual window, paste this and replace the last line with what you want done. Nothing is
            installed: your agent reads the Monotes instructions from this site when you ask.
          </p>
          <CopyBlock
            label="Prompt for your agent"
            text={`Read ${origin}/agent-skill/SKILL.md and follow it to work in my Monotes notes, using the MONOTES_URL and MONOTES_AGENT_KEY environment variables that are already set.\nThen: add a testing section to ${origin}/<note id>`}
          />
        </li>
      </ol>
      <p className="text-xs text-muted-foreground">
        Your agent sends requests to Monotes from your computer. If it runs in a sandbox without network access, allow
        requests to {origin || "this site"}.
      </p>
    </div>
  );
}

/* Create a named key. The key itself is returned once and only its hash is stored. */
export function CreateAgentKey({ onCreated }: { onCreated?: (connectionId: string) => void }) {
  const createConnection = useAction(api.agents.createConnection);
  const [name, setName] = useState("Claude Code");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ token: string; name: string } | null>(null);

  if (created) {
    return (
      <div className="space-y-3">
        <AgentSetupSteps token={created.token} name={created.name} />
        <Button variant="outline" size="sm" onClick={() => setCreated(null)}>
          I’ve saved the key
        </Button>
      </div>
    );
  }
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        try {
          const result = await createConnection({ name });
          if (result.status === "created") {
            setCreated({ token: result.token, name: result.name });
            onCreated?.(result.connectionId);
          } else if (result.status === "invalid_name") toast.error("Use a name of 1–60 characters.");
          else if (result.status === "too_many") toast.error("You already have 20 agent keys. Revoke one first.");
          else toast.error("Sign in to add an agent key.");
        } catch {
          toast.error("Couldn’t create the key. Try again.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="grid gap-1">
        <Label htmlFor="agent-name">Agent name</Label>
        <Input id="agent-name" value={name} maxLength={60} onChange={(event) => setName(event.target.value)} className="w-56" />
      </div>
      <Button type="submit" disabled={busy}>
        Create agent key
      </Button>
    </form>
  );
}
