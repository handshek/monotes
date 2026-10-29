/* Messages the person pastes into their coding agent. */

export type GrantedAccess = "read" | "edit";

function clock(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/* One-time setup: the only message that ever carries a pairing code. */
export function setupMessage(options: {
  origin: string;
  noteId: string;
  title: string;
  access: GrantedAccess;
  code: string;
  expiresAt: number;
}): string {
  const may = options.access === "edit" ? "read and edit" : "read";
  return [
    `Please connect yourself to my Monotes note “${options.title}” so you can ${may} it.`,
    `Follow the “Connect with a pairing code” steps in ${options.origin}/agent-skill/SKILL.md, using:`,
    `- Monotes address: ${options.origin}`,
    `- Pairing code: ${options.code} (works once, until ${clock(options.expiresAt)})`,
    `Then read ${options.origin}/${options.noteId} to check your access, and tell me in one sentence what the note is about.`,
  ].join("\n");
}

/*
 * Everyday request for an agent that is already connected. It names the
 * public instructions and the agent's saved access file (the name isn't
 * secret), so a fresh chat can find its setup again. No code or key.
 */
export function workRequest(options: {
  origin: string;
  noteId: string;
  title: string;
  credentialFile: string | null;
}): string {
  const access = options.credentialFile
    ? `Your saved access file is ~/.config/monotes/${options.credentialFile}; never print its contents.`
    : "Use the MONOTES_URL and MONOTES_AGENT_KEY settings you already have.";
  return [
    `Work on my Monotes note “${options.title}”: ${options.origin}/${options.noteId}`,
    `How to use Monotes: ${options.origin}/agent-skill/SKILL.md. ${access}`,
    "Read the note first. Here’s what I’d like:",
    "",
  ].join("\n");
}
