# Verify the core notes flows

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

Run the passing core checks separately from the regressions.

```sh
bun run test:e2e -- tests/core.spec.ts
bun run lint
bun run typecheck
```

The suite covers desktop Chromium and mobile WebKit. Desktop keyboard editing enters the default Vim insert mode. Mobile editing uses ordinary text input. The suite checks local creation, editing, reload, case-insensitive content search, offline edits followed by reconnect and reload, immediate reload durability, sidebar search, and mobile drawer navigation.

Offline persistence checks operate after the application has loaded. They do not establish that the application can boot or reload without a network connection. Cloud sync requires a separate authenticated account and is not claimed by these isolated local tests.

Characterize full offline reload with a running local server.

```sh
MONOTES_BASE_URL=http://127.0.0.1:3107 bun scripts/check-offline-shell.ts
```

Read the resulting JSON report separately from the regression suite. A browser may retain the old document after failed navigation. That retained editor does not prove an offline reload succeeded.
