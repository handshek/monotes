# Typing regression investigation

The hypothesized **user-visible typing regression was not demonstrated in this workload**. The persistence change does demonstrably amplify background reads, preview scanning, and renderer CPU work. That mechanism is not disproven by this machine remaining responsive.

## Claim and method

Claim recorded before measurement: in desktop Chromium with 200 notes of 20 KiB each and two loaded tabs, the new immediate persistence causes a repeatable user-visible typing latency regression from the original baseline.

This is a synthetic workload, not the user’s real notes. Fresh Playwright contexts seed only their own IndexedDB, type actual keyboard events in the default Vim insert mode, and check every expected input plus the complete stored result. There are no cloud writes or authenticated browser profiles.

Both source snapshots are immutable Git archives: baseline `b6f605126121cf118f2707988c3178e11bf5599b` and current `d3308196207778ebc13ab2b05efa4413837b0292`, respectively in `/private/tmp/monotes-perf-baseline` and `/private/tmp/monotes-perf-current`. Both use identical installed dependencies and `next build --webpack`, followed by `next start -p 3109` or `-p 3110`. The benchmark does not use the active checkout’s changing runtime. Environment configuration is copied locally and is not printed or committed.

Run `bun scripts/benchmark-notes.ts` for five interleaved baseline/current pairs. The script measures 120 characters of keyboard input paced at 80 ms per character, input/keydown-to-next-animation-frame as a responsiveness proxy, total keyboard-driver wall time, and frame/long-task samples. Event-to-frame is not literal screen-paint latency; host-to-browser event queuing is reflected only in driver wall time. Every run verifies 200 stored rows, expected input-event counts, complete final stored text, the editor’s visible tail text, and no page exceptions.

Run `MONOTES_PERF_DIAGNOSTIC=1 MONOTES_PERF_RUNS=1 bun scripts/benchmark-notes.ts` separately to collect renderer CPU profiles for both tabs, full-content sidebar regex calls/characters/duration, and IndexedDB write/cursor-step/index-query counts. Diagnostic times are excluded from the repeated timing sample.

Initial machine reading: 10 logical cores (Apple M5), load averages 5.84 / 5.84 / 6.36. Chrome, Xcode build, and other Node work were using CPU. Unrelated user work was not stopped. Runs alternate sides, began after the coordinated Monotes build/tests finished, and record load for every run. External CPU contention remains a limitation.

A setup error initially began a webpack build in the active checkout. It was canceled during compilation without source edits, immediately reported to the root agent, and the root agent rebuilt its production runtime before using it. Both benchmark builds then ran with explicit isolated working directories.

## Repeated timing evidence

All five interleaved runs per side produced 200 rows, exactly 120 input events, the exact 20,607-character final note, and no page exceptions. Both tabs had zero 50 ms long tasks throughout all ten runs.

| Metric | Original baseline | d330819 |
| --- | --- | --- |
| Median run p95 input-to-next-frame | 15.5 ms | 15.9 ms |
| Range of run p95s | 15.1–15.7 ms | 15.6–16.0 ms |
| Median keyboard-driver wall time | 10,592.9 ms | 10,241.9 ms |
| Driver wall-time range | 10,574.9–10,612.8 ms | 10,223.1–10,278.5 ms |

The 0.4 ms p95 shift is smaller than the baseline run range, and both sides remain within a 16.7 ms animation frame. An exact two-sided rank permutation test nevertheless detects the small ordering shift (`p=0.01587`); these distributions are not claimed to be identical. The metric is dominated by the phase between paced input and the 60 Hz frame clock, and does not establish a visible regression. Driver wall times have an exact rank-test `p=0.00794`, but no speedup is claimed: they include Playwright dispatch and the explicit 9,600 ms pacing floor, and are not unpaced editor throughput. `savedMs` includes correctness polling and must not be read as exact commit latency.

## Separate work and profile evidence

These are one diagnostic run per side, excluded from the repeated timing samples.

| Work during 120 typed characters | Baseline | d330819 |
| --- | --- | --- |
| Active-tab IndexedDB puts | 1 | 120 |
| Sidebar index-query starts per tab | 1 | 120 |
| Cursor steps per tab | 200 | 24,000 |
| Long-content preview regex calls per tab | 200 | 24,000 |
| Characters passed to that regex per tab | 4,096,126 | 491,528,082 |
| Wrapped regex duration, active / idle tab | 5.1 ms / 8.6 ms | 759.2 ms / 725.3 ms |

The exact regex (`/[^\s\n]+/g`) occurs in `src/components/notes/notes-sidebar.tsx:188`; the diagnostic counts only that pattern on strings of at least 19,000 characters. `useLocalNote.setMarkdown` calls `persist` on each edit; `saveNote` writes the note, invalidating the sidebar’s `orderBy('updatedAt').reverse().toArray()` subscription in both tabs. Correct final stored output and measured cursor/scan/write counts establish that this extra work actually happened.

The separate Chromium CPU profiles corroborate counter timing: current active/idle profiles sample about 674 ms / 594 ms cumulatively under the instrumented `String.match`, compared with 5 ms / 9 ms baseline. It is the largest named JavaScript self-time hotspot in the current profiles. Most sampled wall time remains renderer idle (about 8.35 s of 11.44 s active, and 9.27 s of 11.35 s idle). Scans add CPU work but do not exhaust the event/frame budget on this machine.

About 983 million ASCII characters were scanned across both tabs over roughly 11.4 s (86 million characters/second aggregate), consistent with in-memory processing. This is not measured disk throughput or network traffic. Removing this scan cannot support a claim of doubled end-to-end typing speed because explicit input pacing alone consumes 9.6 s.

## Scope and disposition

This is a bounded desktop finding on a 10-core Apple M5 with headless Chromium, two isolated tabs, a 3.9 MiB synthetic library, default Vim insert mode, and 120 characters paced at 80 ms per key (12.5 characters/second, roughly 150 words/minute at five characters/word), under the recorded system contention. It does not prove responsiveness on older hardware, physical mobile devices, larger libraries, or different input patterns. Profiles and counters may perturb absolute CPU cost. Work multipliers are measured; energy use and battery impact are not.

No application changes were made by this investigation. A minimal preview optimization, if separately selected and verified, would replace full-content `.match(...).slice(0, 20)` with `.trim().split(/\s+/, 20)` before joining. It preserves the 20-word preview while stopping word extraction at the limit, but does not address full-library IndexedDB reads. Persistence coalescing would need further durability and acknowledgement-race verification. The root agent selected that narrow preview correction based on the measured CPU amplification; the completed follow-up comparison in `bounded-preview/` preserves this historical result and verifies its bounded claim.

Artifacts: `timing.json` contains all ten runs and load readings; `summary.json` contains medians, ranges, and exact small-sample rank statistics; `diagnostic.json` contains work counters; four `.cpuprofile` files and `profile-summary.json` contain separate profiler evidence. Both snapshot build logs and server logs are retained. Root was notified when the quiet measurement window ended. All temporary benchmark servers were stopped after the follow-up investigation; the root agent’s server was left running.

Default reruns now write to ignored `.audit/overnight/latest/perf-review` so the preserved evidence is not overwritten. Set `MONOTES_PERF_DIR` explicitly to keep another comparison; use the explicit variables in the bounded-preview README for the follow-up pair. The output-default change does not alter timing, workload, or assertions.
