# Bounded preview follow-up

Pre-measurement claim: replacing full-content word extraction with a 20-word split will remove full-body preview regex work and reduce its CPU cost while preserving the sidebar’s first 20 words. This does not eliminate full-library IndexedDB reads. No end-to-end typing speedup is claimed.

Comparison: reviewed persistence implementation `d3308196207778ebc13ab2b05efa4413837b0292` on port 3110 against bounded-preview commit `8a44e4c82c410c9f5ce92b294bdb522d58a1fadd` on port 3111. Both are immutable Git archives using identical installed dependencies, `next build --webpack`, and `next start`. The newer commit also contains the independently verified save-acknowledgement correction, so any total timing change must not be attributed solely to word extraction. The diagnostic isolates word-extraction work directly.

The original baseline-versus-d330819 evidence in the parent directory is preserved. Follow-up results use explicit metadata and are not pooled with the earlier measurements. The timing protocol is unchanged: five interleaved pairs, 200 notes of 20 KiB each, two fresh-context tabs, 120 keyboard characters at an 80 ms pacing delay, exact input/stored-output assertions, page exceptions, frame timing, and long tasks. Root runs the actual sidebar-preview correctness test independently before and after changing source.

Diagnostic instrumentation version 2 adds counters and duration around long-string `.split(/\s+/, 20)` calls. This is enabled symmetrically on both follow-up sides, only during the separate diagnostic pair. It does not claim that the full input string was scanned by the bounded operation. Prior diagnostic times must not be pooled with these new counters.

Run the timed comparison after both production snapshots are started and the coordinated build/test work is idle:

```sh
MONOTES_PERF_DIR=.audit/overnight/perf-review/bounded-preview \
MONOTES_PERF_BASELINE=http://127.0.0.1:3110 \
MONOTES_PERF_CURRENT=http://127.0.0.1:3111 \
MONOTES_PERF_BASELINE_SHA=d3308196207778ebc13ab2b05efa4413837b0292 \
MONOTES_PERF_CURRENT_SHA=8a44e4c82c410c9f5ce92b294bdb522d58a1fadd \
MONOTES_PERF_BASELINE_LABEL='reviewed persistence implementation' \
MONOTES_PERF_CURRENT_LABEL='bounded preview correction' \
MONOTES_PERF_CLAIM='Bounded sidebar preview extraction removes full-body regex work while preserving first 20 words; no typing-speed claim.' \
bun scripts/benchmark-notes.ts
```

Run the same command with `MONOTES_PERF_DIAGNOSTIC=1 MONOTES_PERF_RUNS=1` for the separate diagnostic pair. Results and limitations follow below.


## Result

The bounded claim is verified: full-content preview matches disappear, the replacement executes exactly 24,000 bounded splits per tab, and the isolated extraction cost is much smaller. There is no measured end-to-end typing improvement in the five repeated pairs.

| Metric | Reviewed d330819 | Bounded 8a44e4c |
| --- | --- | --- |
| Full-content matches per tab, diagnostic run | 24,000 | 0 |
| Bounded 20-word splits per tab, diagnostic run | 0 | 24,000 |
| Extraction duration, active / idle tab, diagnostic run | 735.8 ms / 724.8 ms | 11.5 ms / 11.9 ms |
| Full-library index-query starts per tab | 120 | 120 |
| Active-tab note writes | 120 | 120 |
| Median run p95 input-to-next-frame | 15.8 ms | 15.7 ms |
| Range of run p95s | 15.6–16.0 ms | 15.6–15.8 ms |
| Median keyboard-driver duration | 10,262.5 ms | 10,236.1 ms |
| Driver duration range | 10,219.2–10,293.3 ms | 10,196.6–10,345.1 ms |

All ten timed runs and both separate diagnostic runs verify 200 notes, exactly 120 input events, exact final stored content, visible edited text, and no page exceptions. Neither tab records a 50 ms long task in any run. The input-frame difference is smaller than the variation (exact rank permutation p=0.357); driver duration also shows no difference beyond variation (p=1.0). Explicit 80 ms per-character pacing and the 60 Hz frame clock remain the end-to-end limits.

The independent CPU sample profiles support the reduced extraction cost. In the reviewed build, instrumented `String.match` totals approximately 618 ms active and 597 ms idle in cumulative samples, and is the largest named JavaScript self-time hotspot. It disappears from the bounded build’s profile. All instrumented `String.split` sample stacks combined total about 19 ms active and 15 ms idle after the change; this includes any unrelated split calls, while the targeted duration counters above count only long-string preview splits with limit 20. The remaining application work includes IndexedDB result handling, React rendering, and garbage collection. Full-library reads and writes still happen on every character.

The extraction durations are observations from one separate diagnostic pair, not five-run CPU estimates or an overall speedup. They cannot support a promise of faster typing or lower battery use. The earlier M5, headless-browser, synthetic-library, contention, frame-proxy, and lack-of-physical-mobile limitations still apply. The newer commit also contains the save-acknowledgement correction, so only the directly instrumented extraction change is attributed here.

Both benchmark servers (3110 and 3111) were stopped after measurement. Root’s server on 3107 was left running. The raw reports, logs, four profiles, and build provenance remain local for review.

Recreate the statistical and profile summary, with assertions checking run count, output counts/lengths, errors, profile count, and comparison provenance:

```sh
python3 .audit/overnight/perf-review/analyze.py .audit/overnight/perf-review/bounded-preview
```
