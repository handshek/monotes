"""Summarize one completed paired benchmark directory without touching app state."""
from collections import Counter
from itertools import combinations
from pathlib import Path
import json
import statistics
import sys

root = Path(sys.argv[1])
data = json.loads((root / 'timing.json').read_text())
rows = data['results']
expected_runs = data.get('runsPerSide', 5)
assert len(rows) == expected_runs * 2
for side in ('baseline', 'current'):
    selected = [r for r in rows if r['side'] == side]
    assert sorted(r['run'] for r in selected) == list(range(1, expected_runs + 1))
for row in rows:
    assert not row.get('failed') and row['errors'] == []
    assert row['active']['inputs'] == data['typedCharacters']
    assert row['active']['keydowns'] == data['typedCharacters']
    assert row['verifiedNoteCount'] == data['noteCount']
    assert row['verifiedContentLength'] == data['noteBytes'] + len(' warmup') + data['typedCharacters']

summary = {}
for name, getter in {
    'inputFrameP95': lambda r: r['active']['inputToFrame']['p95'],
    'typingMs': lambda r: r['typingMs'],
}.items():
    a = [getter(r) for r in rows if r['side'] == 'baseline']
    b = [getter(r) for r in rows if r['side'] == 'current']
    pool = a + b
    observed = sum(x > y for x in b for y in a) + 0.5 * sum(x == y for x in b for y in a)
    us = []
    center = len(a) * len(b) / 2
    for positions in combinations(range(len(pool)), len(b)):
        chosen = set(positions)
        x = [v for i, v in enumerate(pool) if i in chosen]
        y = [v for i, v in enumerate(pool) if i not in chosen]
        us.append(sum(p > q for p in x for q in y) + 0.5 * sum(p == q for p in x for q in y))
    pvalue = sum(abs(u - center) >= abs(observed - center) - 1e-9 for u in us) / len(us)
    summary[name] = {
        'baseline': {'runs': a, 'median': statistics.median(a), 'range': [min(a), max(a)]},
        'current': {'runs': b, 'median': statistics.median(b), 'range': [min(b), max(b)]},
        'exactTwoSidedRankPermutationP': pvalue,
        'currentU': observed,
    }
(root / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')

profiles = {}
for path in sorted(root.glob('*.cpuprofile')):
    profile = json.loads(path.read_text())
    nodes = {n['id']: n for n in profile['nodes']}
    self_time, cumulative = Counter(), Counter()
    parents = {child: n['id'] for n in profile['nodes'] for child in n.get('children', [])}
    for sample, delta in zip(profile.get('samples', []), profile.get('timeDeltas', [])):
        self_time[sample] += delta
        cursor = sample
        while cursor in nodes:
            cumulative[cursor] += delta
            if cursor not in parents:
                break
            cursor = parents[cursor]

    def describe(node_id, microseconds):
        frame = nodes[node_id]['callFrame']
        return {'name': frame['functionName'], 'url': frame['url'], 'line': frame['lineNumber'] + 1,
                'column': frame['columnNumber'] + 1, 'ms': round(microseconds / 1000, 2)}

    profiles[path.name] = {
        'durationMs': (profile['endTime'] - profile['startTime']) / 1000,
        'sampledMs': sum(self_time.values()) / 1000,
        'topSelf': [describe(i, t) for i, t in self_time.most_common(20)],
        'previewMethodsCumulative': [describe(i, cumulative[i]) for i, n in nodes.items()
                                     if n['callFrame']['functionName'] in ('String.match', 'String.split')],
    }
assert len(profiles) == 4
(root / 'profile-summary.json').write_text(json.dumps(profiles, indent=2) + '\n')
diagnostic = json.loads((root / 'diagnostic.json').read_text())
assert diagnostic['diagnostic'] is True
assert diagnostic['baseline'] == data['baseline'] and diagnostic['current'] == data['current']
assert len(diagnostic['results']) == 2
assert all(not r.get('failed') and not r['errors'] for r in diagnostic['results'])
print(json.dumps({'timing': summary, 'profiles': len(profiles), 'verifiedTimingRuns': len(rows),
                  'diagnostic': [{key: r[key] for key in ('side', 'active', 'idle')} for r in diagnostic['results']]}, indent=2))
