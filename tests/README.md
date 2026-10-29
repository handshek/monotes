# Verify the core notes flows

Use the project’s local `.env.local` configuration with a valid `NEXT_PUBLIC_CONVEX_URL` before building. These isolated local tests need no signed-in cloud account. Do not commit environment values.

Install dependencies and the two browser engines.

```sh
bun install --frozen-lockfile
bunx playwright install chromium webkit
```

Run the local production build and browser suite.

```sh
bun run test:e2e
```

The harness starts Monotes on port 3107. It refuses to reuse an existing server by default. Each test gets an isolated browser context with empty storage. It creates notes through the UI and never reads an existing browser profile.

Run against an explicitly started server when investigating a failure.

```sh
MONOTES_BASE_URL=http://127.0.0.1:3107 MONOTES_EVIDENCE_DIR=.audit/overnight/baseline bun run test:e2e
```

Open `.audit/overnight/latest/html/index.html` for the default report. The same directory contains a JSON report, success screenshots, and failure screenshots, videos, and traces. Set `MONOTES_EVIDENCE_DIR` to preserve separate before and after runs.

Repeat every case to check reproducibility.

```sh
bun run test:e2e -- --repeat-each=2
```

Run the core checks separately from the regressions.

```sh
bun run test:e2e -- tests/core.spec.ts
bun run lint
bun run typecheck
```

The suite covers desktop Chromium and mobile WebKit. Desktop keyboard editing enters the default Vim insert mode. Mobile editing uses ordinary text input. The suite checks local creation, editing, reload, case-insensitive content search, offline edits followed by reconnect and reload, immediate reload durability, repeated sidebar search, and mobile drawer navigation. It also checks empty-note persistence, visible storage failures, draft recovery, and protection against stale drafts overwriting newer or deleted notes. Save-notification checks distinguish a durably saved draft from one displaced by a newer tab during manual saving, observation, or automatic settlement. Ordinary remote edits and identical-content resolutions stay quiet. Sidebar preview checks preserve twenty words across mixed whitespace and retain the blank-note fallback. Forced storage errors and delayed cross-tab notifications are confined to isolated test contexts.

Offline persistence checks operate after the application has loaded. They do not establish that the application can boot or reload without a network connection. Cloud sync requires a separate authenticated account and is not claimed by these isolated local tests.

Characterize full offline reload with a running local server.

```sh
MONOTES_BASE_URL=http://127.0.0.1:3107 bun scripts/check-offline-shell.ts
```

Read the resulting JSON report separately from the regression suite. A browser may retain the old document after failed navigation. That retained editor does not prove an offline reload succeeded.

## Collaboration browser tests

These tests check live editing with agents in a real browser. They use the production editor and session code against a fresh local Convex backend.

```sh
scripts/collab-e2e.sh
```

The script copies the app to a temporary directory and overlays `tests/collab-e2e/overlay`. That overlay adds password sign-in for tests only and never exists in the application source. The script creates a local deployment with `CONVEX_AGENT_MODE=anonymous`. It sets `CONVEX_PROVISION_HOST` to the production Convex API with an explicit port, so the CLI keeps its state in `~/.convex-test-443` and `~/.cache/convex-test-443` instead of using your Convex login. The CLI still contacts Convex to issue the local deployment's admin key. The script generates throwaway auth keys without logging them, builds the copy, serves it on port 3108, and runs `playwright.collab.config.ts`. Afterwards it stops the backend and removes the temporary copy and the deployment state it created.

The suite covers:

- typing in Vim insert mode while an agent replaces another section, including the highlight, the person staying in insert mode, the text after reload, and Vim undo and redo affecting only the person's own typing
- typing that hasn't reached the server surviving a reload exactly once
- refusing a stale overlapping agent edit, and removing access
- two tabs and an agent converging
- opening a shared note on a second device, including a visible failure and **Try again** when local note writes fail
- connecting an agent with the setup message. The skill's own connect and read commands run against the app; the code is accepted, the first read marks the agent connected, and then the agent edits. The run captures the choice, waiting and connected screens.
- resuming a setup after a reload keeps its agent and access through **New code**, and **Cancel setup** removes only that setup's connection
- an agent that first reads a different note it was given leaving its setup with **Done**, keeping its access, with nothing stuck after a reload
- the setup on a 390-pixel-wide phone screen, without sideways scrolling

Set `MONOTES_COLLAB_KEEP=1` to keep the temporary directory and deployment state. Set `MONOTES_COLLAB_PORT` to use another port. The report is `.audit/collab/latest/html/index.html`.

The tests don't cover Google sign-in, a deployed Convex backend, or real Claude Code and Codex sessions.
