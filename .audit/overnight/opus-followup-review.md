# Claude Opus follow-up review: `codex/monotes-overnight` at `8a44e4c`

**Verdict: no blocking findings.** All three earlier findings are fixed or honestly scoped, and the follow-up claims match the saved raw data. I found one new low-severity issue, confirmed by reading the code but not reproduced in a browser.

**What I reviewed:**
- Working directory `/Users/abhi/.codex/worktrees/monotes-overnight/monotes`, HEAD `8a44e4c82c410c9f5ce92b294bdb522d58a1fadd`.
- The two new commits since my first review (`54378f3`, `8a44e4c`). Files under `src/`, `eslint.config.mjs` and `package.json` have no uncommitted changes, so what's on disk is what I reviewed.
- The uncommitted `tests/README.md`, `scripts/benchmark-notes.ts` and `.audit/overnight/**`, inspected directly.

## Earlier findings

### 1. Per-keystroke extra work: preview fix verified, remaining cost honestly scoped

- **The new preview is equivalent to the old one.** `notes-sidebar.tsx:188` now uses `n.content.trim().split(/\s+/, 20).join(" ")`. In JavaScript, `trim()` and `\s` remove the same set of whitespace characters, and the old `\n` in `[^\s\n]` was redundant. So this produces exactly the first 20 words the old regex did, and the empty-note fallback at `:187`/`:189` is unchanged. `tests/sidebar-preview.spec.ts` covers no-break and em spaces. It passed 4/4 before the source change (`perf-review/preview-before.log`) and is part of the final 68.
- **The raw JSON matches the READMEs.**
  - The diagnostic pair goes from 24,000 full-content regex calls per tab to 0, replaced by 24,000 limited splits.
  - Extraction time drops from 735.8 / 724.8 ms to 11.5 / 11.9 ms (active / idle tab).
  - Writes stay at 120, full-library reads at 120 per tab, and cursor steps at 24,000 per tab.
  - All 12 runs have 200 rows, 120 inputs, exactly 20,607 stored characters and no errors.
  - Median p95 input-to-next-frame is 15.8 → 15.7 ms, with overlapping ranges (p=0.357). There are no long tasks.
- **Wording:** "not demonstrated" is the right conclusion. Every input-to-frame value sits between 15.1 and 16.0 ms, i.e. locked to the 60 Hz frame clock. So the measure can only detect work that misses a whole frame, which the README states.
- **What remains open:** a full-library IndexedDB read per keystroke in every tab, with unmeasured cost on low-end or mobile hardware. That is now a low-severity hypothesis, not a blocker.

### 2. Misleading "Saved": fixed for the path it covers

- **How it works:** `saveNow` (`useLocalNote.ts:118-130`) compares the durable content against the pending draft. Comparing content rather than revision is the right call: if the other tab's newer revision has identical text, "saved" is still true.
- **Test evidence:**
  - `save-ack/before-verified` shows 4 failures, with "Saved" visible each time.
  - `after-strengthened` passes 8/8.
  - The final 68/68 run started after `8a44e4c` was committed, and the default config builds its own server, so its provenance is consistent.
- **Sidebar path:** `registerSync`'s wrapper (`notes-editor.tsx:46`) keeps the sidebar's sync-before-navigate behaviour unchanged.
- **Gap:** see the new finding below.

### 3. Lint scope: fixed

- `eslint.config.mjs:13` ignores `convex/_generated/**`.
- `followup-lint.log` shows only 2 warnings, both in authored files the branch didn't touch.
- `MORNING-REVIEW.md` corrects the earlier provenance claim.

## New finding

### Low: when the newer revision arrives by observation, the draft is dropped silently

- **Where:** `src/hooks/useLocalNote.ts:92-100`, together with the message at `:14`.
- **Mechanism:** if tab B's newer revision reaches tab A through Dexie observation before any manual save, this effect:
  - drops tab A's pending draft and clears its session copy;
  - clears the save-failure alert;
  - shows nothing. The editor just switches to B's text.
- **Consequence:** a later Ctrl-S in A finds no pending draft and correctly reports "Saved" for the text now on screen. But the fact that A's own text was displaced is never mentioned.
- **When it matters:** mostly when A's draft is in the failed state. The alert tells the user to "Keep this tab open and try saving again", then the alert and the unsaved text both disappear without notice.
- **Why it's low severity:** the test reaches the fixed path only by blocking Dexie's cross-tab channel (`tests/save-ack.spec.ts:36`), so observation-first is the normal ordering. Outside a failure, the window is milliseconds. Storage-quota failures usually affect every tab, so one failing tab while another succeeds is unusual. This is not a regression from the original code, which had no failure alert at all. It is a gap in how fully finding 2 was closed.
- **Possible fix:** in that effect, when `pending.content !== stored.content`, show the same neutral "Updated from another tab" notice.

## Notes for the hand-off (not defects)

- **Uncommitted files:** the reviewed HEAD doesn't include the updated `tests/README.md` or `scripts/benchmark-notes.ts`. The morning review says a later audit commit will add them.
- **Benchmark lint coverage:** the `lint` script lists `scripts/check-offline-shell.ts` explicitly, so `scripts/benchmark-notes.ts` stays outside `bun run lint` even after it's committed. Its lint pass is recorded only in `perf-review/harness-lint.log`.
- **Test coupling:** `tests/save-ack.spec.ts:36` depends on Dexie's internal channel name `x-storagemutated-1`. If Dexie renames it, the test fails visibly at `:42` rather than passing falsely.

## What I couldn't verify

- I ran no tests, builds, servers or browsers. All timings and pass counts come from the saved artifacts.
- I couldn't prove which build produced the 68/68 run beyond the timestamps lining up.
- Cloud sync is still unverified, and full offline reload is still unsupported.

## Plan-mode gate

This session is still in plan mode, which would normally end with an approval request. As you asked, I'm reporting the gate instead: I'm not requesting write access, and there is no write plan.
