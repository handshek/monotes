import { describe, expect, it } from "vitest";
import { ChangeSet, EditorState, Text } from "@codemirror/state";
import { collab, getSyncedVersion, receiveUpdates, sendableUpdates } from "@codemirror/collab";
import {
  composeDescs,
  lateHumanOverlap,
  parseVersionToken,
  rebaseSubmitted,
  replaceAll,
  replay,
  resolveAgentEdits,
  staleEditConflicts,
  toText,
  type AcceptedUpdate,
} from "../../convex/lib/collabCore";

const insert = (doc: Text, from: number, text: string) => ChangeSet.of({ from, insert: text }, doc.length);

describe("agent edit resolution", () => {
  const base = toText("# Plan\n\n## Testing\nTBD\n\n## Notes\nTBD\n");

  it("resolves a unique exact replacement", () => {
    const result = resolveAgentEdits(base, [{ type: "replace", old: "## Testing\nTBD", new: "## Testing\n- unit" }]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.changes.apply(base).toString()).toContain("## Testing\n- unit\n");
  });

  it("rejects ambiguous and missing passages instead of guessing", () => {
    expect(resolveAgentEdits(base, [{ type: "replace", old: "TBD", new: "x" }])).toMatchObject({ ok: false, code: "ambiguous" });
    expect(resolveAgentEdits(base, [{ type: "replace", old: "absent", new: "x" }])).toMatchObject({ ok: false, code: "not_found" });
  });

  it("rejects overlapping edits within one request", () => {
    const result = resolveAgentEdits(base, [
      { type: "replace", old: "## Testing\nTBD", new: "a" },
      { type: "replace", old: "Testing", new: "b" },
    ]);
    expect(result).toMatchObject({ ok: false, code: "overlapping_edits" });
  });

  it("appends a section on a new line", () => {
    const doc = toText("Intro");
    const result = resolveAgentEdits(doc, [{ type: "append", text: "## Added\nBody" }]);
    expect(result.ok && result.changes.apply(doc).toString()).toBe("Intro\n## Added\nBody");
  });

  it("normalises CRLF in agent text", () => {
    const doc = toText("a\nb\n");
    const result = resolveAgentEdits(doc, [{ type: "replace", old: "a\r\nb", new: "x\r\ny" }]);
    expect(result.ok && result.changes.apply(doc).toString()).toBe("x\ny\n");
  });
});

describe("stale agent edits", () => {
  const base = toText("alpha\nbeta\ngamma\n");
  const edit = resolveAgentEdits(base, [{ type: "replace", old: "gamma", new: "GAMMA" }]);
  if (!edit.ok) throw new Error("setup");

  it("accepts a stale edit that does not touch newer changes", () => {
    const human = insert(base, 0, "typed ");
    expect(staleEditConflicts(edit.ranges, human.desc)).toBe(false);
    const merged = edit.changes.map(human.desc).apply(human.apply(base)).toString();
    expect(merged).toBe("typed alpha\nbeta\nGAMMA\n");
  });

  it("rejects a stale edit overlapping a newer change", () => {
    const human = ChangeSet.of({ from: 11, to: 13, insert: "GA" }, base.length);
    expect(staleEditConflicts(edit.ranges, human.desc)).toBe(true);
  });

  it("treats an insertion at the edited boundary as a conflict", () => {
    const human = insert(base, 16, "!");
    expect(staleEditConflicts(edit.ranges, human.desc)).toBe(true);
  });
});

describe("reconstruction", () => {
  it("replays forward from a checkpoint and refuses gaps", () => {
    const v0 = toText("one");
    const u1 = insert(v0, 3, " two");
    const v1 = u1.apply(v0);
    const u2 = insert(v1, 7, " three");
    const updates: AcceptedUpdate[] = [
      { version: 1, clientId: "c_aaaaaaaa", seq: 1, changes: u1 },
      { version: 2, clientId: "c_aaaaaaaa", seq: 2, changes: u2 },
    ];
    expect(replay(v0, 0, updates, 2)?.toString()).toBe("one two three");
    expect(replay(v0, 0, [updates[1]], 2)).toBeNull();
  });

  it("builds a trimmed whole-text replacement", () => {
    const doc = toText("keep start middle keep end");
    const changes = replaceAll(doc, "keep start CHANGED keep end");
    expect(changes.apply(doc).toString()).toBe("keep start CHANGED keep end");
    let touched = 0;
    changes.iterChangedRanges((fromA, toA) => (touched += toA - fromA));
    expect(touched).toBe("middle".length);
  });

  it("parses version tokens strictly", () => {
    expect(parseVersionToken("0f6b6c1e-1a2b-4c3d-8e9f-001122334455.42")).toEqual({
      epoch: "0f6b6c1e-1a2b-4c3d-8e9f-001122334455",
      version: 42,
    });
    expect(parseVersionToken("abc.1")).toBeNull();
    expect(parseVersionToken("0f6b6c1e-1a2b-4c3d-8e9f-001122334455.-1")).toBeNull();
  });
});

/* A minimal in-memory authority using the same rebase rule as the server. */
class Authority {
  doc: Text;
  updates: AcceptedUpdate[] = [];
  lastSeq = new Map<string, number>();
  constructor(text: string) {
    this.doc = toText(text);
  }
  get version() {
    return this.updates.length;
  }
  push(clientId: string, baseVersion: number, submitted: { seq: number; changes: ChangeSet }[]) {
    const over = this.updates.slice(baseVersion);
    const baseLength = composeDescs(over)?.length ?? this.doc.length;
    const result = rebaseSubmitted(clientId, baseLength, submitted, over, this.lastSeq.get(clientId) ?? 0);
    if (!result.ok) return result;
    for (const update of result.accepted) {
      this.doc = update.changes.apply(this.doc);
      this.updates.push({ version: this.updates.length + 1, clientId, seq: update.seq, changes: update.changes });
      this.lastSeq.set(clientId, update.seq);
    }
    return result;
  }
}

/* A collab client that numbers its updates the way the browser session does. */
class Client {
  state: EditorState;
  confirmedSeq = 0;
  constructor(readonly id: string, text: string) {
    this.state = EditorState.create({ doc: text, extensions: [collab({ clientID: id, startVersion: 0 })] });
  }
  type(random: () => number) {
    const length = this.state.doc.length;
    const from = Math.floor(random() * (length + 1));
    const to = random() < 0.3 ? Math.min(length, from + Math.floor(random() * 4)) : from;
    const insertText = random() < 0.8 ? String.fromCharCode(97 + Math.floor(random() * 26)) : "\n";
    this.state = this.state.update({ changes: { from, to, insert: insertText } }).state;
  }
  outbox() {
    return sendableUpdates(this.state).map((update, index) => ({
      seq: this.confirmedSeq + index + 1,
      changes: update.changes,
    }));
  }
  receive(authority: Authority) {
    const from = getSyncedVersion(this.state);
    const updates = authority.updates.slice(from);
    if (!updates.length) return;
    this.confirmedSeq += updates.filter((update) => update.clientId === this.id).length;
    this.state = receiveUpdates(
      this.state,
      updates.map((update) => ({ changes: update.changes, clientID: update.clientId })),
    ).state;
  }
}

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

describe("convergence with lost acknowledgements and duplicate pushes", () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])("converges for seed %i", (seed) => {
    const random = seeded(seed);
    const authority = new Authority("start\n");
    const clients = [new Client("c_client0001", "start\n"), new Client("c_client0002", "start\n"), new Client("c_client0003", "start\n")];
    for (let step = 0; step < 400; step++) {
      const client = clients[Math.floor(random() * clients.length)];
      const action = random();
      if (action < 0.5) client.type(random);
      else if (action < 0.85) {
        const outbox = client.outbox();
        if (outbox.length) {
          const result = authority.push(client.id, getSyncedVersion(client.state), outbox);
          expect(result.ok).toBe(true);
          // Sometimes the acknowledgement is lost and the same batch is sent again.
          if (random() < 0.3) expect(authority.push(client.id, getSyncedVersion(client.state), outbox).ok).toBe(true);
        }
      } else client.receive(authority);
    }
    for (let round = 0; round < 3; round++) {
      for (const client of clients) {
        const outbox = client.outbox();
        if (outbox.length) authority.push(client.id, getSyncedVersion(client.state), outbox);
        client.receive(authority);
      }
    }
    for (const client of clients) {
      client.receive(authority);
      expect(sendableUpdates(client.state)).toHaveLength(0);
      expect(client.state.doc.toString()).toBe(authority.doc.toString());
    }
  });

  it("rejects a client whose queue disagrees with accepted history", () => {
    const authority = new Authority("x");
    const doc = toText("x");
    authority.push("c_client0001", 0, [{ seq: 1, changes: insert(doc, 1, "a") }]);
    const result = authority.push("c_client0001", 0, [{ seq: 2, changes: insert(doc, 1, "b") }]);
    expect(result).toMatchObject({ ok: false, code: "client_state_mismatch" });
  });

  it("rejects an update with the wrong document length", () => {
    const authority = new Authority("abc");
    const result = authority.push("c_client0001", 0, [{ seq: 1, changes: ChangeSet.of({ from: 0, insert: "z" }, 10) }]);
    expect(result).toMatchObject({ ok: false, code: "invalid_update" });
  });
});

describe("late human overlap detection", () => {
  it("flags delayed human text that lands inside an agent change", () => {
    const base = toText("aaa bbb ccc");
    const agent = ChangeSet.of({ from: 4, to: 7, insert: "BBB" }, base.length);
    const human = ChangeSet.of({ from: 5, to: 6, insert: "x" }, base.length).map(agent.desc);
    const over: AcceptedUpdate[] = [{ version: 1, clientId: "agent:1", seq: 0, changes: agent }];
    expect(lateHumanOverlap(over, [{ seq: 1, changes: human }], (id) => id.startsWith("agent:"))).toBe(true);
    const elsewhere = insert(base, 0, "y").map(agent.desc);
    expect(lateHumanOverlap(over, [{ seq: 1, changes: elsewhere }], (id) => id.startsWith("agent:"))).toBe(false);
  });
});
