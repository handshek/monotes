# Claude Opus recovery-feedback review: `codex/monotes-overnight` at `2ba234c`

**Verdict: no findings. The silent stale-draft recovery finding from my last review is closed**, and nothing blocks this work.

**What I reviewed:**
- Working directory `/Users/abhi/.codex/worktrees/monotes-overnight/monotes`, HEAD `2ba234c3c06db51385b27b3e9cf987af948e1792`. `src/`, `tests/` and `scripts/` have no uncommitted changes.
- The one commit since `4be3e38`. It changes 3 lines in `src/hooks/useLocalNote.ts`, strengthens `tests/persistence.spec.ts`, and commits `scripts/benchmark-notes.ts` and `tests/README.md`, which I reviewed in earlier rounds.

## The recovery change

- **What it does:** when a note loads and the saved draft is older than the stored version, `useLocalNote.ts:82-88` clears the draft as before. It now also emits the replacement event if the stored text differs from the draft.
- **It follows the same rule as the other two paths** (automatic save at `:59`, observing another tab at `:106`):
  - A deleted note stays quiet (`!stored`).
  - Identical text stays quiet.
  - Revision selection, durability, latest-edit-wins and deletion behaviour are unchanged.
- **The notice fires on load:** the editor's notice effect (`notes-editor.tsx:55-57`) is declared above the early returns at `:125` and `:134`. So it runs even before the editor renders, and it reuses the deduplicated per-note toast id.
- **It fires once per mount:** recovery is guarded by `recoveredSlugRef`, and `NotesEditor` is remounted for each note (keyed by id).

## Evidence matches the claims

- **Before the fix:** `recovery-notice/before/report.json` at `4be3e38` shows 4 failures, all on the missing notice. The same-content and deleted-note controls pass 8/8.
- **After the fix:** `verified/report.json` shows 88 passed, with no failures, skips, retries or flaky cases. That's 42 desktop Chromium and 46 mobile WebKit runs, i.e. 21 and 23 cases each repeated twice. All six recovery-test runs pass.
- **Provenance:** `verified-provenance.json` records HEAD `2ba234c`, clean source and build ID `AvnklLNuc4pb2iGZsMxZ1`. All seven recorded SHA-256 hashes match the files on disk, including `useLocalNote.ts` and `benchmark-notes.ts`.
- **Checks:** typecheck is clean, and lint shows only the 2 warnings in files this branch didn't touch. The build compiled cleanly and harness lint is clean.

## Notes (not actionable for this pass)

- **Notice wording in a rare case:** on recovery, "from another tab" could be wrong. That needs a failed write, then a session-storage quota failure on the next keystroke, then a successful write. The tab's own older draft would then linger and trigger the notice on reload. That combination is extremely unlikely, and the effect is only wording; nothing is lost.
- **Quiet-control timing:** as in the earlier tests, the new checks that nothing appears (`tests/persistence.spec.ts` same-content and deletion cases) pass immediately if the toast hasn't mounted. The rule they protect is a plain string comparison, so this is a theoretical weakness only.
- **Unchanged from earlier rounds:** the notice covers only a pending draft in the tab that sees the replacement. Ordinary latest-edit-wins overwrites stay silent, which is the documented policy.

## What I couldn't verify

- I ran no tests, builds, servers or browsers. Results come from the saved artifacts.
- Cloud sync is still unverified, and full offline reload is still unsupported.

## Plan-mode gate

This session is still in plan mode, which would normally end with an approval request. As you asked, I'm reporting the gate instead: I'm not requesting write access, and there is no write plan.
