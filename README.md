# Monotes

Monotes is a minimal Markdown notes app for desktop and mobile. Notes save automatically in your browser, and you can create, edit, and search local notes without signing in.

## Write and find notes

- Create a note from the sidebar and start writing in the Markdown editor.
- Open **Search Notes** or press **Cmd+K** on macOS or **Ctrl+K** on Windows and Linux. Search opens over the current note and matches local note content without regard to case.
- Use **Up**, **Down**, and **Enter** to open a search result. Press **Esc** to close search.
- Adjust the theme, font size, line numbers, tab size, and Vim keybindings in **Settings**.
- On mobile, open the navigation drawer to create, search, or switch notes.

Vim mode is enabled by default on devices without touch input. Press `i` to start typing, or disable Vim mode in **Settings > Editor**. Touch devices use ordinary text input.

| Action | macOS | Windows and Linux |
| --- | --- | --- |
| Open or close note search | Cmd+K | Ctrl+K |
| Save the current note while editing | Cmd+S | Ctrl+S |
| Toggle the sidebar | Cmd+B | Ctrl+B |

In Vim mode, `:w` also saves the current note.

## Storage and sync

Notes live in IndexedDB in the current browser. Pending drafts use sessionStorage for recovery when you reload the same tab. Browser storage is specific to the browser profile and site address, so notes at `localhost:3000` are separate from notes at `127.0.0.1:3000`. Clearing site data removes local notes.

Once the app has loaded, you can edit and search local notes without a network connection. Starting or reloading the app while offline is not supported.

Cloud sync is optional for each note. Sign in with Google, select **Local Only** in the note's status bar, and confirm **Sync to Cloud** to upload it and enable background sync. Signing in does not upload every local note. Authenticated sync across devices is not covered by the local verification suite.

## Work on a note with your coding agent

You can let a coding agent you already use, such as Claude Code or Codex, read and edit chosen notes while you keep typing. Monotes doesn't run, sign in to, or message your agent. You keep giving it instructions in its own window, and it reaches Monotes through its own key.

Connecting works with coding agents that can follow written instructions and make web requests from a terminal, such as Codex (desktop or CLI), Claude Code and Cursor. It doesn't work with ordinary chat apps.

1. Sign in, open the note, and choose **Agent access** in the note's status bar.
2. Choose **Allow agents on this note**. This stores that note in your Monotes cloud account and switches it to live editing. If the cloud already has a different copy, Monotes shows both, and the copy you don't choose is kept as a saved version.
3. Pick your agent and whether it **Can read** or **Can edit** this note, then choose **Create setup message**.
4. Copy the message and paste it into your agent. It contains a one-time code that works for 10 minutes. The agent uses the code to save its own private access file in `~/.config/monotes/` and then reads the note. You don't set environment variables, install anything or restart anything. Your agent may ask permission to contact Monotes or save the file.
5. Monotes shows **Code accepted** when the agent has used the code, and **connected** only once the agent has actually read the note.

Connect each agent once. To let it work on another note, open that note's **Agent access** and give it access there; there's no new code. **Copy request** gives you a message for your agent with the note's link, the instructions link and the name of its access file, so a new chat can find its setup. It never contains a code or key.

The access file is plain data. The skill saves it only when Monotes's response has exactly the expected fields for the address the agent used, reads the address and key from it without running it, and sends the key only to that address.

If a setup stalls, use **New code** (it keeps the same agent, and never more access than the agent currently has) or **Cancel**. Either removes any connection that setup made but never used. A connected agent keeps its access until you remove it.

**Set up manually with a key instead**, collapsed under the setup, creates a key you store yourself as `MONOTES_URL` and `MONOTES_AGENT_KEY` environment variables. Keys created this way keep working. Monotes can't show a key again, so an unused key offers **Set up a new connection** instead.

Agents edit with exact replacements or appends based on the version they read. If an edit doesn't touch anything changed since that read, it merges with your typing. If it does, it's refused with a conflict, and the agent reads again. The server can't check typing it hasn't received yet, such as text written offline. When such typing lands in text an agent changed, Monotes flags it and keeps your pre-merge text for comparison. Agents learn about your edits only when they read the note again.

The agent's changes appear in the editor briefly highlighted under its name. **Changes** lists agent edits and saved versions. You can compare any version with the current note and restore it as a new version; Monotes saves the current text first. Text that couldn't be merged automatically, such as typing from an older window, appears under **Kept text** on that device.

Remove an agent's access per note in **Agent access**, or remove an agent entirely on the **Agent access** page at `/agent-access`. Deleting a shared note requires a connection, ends agent access, and blocks late writes from bringing it back.

Shared notes are stored on Monotes's Convex backend and aren't end-to-end encrypted. A shared note can hold up to 200,000 characters in any script, and each key is limited to 120 requests a minute. An account can have 20 connected agents, 5 setup codes waiting at once and 30 setup codes an hour. Agents list shared notes ten at a time, following a cursor for more. If a note goes over that length, for example after a large paste, its changes wait on the device and the editor says so. Sending resumes by itself once an undo or deletion brings the note back under the limit. A single change too large to ever send, or a run of changes that only fits again past what one request can carry, stops sending. The editor explains which, keeps a copy under **Kept text**, and offers to start again from the shared note. If the server keeps refusing a tab's changes, sending stops and the editor offers **Try again**, also keeping a copy.

In this beta, a shared note's edit history and saved versions are never pruned, so storage grows with use. Receipts for agent edit requests are removed after a day. A retry after that is refused as a conflict rather than applied twice.

The pairing endpoint (`POST /api/agent/v1/pair`) is public by design: the code is the credential. Codes have 160 random bits, last 10 minutes and work once. Request bodies are capped, and issuing codes is limited per account. None of that limits a flood of requests from one address. In production, rate-limit `/api/agent/v1/*`, and especially the pairing endpoint, at the hosting edge, keyed on a client identity the platform sets and clients can't forge. The app doesn't trust forwarded-address headers itself.

The agent API lives at `/api/agent/v1` on the Monotes site. Its route forwards to the Convex deployment's HTTP actions. It derives the backend from `NEXT_PUBLIC_CONVEX_URL` (`*.convex.cloud` becomes `*.convex.site`). Set `MONOTES_AGENT_API_ORIGIN` for other deployments. Push the Convex functions in `convex/` before using agent access.

## Run locally

Install Node.js 20.9 or newer and Bun. Use Bun to install the locked dependencies.

```sh
bun install --frozen-lockfile
```

The app requires a valid Convex deployment URL even when you use notes without signing in. To connect a development deployment and run the backend, use a separate terminal.

```sh
bunx convex dev
```

Follow the CLI prompts to select or create your development deployment. The CLI writes `CONVEX_DEPLOYMENT` and `NEXT_PUBLIC_CONVEX_URL` to `.env.local`. Keep that file out of Git.

For Google sign-in, configure the development deployment with the [Convex Auth setup guide](https://github.com/get-convex/convex-auth/blob/main/docs/pages/setup/manual.mdx) and [Google OAuth guide](https://github.com/get-convex/convex-auth/blob/main/docs/pages/config/oauth/google.mdx). The app's providers and auth routes are already implemented. Set `SITE_URL`, `JWT_PRIVATE_KEY`, `JWKS`, `AUTH_GOOGLE_ID`, and `AUTH_GOOGLE_SECRET` in the Convex deployment, not in public client variables. For the default local server, `SITE_URL` is `http://localhost:3000`.

Start the frontend in another terminal.

```sh
bun run dev
```

Open [Monotes locally](http://localhost:3000).

To run a production build locally, stop the development server first.

```sh
bun run build
bun run start
```

## Verify changes

Install the browser engines, then run the checks with the local Convex configuration available.

```sh
bunx playwright install chromium webkit
bun run lint
bun run lint:sodium
bun run test:unit
bun run test:e2e
bun run typecheck
```

`bun run lint:sodium` checks the UI against the Sodium design system's rules: its tokens and type roles only, no raw colours or sizes, square corners and one primary action per group.

`bun run test:unit` runs the collaboration protocol, Convex backend, agent pairing, browser session and agent proxy tests without a deployment. It also runs the skill's connect command against a throwaway local server, to check the saved access file's permissions and that an existing file is never replaced.

Run the collaboration browser tests against a fresh local Convex backend.

```sh
scripts/collab-e2e.sh
```

The script builds a temporary copy of the app with test-only password sign-in and runs `tests/collab-e2e` in desktop Chromium. It doesn't use your `.env.local` or Convex login. See the [verification guide](tests/README.md#collaboration-browser-tests) for details.

The browser suite builds the app and starts a production server on port 3107. Run type checking after the build so Next.js has generated its route types. Each test uses an isolated browser context with empty storage.

The suite covers note creation, editing, reload persistence, offline edits after loading, search shortcuts, search layout, multiple-tab conflicts, and mobile navigation. It runs in desktop Chromium and mobile WebKit. It does not verify authenticated cloud sync.

Repeat every case to check reproducibility.

```sh
bun run test:e2e -- --repeat-each=2
```

The default HTML report is `.audit/overnight/latest/html/index.html`. See the [verification guide](tests/README.md) for custom server URLs, evidence directories, and focused checks.

## Code layout

Monotes uses Next.js 16, React 19, TypeScript, and Tailwind CSS. The interface is built with [Sodium](https://design.how/systems/sodium), a design system of Base UI components installed into the repo; its rules for coding agents are in `.agents/skills/sodium/SKILL.md`. Unlike stock Sodium, every type role is set in Commit Mono, because Vim's motions and block cursor need equal-width characters. Themes imported from tweakcn are translated onto Sodium's colour roles. CodeMirror provides the Markdown editor. Dexie manages IndexedDB, and Convex provides the backend and authentication.

| Path | Contents |
| --- | --- |
| `src/app/` | Routes, layouts, and providers |
| `src/components/sodium/`, `src/lib/sodium/` | Sodium's tokens, styles and components, installed from its registry |
| `src/lib/theme-bridge.ts` | Translates imported themes onto Sodium's colour roles |
| `src/components/notes/` | Editors, sidebar, search dialog, sync controls, and change history |
| `src/components/agents/` | Agent access dialog and key setup |
| `src/lib/collab/` | Live editing session, local queues, tab identity, and agent highlights |
| `src/components/settings/` | Editor and appearance settings |
| `src/hooks/` | Local note persistence and note search |
| `src/lib/` | Local database, draft recovery, and sync functions |
| `convex/` | Backend schema, note and collaboration functions, agent API, and Google authentication |
| `public/agent-skill/` | Instructions agents read to use Monotes |
| `tests/` | Playwright browser checks |
| `tests/unit/` | Vitest protocol, backend, session, and proxy tests |
| `tests/collab-e2e/` | Collaboration browser tests and their test-only sign-in overlay |
