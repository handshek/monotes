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
bun run test:e2e
bun run typecheck
```

The browser suite builds the app and starts a production server on port 3107. Run type checking after the build so Next.js has generated its route types. Each test uses an isolated browser context with empty storage.

The suite covers note creation, editing, reload persistence, offline edits after loading, search shortcuts, search layout, multiple-tab conflicts, and mobile navigation. It runs in desktop Chromium and mobile WebKit. It does not verify authenticated cloud sync.

Repeat every case to check reproducibility.

```sh
bun run test:e2e -- --repeat-each=2
```

The default HTML report is `.audit/overnight/latest/html/index.html`. See the [verification guide](tests/README.md) for custom server URLs, evidence directories, and focused checks.

## Code layout

Monotes uses Next.js 16, React 19, TypeScript, and Tailwind CSS. CodeMirror provides the Markdown editor. The search dialog uses cmdk with shadcn-style components. Dexie manages IndexedDB, and Convex provides the backend and authentication.

| Path | Contents |
| --- | --- |
| `src/app/` | Routes, layouts, and providers |
| `src/components/notes/` | Editor, sidebar, search dialog, and sync controls |
| `src/components/settings/` | Editor and appearance settings |
| `src/hooks/` | Local note persistence and note search |
| `src/lib/` | Local database, draft recovery, and sync functions |
| `convex/` | Backend schema, note functions, and Google authentication |
| `tests/` | Playwright browser checks |
