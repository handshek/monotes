/*
 * Pure collaboration protocol shared by Convex functions and the browser.
 *
 * Accepted history is a sequence of CodeMirror change sets. Version N is the
 * text after the first N accepted updates. A change set records insertions
 * and deleted lengths, not deleted text, so historical text can only be
 * rebuilt forwards from a stored checkpoint.
 */
import { ChangeDesc, ChangeSet, Text } from "@codemirror/state";

export const MAX_NOTE_CHARS = 200_000;
// Updates one stored batch may hold (Convex arrays allow 8,192 elements).
// Clients send far fewer normally; the higher cap lets a paste and the edits
// that undo or shorten it be sent together.
export const MAX_PUSH_UPDATES = 1_000;
export const CLIENT_PUSH_UPDATES = 200;
// Byte budgets. A stored batch is one Convex document (1 MiB limit), so its
// serialized changes stay well below that, leaving room for the other
// fields. Clients aim lower so mapping over newer changes can't push a
// batch over the server's limit. A 200,000-character note is at most
// 600 KB of UTF-8, so a single change that writes a whole note fits unless
// most of it needs JSON escaping.
export const MAX_STEP_BATCH_BYTES = 900 * 1024;
export const CLIENT_PUSH_BATCH_BYTES = 512 * 1024;
// Ceiling for a batch extended to bring the note back under its length
// limit, with headroom for mapping over newer changes on the server.
export const CLIENT_EXTENDED_BATCH_BYTES = MAX_STEP_BATCH_BYTES - 64 * 1024;
export const MAX_PUSH_ARG_BYTES = 4 * 1024 * 1024;
const STORED_UPDATE_OVERHEAD_BYTES = 32;
export const MAX_CATCHUP_VERSIONS = 5_000;
export const CHECKPOINT_INTERVAL = 200;
export const MAX_AGENT_EDITS = 50;
export const MAX_AGENT_BODY_BYTES = 256 * 1024;
export const STEPS_PAGE_SIZE = 100;
export const STEPS_PAGE_BYTES = 1024 * 1024;
// Bounds on stored history read by one transaction.
export const MAX_HISTORY_ROWS = 4_000;
export const MAX_HISTORY_BYTES = 6 * 1024 * 1024;

const CLIENT_ID_PATTERN = /^c_[A-Za-z0-9_-]{8,64}$/;

export function isHumanClientId(clientId: string): boolean {
  return CLIENT_ID_PATTERN.test(clientId);
}

export function agentClientId(connectionId: string): string {
  return `agent:${connectionId}`;
}

export const RESTORE_CLIENT_ID = "server:restore";

/* Match CodeMirror's default line splitting so lengths agree everywhere. */
export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

export function toText(text: string): Text {
  return Text.of(normalizeLineEndings(text).split("\n"));
}

export function parseChanges(json: string): ChangeSet | null {
  try {
    return ChangeSet.fromJSON(JSON.parse(json));
  } catch {
    return null;
  }
}

export function serializeChanges(changes: ChangeSet): string {
  return JSON.stringify(changes.toJSON());
}

/* UTF-8 length of a string without allocating its encoding. */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

/* Bytes a stored update occupies, counting its serialized changes. */
export function storedUpdateBytes(serializedChanges: string): number {
  return utf8Length(serializedChanges) + STORED_UPDATE_OVERHEAD_BYTES;
}

export interface AcceptedUpdate {
  version: number; // version reached after applying this update
  clientId: string;
  seq: number;
  changes: ChangeSet;
}

export interface SubmittedUpdate {
  seq: number;
  changes: ChangeSet;
}

/* Apply accepted updates after `fromVersion`, up to and including `toVersion`. */
export function replay(
  base: Text,
  fromVersion: number,
  updates: readonly AcceptedUpdate[],
  toVersion: number,
): Text | null {
  let doc = base;
  let version = fromVersion;
  for (const update of updates) {
    if (update.version <= fromVersion) continue;
    if (update.version > toVersion) break;
    if (update.version !== version + 1) return null;
    if (update.changes.length !== doc.length) return null;
    doc = update.changes.apply(doc);
    version = update.version;
  }
  return version === toVersion ? doc : null;
}

export type RebaseResult =
  | { ok: true; accepted: SubmittedUpdate[]; skipped: number }
  | { ok: false; code: "client_state_mismatch" | "invalid_update" };

/*
 * Rebase a client's unconfirmed updates over everything accepted since its
 * base version. Updates the server already accepted from this client are
 * recognised by sequence number and dropped, so a retry after a lost
 * acknowledgement never applies text twice.
 */
export function rebaseSubmitted(
  clientId: string,
  baseLength: number,
  submitted: readonly SubmittedUpdate[],
  over: readonly AcceptedUpdate[],
  lastAcceptedSeq: number,
): RebaseResult {
  try {
    let length = baseLength;
    for (const update of submitted) {
      if (update.changes.length !== length) return { ok: false, code: "invalid_update" };
      length = update.changes.newLength;
    }
    let mapping: ChangeDesc | null = null;
    let skip = 0;
    for (const update of over) {
      if (update.clientId === clientId) {
        const mine = submitted[skip];
        if (!mine || mine.seq !== update.seq) return { ok: false, code: "client_state_mismatch" };
        if (mapping) mapping = mapping.mapDesc(mine.changes, true);
        skip++;
      } else {
        mapping = mapping ? mapping.composeDesc(update.changes.desc) : update.changes.desc;
      }
    }
    const remaining = submitted.slice(skip);
    let expectedSeq = lastAcceptedSeq + 1;
    for (const update of remaining) {
      if (update.seq !== expectedSeq) return { ok: false, code: "client_state_mismatch" };
      expectedSeq++;
    }
    const accepted: SubmittedUpdate[] = [];
    for (const update of remaining) {
      if (!mapping) {
        accepted.push(update);
        continue;
      }
      const changes = update.changes.map(mapping);
      mapping = mapping.mapDesc(update.changes, true);
      accepted.push({ seq: update.seq, changes });
    }
    return { ok: true, accepted, skipped: skip };
  } catch {
    return { ok: false, code: "invalid_update" };
  }
}

type Range = { from: number; to: number };

function touches(a: Range, b: Range): boolean {
  return a.from <= b.to && a.to >= b.from;
}

function mapRange(range: Range, changes: ChangeDesc): Range {
  const from = changes.mapPos(range.from, -1);
  const to = changes.mapPos(range.to, 1);
  return { from, to: Math.max(from, to) };
}

function changedRangesBefore(changes: ChangeDesc): Range[] {
  const ranges: Range[] = [];
  changes.iterChangedRanges((fromA, toA) => ranges.push({ from: fromA, to: toA }));
  return ranges;
}

function changedRangesAfter(changes: ChangeDesc): Range[] {
  const ranges: Range[] = [];
  changes.iterChangedRanges((_fromA, _toA, fromB, toB) => ranges.push({ from: fromB, to: toB }));
  return ranges;
}

/*
 * Detect whether delayed human updates landed in or beside text that an
 * agent changed after the human's base version. Convergence still happens;
 * this only decides whether to keep a pre-merge copy and flag the note.
 */
export function lateHumanOverlap(
  over: readonly AcceptedUpdate[],
  accepted: readonly SubmittedUpdate[],
  isAgent: (clientId: string) => boolean,
): boolean {
  let agentRanges: Range[] = [];
  for (const update of over) {
    agentRanges = agentRanges.map((range) => mapRange(range, update.changes.desc));
    if (isAgent(update.clientId)) agentRanges.push(...changedRangesAfter(update.changes.desc));
  }
  if (!agentRanges.length) return false;
  for (const update of accepted) {
    for (const range of changedRangesBefore(update.changes.desc)) {
      if (agentRanges.some((agentRange) => touches(agentRange, range))) return true;
    }
    agentRanges = agentRanges.map((range) => mapRange(range, update.changes.desc));
  }
  return false;
}

export type AgentEdit =
  | { type: "replace"; old: string; new: string }
  | { type: "append"; text: string };

export type AgentEditFailure =
  | { code: "not_found"; index: number }
  | { code: "ambiguous"; index: number; matches: number }
  | { code: "overlapping_edits"; index: number }
  | { code: "too_large" };

export type ResolvedAgentEdits =
  | { ok: true; changes: ChangeSet; ranges: Range[] }
  | ({ ok: false } & AgentEditFailure);

function countMatches(haystack: string, needle: string): { first: number; count: number } {
  let first = -1;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    if (first === -1) first = index;
    count++;
    if (count > 1) break;
    index = haystack.indexOf(needle, index + 1);
  }
  return { first, count };
}

/*
 * Resolve exact replacements and appends against one base text. Every
 * replacement must match exactly once; nothing is guessed.
 */
export function resolveAgentEdits(base: Text, edits: readonly AgentEdit[]): ResolvedAgentEdits {
  const baseString = base.toString();
  const specs: { from: number; to: number; insert: string; index: number }[] = [];
  let appends = 0;
  for (const [index, edit] of edits.entries()) {
    if (edit.type === "replace") {
      const old = normalizeLineEndings(edit.old);
      const { first, count } = countMatches(baseString, old);
      if (count === 0) return { ok: false, code: "not_found", index };
      if (count > 1) return { ok: false, code: "ambiguous", index, matches: count };
      specs.push({ from: first, to: first + old.length, insert: normalizeLineEndings(edit.new), index });
    } else {
      appends++;
      if (appends > 1) return { ok: false, code: "overlapping_edits", index };
      let text = normalizeLineEndings(edit.text);
      if (baseString.length > 0 && !baseString.endsWith("\n") && !text.startsWith("\n")) {
        text = `\n${text}`;
      }
      specs.push({ from: base.length, to: base.length, insert: text, index });
    }
  }
  specs.sort((a, b) => a.from - b.from || a.to - b.to);
  for (let i = 1; i < specs.length; i++) {
    if (specs[i].from < specs[i - 1].to || specs[i].from === specs[i - 1].from) {
      return { ok: false, code: "overlapping_edits", index: specs[i].index };
    }
  }
  const changes = ChangeSet.of(
    specs.map(({ from, to, insert }) => ({ from, to, insert })),
    base.length,
  );
  if (changes.newLength > MAX_NOTE_CHARS) return { ok: false, code: "too_large" };
  return { ok: true, changes, ranges: specs.map(({ from, to }) => ({ from, to })) };
}

/*
 * Decide whether an agent request based on an older version may be applied.
 * Any newer accepted change that overlaps or touches an edited range,
 * including an insertion at its boundary, is a conflict.
 */
export function staleEditConflicts(ranges: readonly Range[], intervening: ChangeDesc | null): boolean {
  if (!intervening) return false;
  const changed = changedRangesBefore(intervening);
  return ranges.some((range) => changed.some((other) => touches(range, other)));
}

export function composeDescs(updates: readonly AcceptedUpdate[]): ChangeDesc | null {
  let composed: ChangeDesc | null = null;
  for (const update of updates) {
    composed = composed ? composed.composeDesc(update.changes.desc) : update.changes.desc;
  }
  return composed;
}

/* A minimal replacement from one full text to another, trimmed at both ends. */
export function replaceAll(from: Text, target: string): ChangeSet {
  const current = from.toString();
  const next = normalizeLineEndings(target);
  let start = 0;
  const limit = Math.min(current.length, next.length);
  while (start < limit && current.charCodeAt(start) === next.charCodeAt(start)) start++;
  let endCurrent = current.length;
  let endNext = next.length;
  while (endCurrent > start && endNext > start && current.charCodeAt(endCurrent - 1) === next.charCodeAt(endNext - 1)) {
    endCurrent--;
    endNext--;
  }
  return ChangeSet.of(
    start === endCurrent && start === endNext ? [] : [{ from: start, to: endCurrent, insert: next.slice(start, endNext) }],
    from.length,
  );
}

export function formatVersionToken(epoch: string, version: number): string {
  return `${epoch}.${version}`;
}

export function parseVersionToken(token: string): { epoch: string; version: number } | null {
  const match = /^([A-Za-z0-9-]{8,64})\.(\d{1,12})$/.exec(token);
  if (!match) return null;
  const version = Number(match[2]);
  return Number.isSafeInteger(version) ? { epoch: match[1], version } : null;
}

export function noteTitle(content: string): string {
  const line = content.split("\n").find((candidate) => candidate.trim()) ?? "";
  const title = line.replace(/^#+\s*/, "").trim();
  return title.length > 80 ? `${title.slice(0, 79)}…` : title || "Untitled note";
}
