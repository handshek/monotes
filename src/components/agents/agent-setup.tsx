"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/sodium/ui/button";
import { CopyButton } from "@/components/sodium/ui/copy-button";
import { Field, FieldLabel } from "@/components/sodium/ui/field";
import { Input } from "@/components/sodium/ui/input";
import { toast } from "@/components/sodium/ui/toast";

/*
 * A value to copy, in mono on the code surface, with its copy button at the end.
 * `copyLabel` names the button ("Copy key"); it must not repeat the block's own
 * label, so a search by label finds the block alone.
 */
function CopyBlock({ text, label, copyLabel }: { text: string; label: string; copyLabel: string }) {
  return (
    <div className="code-surface flex min-w-0 items-start">
      <pre aria-label={label} className="min-w-0 flex-1 overflow-x-auto p-2 type-code-sm text-text-1">
        {text}
      </pre>
      <CopyButton className="m-1 shrink-0" label={copyLabel} value={text} />
    </div>
  );
}

/* Instructions for giving an existing coding agent a Monotes key and the Monotes skill. */
export function AgentSetupSteps({ token, name }: { token: string; name: string }) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return (
    <div className="flex flex-col gap-3 type-body-sm text-text-1">
      <p>Key for “{name}”, shown only once</p>
      <CopyBlock label="Agent key" copyLabel="key" text={token} />
      <p className="text-text-2">
        This key can’t open anything yet. It reaches only the notes you allow, and you can remove it any time.
      </p>
      <ol className="flex list-decimal flex-col gap-3 ps-5">
        <li>
          <p className="mb-1">
            Save the key where your agent’s shell can read it, outside any code repository (for example in a file
            only you can read that your shell profile loads):
          </p>
          <CopyBlock
            label="Environment variables"
            copyLabel="variables"
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
            copyLabel="prompt"
            text={`Read ${origin}/agent-skill/SKILL.md and follow it to work in my Monotes notes, using the MONOTES_URL and MONOTES_AGENT_KEY environment variables that are already set.\nThen: add a testing section to ${origin}/<note id>`}
          />
        </li>
      </ol>
      <p className="type-caption text-text-2">
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
      <div className="flex flex-col gap-3">
        <AgentSetupSteps token={created.token} name={created.name} />
        <Button className="self-start" variant="secondary" size="sm" onClick={() => setCreated(null)}>
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
          } else if (result.status === "invalid_name") toast.fail("Use a name of 1–60 characters.");
          else if (result.status === "too_many") toast.fail("You already have 20 agent keys. Revoke one first.");
          else toast.fail("Sign in to add an agent key.");
        } catch {
          toast.fail("Couldn’t create the key. Try again.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field className="w-56">
        <FieldLabel>Agent name</FieldLabel>
        <Input value={name} maxLength={60} onChange={(event) => setName(event.target.value)} />
      </Field>
      <Button type="submit" pending={busy}>
        Create agent key
      </Button>
    </form>
  );
}
