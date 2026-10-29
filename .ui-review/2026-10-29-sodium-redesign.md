# UI review: Sodium redesign, home, note, search, sidebar and settings

> Follow-up the same day: every type role was then switched to Commit Mono (see `AGENTS.md`). The checks in this report were rerun after that change.

The changed screens are ready to ship. The review found three should-fix problems, and all three were fixed and re-verified in this session.

Ready to ship: yes. The three should-fix findings are fixed; two questions remain for a person and one note is open.

## Review record

- **Source:** branch `feat/sodium-redesign`, dev server at http://localhost:3000, fresh browser contexts with local-only data. There was no sign-in and no cloud data was used.
- **Tools:** Playwright Chromium, plus WebKit through the browser suite. Capture and probe scripts: `/tmp/sodium-verify-scripts/review-capture.cjs` and `review-navtoggle.cjs`.
- **Widths:** 390 (touch, `isMobile`) and 1280. **Themes:** light and dark. **Date:** 2026-10-29.
- **Criteria:** `ui-review/references/criteria.md`, with Sodium's rules (`.agents/skills/sodium/SKILL.md`) taking precedence.
- **Purpose of each screen** (all assumed; the caller did not give them):
  - Home: find a note or start one.
  - Note: write, with save and sharing state in view.
  - Search: jump to a note by its text.
  - Sidebar drawer: move between notes on a phone.
  - Settings: change the editor, appearance and account.
- **Lint and type checks:**
  - `bun run lint`: exit 0, with 1 existing warning in `convex/auth.config.ts`.
  - `bun run lint:sodium`: exit 0.
  - `bun run typecheck`: exit 0.
- **Accessibility scanner:** the project has none, so none was run. Accessibility trees were saved beside each capture (`*.aria.yml`).
- **Gaps:**
  - Signed-in, cloud and agent screens were not covered here. The collaboration suite covered them: `scripts/collab-e2e.sh`, exit 0, 9 of 9.
  - Real devices were not tested; emulation only.

## Probes

| Probe | Result |
| --- | --- |
| Keyboard path, home, 1280 | 14 Tab stops, all with a visible 2px ring. Note links draw the ring on their row (`probe-note-link-focus-light-1280.png`). Before the fix, stop 11 was the top bar's "Toggle sidebar", hidden under the sidebar (finding 1). |
| Focus after close | Search (⌘K from the editor) → editor. Settings (Enter on "settings") → editor, not the trigger (question 2). |
| Press feedback, Event Timing | 1× CPU: 80 events, max 24 ms. 4× throttle: 126 events, max 80 ms. None over 100 ms. |
| Reduced motion | Overlay animations stop. CodeMirror's caret blink (`cm-blink`, 1200 ms) continues (note 1). |
| Touch width, 390 | The search input is 16px, so it does not zoom on focus. All controls are reachable (`drawer-*-390.png`, `settings-appearance-*-390.png`). |
| Error state | A failed save shows a fail Alert with Retry at its trigger (`save-failed-light-*.png`). |
| Console | No page errors in any of the 4 capture contexts. |

## Findings

### should-fix (fixed in this session)

1. **A Tab stop lands on a control the user can't see.** Raised by: reviewer (solo).
   - **Where:** `button 'Toggle sidebar'` in `navigation`, 1280, sidebar open (`probe-nav-toggle-focus-light-1280.png`).
   - **Seen:** it took focus at stop 5 while `elementFromPoint` at its centre returned the sidebar's own toggle, so its ring was hidden.
   - **Criterion:** 13, focus lands where the hand expects.
   - **Fix check:** with the desktop sidebar open, the top bar's toggle is not in the Tab order.
   - **Verified:** 40 Tab presses never reached it. `tests/search-dialog.spec.ts` still finds it on phones.
2. **Alert titles named a topic or an action, not what happened.** 7 places. Raised by: reviewer.
   - **Where:** `alert` titles in `notes-editor.tsx` and `collab-note-editor.tsx`, at both widths (`save-failed-light-1280.png`).
   - **Seen:** the failed-save alert was titled "Save to this device", which reads like a button. "Open note", "Note length", "Sending changes" ×2 and "Live editing" ×2 had the same pattern.
   - **Criteria:** 5, labels name the result; 7, failure looks different.
   - **Fix check:** each title states the outcome. The new titles are "Not saved", "Note didn’t open", "Note too long to send", "Changes too large to send", "Changes not sent", "Live editing didn’t open" and "Live editing unavailable".
   - **Verified:** `bun run test:e2e` 58 of 58 and `scripts/collab-e2e.sh` 9 of 9.
3. **Long note titles were cut off on the home list.** Raised by: reviewer.
   - **Where:** the `link` "Quarterly planning notes for the infrastructure migration…" in `region 'Your Notes'`, at 390 and 1280 (`home-light-390.png`).
   - **Seen:** the title ended in "…".
   - **Criterion:** 11, `trap/chosen-text-truncated`.
   - **Fix check:** a title the user wrote wraps on the home list.
   - **Verified:** the first attempt (`break-words` on the link) did not take, because Sodium's `ItemTitle` truncates its first child with a more specific selector. The title now sets `[&>*:first-child]:whitespace-normal`. The link reports `white-space: normal`, no overflow, and wraps to 3 lines at 390 (`/tmp/sodium-verify/mono/wrap-390.png`).

### note

1. **The editor caret keeps blinking with reduced motion on.**
   - **Where:** `.cm-cursor`, at both widths.
   - **Evidence:** `document.getAnimations()` lists `cm-blink` at 1200 ms under `prefers-reduced-motion: reduce`.
   - **Fix check:** with reduced motion on, the editor caret does not blink (CodeMirror `cursorBlinkRate: 0`).

## Edge cases not shown

- **Loading and slow loading:** a skeleton exists in code but was not captured.
- **Offline:** not shown here; `tests/core.spec.ts` covers offline edits.
- **A returning user with many notes (100 or more):** not shown.
- **No permission or read-only:** not applicable to local notes; agent access is covered by the collaboration suite.
- **Touch hover that flashes or sticks:** not measured.
- **The same action repeated quickly:** not measured.

## For a person to decide

1. **Sidebar rows cut long titles to one line** (`drawer-*-390.png`). Wrapping them keeps every name visible but makes the list taller. Criterion 11 favours wrapping; dense navigation lists usually truncate.
2. **Closing settings returns focus to the editor rather than the "settings" button.** That suits writing, and it was the behaviour before the redesign, but keyboard users usually expect to land on the trigger.

## Dismissed and left out

- **The Next.js dev badge covers "Import" at 390** (`settings-appearance-*-390.png`). Dismissed: it appears only in development.
- **The landing copy "modern, distraction-free".** Dismissed: it isn't one of the words in Sodium's `anti-slop-no-hype` list, and rewriting copy is out of scope.

Coverage: home, note, search dialog, phone sidebar drawer, settings and failed save. 390 and 1280, light and dark. Probes measured: keyboard path, focus after close, Event Timing at 1× and 4× CPU, reduced motion, touch input size, console errors. Not measured: loading, offline, large data, touch hover, rapid repeats, real devices, signed-in screens (covered by the collaboration suite instead).
