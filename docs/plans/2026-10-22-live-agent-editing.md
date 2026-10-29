# Live agent editing in Monotes

Proposed on 22 October 2026 after two completed discussion rounds with Claude Opus 5.5 through T3. This is a plan, not an implementation. No application files were changed and no tests were run for this planning task.

Checkout inspected: `/Users/abhi/dev/monotes`, branch `master`, HEAD `21febaf33a3fbf01972fc26a95169dc6edfcfe37`. The existing untracked `docs/research/` files were preserved. Claude confirmed the same checkout and commit and worked read-only.

[Claude discussion](t3-thread://v1/mcp:2c34aa8f-896a-4e5f-96fe-87bf7dca96c2)

## Product decision

Add one capability: a person and their existing coding agent can work in the same live Markdown note. The agent reads the note, makes targeted edits under a named identity, and its changes arrive while the person continues typing.

This borrows Scribe's human-agent collaboration model. Scribe documents an external agent integration through a skill and authenticated API, with version-aware writes and agent attribution. Monotes needs its own integration; Scribe's skill connects to Scribe. [Scribe agent documentation](https://scribe.skeptrune.com/docs/agents)

The first complete release must include concurrent editing. A read-only connection or a queue of suggested rewrites would not satisfy this plan. Regular use remains a product hypothesis, not a proven consequence of adding the feature.

### The experience

1. Create a note and type immediately, including with Vim.
2. Choose **Connect agent** on a note. If necessary, sign in. Explain that connecting stores this selected note in the user's Monotes cloud account and grants the chosen agent access. Other notes receive no grant.
3. Choose an existing named agent connection, or create one such as "Claude Code". Choose read or edit access for this note. A new connection gets a credential shown once and setup instructions for the Monotes skill.
4. In the existing agent conversation, say: "Read this Monotes note and add the testing section." The setup flow supplies the exact note reference, avoiding reliance on a unique title.
5. Continue typing elsewhere. The agent's edits appear without refreshing the page, resetting the cursor, or leaving Vim insert mode. A short highlight and activity entry identify the connection that made them.
6. Open **View changes** to compare the result with the checkpoint from before the agent edit. Copy earlier text or preview restoring that version.
7. Remove an agent's note grant or revoke its credential. Copying the note URL alone never grants access.

Monotes does not start the coding agent. Instructions still go through the agent the user already runs. Human edits become visible to the agent when it next reads the note; there is no automatic notification or promise that it continuously watches the document.

## Decisions for the first release

| Area | Decision |
| --- | --- |
| Storage | Enable collaboration explicitly on individual notes using the existing cloud service. Keep ordinary scratch notes on their existing path. |
| Editing | Keep CodeMirror and Vim. Use CodeMirror's collaboration package with Convex as the authority for connected notes. |
| Agent integration | An authenticated REST API and Monotes skill. First supported and manually verified clients are Claude Code and Codex. |
| Access | One named credential per agent connection, with explicit read or edit grants on individual notes. |
| Writes | Small, version-bound exact replacements and appends. Reject stale edits that overlap newer accepted edits. |
| Recovery | Checkpoints, comparisons, copying older text, and previewed restoration as a new revision. |
| History | Retain checkpoints and operations during a private beta, with bounded requests and supported note sizes. Implement retention and compaction before broad release. |

Defer embedded AI chat, model hosting and billing, agent scheduling, MCP, comments and suggestions, agent cursors, public publishing, human team collaboration, agent-created notes, and selective reversal of an arbitrary historical agent edit. These are separate additions rather than prerequisites for the chosen experience.

### What the current application needs

The inspected application uses CodeMirror, Dexie for browser storage, and optional Convex cloud uploads. Its editor currently receives whole-note values. Cloud updates replace the entire content and have no shared server revision. Existing local draft revisions handle browser persistence; they are not a collaboration protocol.

The cloud read hooks for opening and listing notes are not connected to the editor. Search can return cloud-only notes, but opening them currently consults local storage. Deletion currently removes only the local row. Connected notes therefore need cloud hydration, versioned updates and consistent deletion, in addition to an agent endpoint.

The main places affected are [the editor](/Users/abhi/dev/monotes/src/components/notes/notes-editor.tsx), [the sync engine](/Users/abhi/dev/monotes/src/lib/sync-engine.ts), and [the cloud note functions](/Users/abhi/dev/monotes/convex/notes.ts). Persistence, access controls and tests will need supporting modules.

## Engineering design

### One authority per connected note

For connected notes, Convex owns the accepted text and a monotonically increasing version within a collaboration epoch. Store accepted operations with stable identifiers and authenticated authors. Browser tabs keep local pending operations and a confirmed snapshot.

Use `@codemirror/collab` for the browser protocol and server rebasing. The spike must validate its use in the existing Convex runtime and Vim editor. Yjs is an alternative to reconsider only if this approach fails the acceptance gates; adding another sync provider is not the default.

For these notes, updates must enter the editor as transactions. Do not repeatedly replace the whole controlled `value` when remote content changes. Send small batches, apply ordered server updates, and preserve local selection and editor state. The Dexie note row used by search and the sidebar becomes a derived copy rather than an independent source of accepted changes.

CodeMirror documents central-authority collaboration helpers. Using those helpers with Convex, durable browser queues and an external agent API is our proposed design, not a verified integration. [CodeMirror reference](https://codemirror.net/docs/ref/#collab)

### Agent API

Expose stable routes under `/api/agent/v1` on the Monotes origin. Next.js handlers proxy narrowly defined requests to Convex HTTP actions. Preserve authentication and error responses, disable caching, and forward no browser cookies. The backend owns authorization and accepted edits. Convex supports HTTP actions that call its queries and mutations. [Convex HTTP actions](https://docs.convex.dev/functions/http-actions)

The minimum interface is:

- `GET /me` identifies the agent connection.
- `GET /notes`, optionally with a search query, lists only notes granted to it.
- `GET /notes/:id` returns Markdown and an opaque version token identifying the epoch and accepted version.
- `PATCH /notes/:id` accepts a version token, a stable request identifier and an array of edit operations.

An edit operation is either a replacement of an exact passage or an append. A replacement supplies the old text and new text. Old text must be nonempty and match exactly once in the stated base. Multiple replacements refer to that same base and must not overlap. An append refers to the end of that base. The agent never calculates character offsets.

Resolve operations against the historical base, then check intervening accepted operations before mapping ranges onto current text. Treat insertions at the same boundary conservatively as conflicts. Apply the entire request atomically or reject it. Repeated identical request identifiers return the previous outcome; reuse with a different payload is an error. Reject ambiguous matches rather than picking one.

A stale request that touches newer accepted work returns a conflict response requiring another read and a revised request. Missing base history also requires a fresh read. The skill must not retry a conflicting payload unchanged or normalize unrelated formatting. Provide a safe file-based payload example rather than shell interpolation of Markdown or credentials.

Agent creation and deletion of notes are outside this interface. The skill is guidance; backend checks must enforce every restriction even if an agent ignores it.

### Access and lifecycle

Store only hashes of random agent credentials. Derive authorship from the authenticated connection, never a caller-supplied name. The owner can rename and revoke a connection and manage its per-note read/edit grants.

Every list, search and read checks the credential and grant. Every write rechecks authorization in the same transaction that accepts the operation, preventing a request authorized before revocation from committing afterward. Agent credentials cannot grant themselves access or administer credentials. Bound request sizes and rates.

Connecting a note is an explicit transition with a server marker and initial checkpoint. Flush and preserve local drafts first. If existing cloud content differs, preserve both versions and show a comparison before the user chooses the starting text. Use a revision check so another update during that comparison cannot be silently replaced.

Every legacy whole-note write function must reject a connected note, including a request from an old open tab. The new client switches to the collaboration path and preserves any unconfirmed old-tab content for review. Do not migrate unrelated cloud notes as part of this release.

Removing a grant leaves the note in the cloud. Deleting a connected note tombstones it and removes grants through the versioned server path; late operations must not resurrect it. If deletion is requested offline, show it as pending until the server confirms it. Do not claim remote access has ended before that confirmation.

### Persistence, conflicts and recovery

Persist each tab's confirmed text/version, stable client identity and unconfirmed operations together in one Dexie transaction before sending those operations. Keep a recovery draft until durable local storage succeeds. A storage failure must remain visible; do not acknowledge it as saved.

Server batches commit atomically. Retrying after a lost acknowledgement must not duplicate operations, including a retry that contains an already accepted prefix and additional operations. Verify reconstructed client state and queued operation identity after reload rather than merely restoring a full-string buffer.

Each tab is a separate client. Use Web Locks to avoid two tabs claiming the same recovered client queue, including when duplicating a tab copies session storage. If queue ownership cannot be established, do not replay it automatically. Offer its text for manual review under a new client. An unavailable or failed session identity store must not make two clients share an identity.

Nonoverlapping delayed edits should combine. Overlapping edits that the server already knows about block the stale agent request. The server cannot check against typing still offline or unsubmitted. When late human operations cross agent-edited ranges, retain a copy of the user's pre-merge draft and flag the overlap for comparison. Convergence is not proof that the combined prose preserves both intentions.

Store the initial full checkpoint and all forward operations during the private beta. Save a full checkpoint before each accepted agent request and restoration, plus periodic checkpoints to bound reconstruction work. A change set and the current text alone cannot reconstruct deleted historical content. Paginate history and recovery reads. If catch-up exceeds the supported workload, preserve the local text as a recovery note instead of attempting an unbounded transaction or dropping it.

**View changes** compares an agent request's result with its preceding checkpoint. **Restore this version** requires a connected browser with all local pending work flushed, shows how current text will change, and checks the current server version again on acceptance. Save the current version first, then record restoration as a new authored revision. If anything changed after the preview, refresh the comparison rather than applying a stale restoration. This restores a whole version and can replace later work; the UI must say so.

Ordinary undo should remain scoped to local editing. Test Vim undo, repeat and visual mode under remote updates. Do not advertise one-click selective reversal of any agent change.

## Implementation milestones and acceptance gates

1. **Prove concurrent editing.** Build a disposable technical spike for two Vim-enabled browser tabs and an agent-shaped request through Convex. Prove reconstruction from checkpoints, rebasing, ambiguous-match rejection, overlap detection and duplicate-request handling. Check runtime compatibility and measure workloads before setting beta limits. If this fails, revisit the collaboration mechanism before building the rest of the interface.
2. **Build durable collaboration.** Implement the authority, atomic local queues, cloud hydration, editor transactions and recovery paths. Gate on reload before confirmation, commit with lost acknowledgement, offline reconnect, duplicated tabs, unavailable locks, storage failures and stale legacy uploads. Keep the ordinary scratch-note regression suite passing.
3. **Connect real agents.** Add credentials, per-note grants, versioned REST routes, connection/revocation controls and the opt-in transition. Test cross-account isolation, read-only grants, grant revocation during a write, diverging local/cloud content and tombstoned notes. Establish dedicated cloud test infrastructure without weakening production sign-in.
4. **Show changes and recovery.** Add agent labels, short-lived highlights, an activity view and checkpoint comparisons/restoration. Gate on preservation of cursor and Vim state, late-overlap notices, recovery copies and rejection of stale restore previews.
5. **Verify the complete experience.** Serve the Monotes skill and finish setup instructions. Run real Claude Code and Codex sessions against the deployed beta while a person types in another section. Verify network reachability and record any required host permissions. Run lint, type checking, production build, the existing browser suite and authenticated collaboration tests. Request the required read-only Claude implementation review after code is built.

The decisive demonstration is a person typing continuously in Vim while an agent adds a section based on an older read. Nonoverlapping edits must both arrive once, with named attribution, matching final text across clients and a working recovery comparison. An overlapping stale agent edit must fail safely.

## Limits and release decision

This is a substantial change to synchronization and persistence. Authentication routes and setup UI are the smaller part. A credible schedule requires the first milestone; this plan makes no development-time commitment.

The first complete release is a private beta. No history pruning occurs during that beta, so storage grows with accepted edits. Bound note sizes, batches, catch-up and reconstruction work using results from the spike and enforce those bounds before inviting testers. Retention and compaction are a separate required gate before general availability.

Current authenticated deployment configuration, testing credentials and real-agent connectivity have not been verified. The existing browser tests focus on local notes and do not establish cloud collaboration correctness. Use a separate test deployment for authenticated scenarios; any test-only auth mechanism must be absent from production.

Use actual planning, research or coding tasks in the beta. Record whether participants complete the connection, make successful agent edits and voluntarily reuse it on later tasks. A compelling demonstration justifies trying the capability; repeated use determines whether to expand it.

The first release does not promise automatic semantic conflict resolution, an agent that continuously watches changes, server-private cloud content, unlimited history, arbitrary selective undo, or compatibility with Scribe's own skill. It delivers a scoped way for a person and their chosen coding agent to work on a live Monotes note, with explicit access and recoverable changes.

## Implementation status

Implemented on 22 October 2026 in the working tree on top of `21febaf`. Nothing is committed, pushed, or deployed. The independent read-only Claude Opus review and follow-up checks are complete; see the final status below.

### What was built

- **Server authority.** `convex/collab.ts` and `convex/lib/` implement connected notes with an epoch and version, accepted batches of CodeMirror changes, and base checkpoints with their text stored separately. History reads are bounded by index range, row count, and bytes. Rebasing matches each client's updates by sequence number, so a resent batch is never applied twice. Delayed human typing that crosses an agent edit is flagged, and the writer's pre-merge text is kept. Legacy `syncNote` and `updateNote` reject connected notes, including tombstones.
- **Agent access.** `convex/agents.ts`, `convex/agentApi.ts`, and `convex/agentHttp.ts` provide:
  - named keys, generated server-side and stored as SHA-256 hashes;
  - per-note read or edit grants that only the signed-in owner can change;
  - grant-scoped listing, search, and reading.

  Edits are version-bound exact replacements and appends. Ambiguous matches and overlapping edits are refused, and so is a stale edit touching any newer change, including at its boundary. The connection, grant, and note are rechecked in the same transaction that commits an edit. A request id is replayed only while edit access still exists. Request bodies are read with a byte limit, and each key is rate-limited. `src/app/api/agent/v1/[...path]` and `src/lib/agent-proxy.ts` forward only the key and content type, with no cookies and no caching. Upstream calls time out after 15 seconds with a 504. The auth middleware excludes this path.
- **Browser session.** `src/lib/collab/` runs one collaboration client per tab:
  - its confirmed state and numbered queue are written atomically to Dexie before anything is sent;
  - a sessionStorage draft covers the gap before that write;
  - a tab's identity is reused only while its Web Lock is held;
  - another tab's queue is replayed only under that tab's lock, after re-reading the row, and only when it fits in one request;
  - without the Locks API, other queues are offered for review instead.

  `CollabNoteEditor` builds its own `EditorView` and applies remote changes only as transactions. Vim, settings, and `:w` work as in the local editor, and agent edits are highlighted under the agent's name. Opening fails visibly, with the saved text shown and a retry.
- **Interface.** The local editor is unchanged for ordinary notes. The UI adds:
  - **Agent access**: explanation, connecting with a comparison when copies differ, grants, and key creation with no-install setup steps;
  - **Changes**: activity, saved versions, comparison, and restore as a new revision checked against the previewed version;
  - **Kept text** for recovered text;
  - an `/agent-access` page;
  - opening cloud-only notes;
  - server-confirmed deletion of shared notes.
- **Skill.** `public/agent-skill/SKILL.md` is served by the app. Users are given a prompt that tells their agent to read it, so nothing is installed globally.

### Differences from the plan

- MCP remains deferred.
- Deleting a shared note requires online server confirmation. Offline deletion requests are not queued.
- The skill is served by the app rather than installed. A maintained installer can be added once a published source contains the skill.
- Backend tests use `convex-test` 0.0.41, the newest release compatible with Convex 1.25. It doesn't enforce Convex transaction limits, so those bounds are enforced by the code's own row and byte budgets.

### Verification

| Check | Result |
| --- | --- |
| `bun run typecheck`, `bun run lint` | Pass. Lint shows two warnings that predate this work. |
| `bun run test:unit` | 57 tests pass: protocol including randomised convergence, Convex backend, browser session in jsdom, and agent proxy. |
| `bun run test:e2e` | All 58 existing tests pass in desktop Chromium and mobile WebKit, including the production build. |
| `scripts/collab-e2e.sh` | 4 real-browser tests pass against a fresh local Convex backend. |

The browser tests cover:

- a person typing continuously in Vim insert mode while an agent replaces another section using an older version;
- typing that hasn't reached the server surviving a reload exactly once;
- a stale overlapping edit being refused, and access being removed;
- two tabs and an agent converging.

### Not verified

- Google sign-in.
- Deploying these functions to the project's Convex deployment and serving the agent API from it.
- Real Claude Code and Codex sessions reaching the API, including sandbox network permissions.
- Real-device mobile behaviour of the live editor.
- Retention and compaction, which are still required before broad release.

### Review follow-up

An independent review found no P1 issues, two P2 issues and five P3 issues. All were fixed on 22 October 2026, still uncommitted.

| Finding | Disposition |
| --- | --- |
| P2: size limits | Fixed. Connecting checks the chosen copy, cloud or local, before any write. Restore checks the target text and its stored batch before saving a checkpoint. An agent edit checks the merged result after mapping over newer typing, returning 413 with nothing written. |
| P2: full-text subscription | Fixed. `openInfo` returns metadata only and isn't subscribed once a note is connected. Text is fetched once with `openContent`. A failed fetch or local write shows **Try again** and never creates an empty note. |
| P3: flush | Fixed. Push and pull share in-flight promises, so a call during a run triggers another run. `flush` waits up to 3 seconds for the server to accept and confirm, and returns immediately offline. Requests in flight keep running afterwards. Restore still refuses a stale preview. |
| P3: unreadable queue | Fixed. The tab takes a fresh client id before starting again, and the old text is kept. |
| P3: deletion copy | Fixed. A guard set before any wait ensures exactly one kept copy. |
| P3: receipt size | Fixed. Successful receipts store the applied count and resulting version, never note text. A replay returns that receipt with the current authorized note. Receipts older than a day are pruned, 20 per request; a later retry of an applied edit overlaps its own change and is refused. Checkpoints keep full text on purpose during the beta. |
| P3: UTF-8 batch size | Fixed. Server and client limits count serialized UTF-8 bytes. The client sends byte-bounded batches, and the server answers `batch_too_large`, `too_large` or a thrown error. A full 200,000-character CJK note fits. Repeated server failures stop sending, show **Try again**, and keep a copy. |

Uncertainties raised in the review:

- **Reload lock race:** mitigated. A reloading tab waits up to about a second for its previous lock. Drafts under another id in the same tab are kept, and orphaned queues are retried once after 5 seconds.
- **Unbounded listing reads:** fixed. Agent listing pages ten grants at a time with a cursor. The owner's key list reads only grants, which now store the note id, and gets titles from the browser's copies.
- **Legacy note deletion:** unchanged, as decided.

After the fixes, these checks pass:

| Check | Result |
| --- | --- |
| `bun run typecheck`, `bun run lint` | Pass; lint shows the same two earlier warnings. |
| `bun run test:unit` | 77 tests pass. |
| `scripts/collab-e2e.sh` | 5 browser tests pass, including Vim undo and redo after an agent edit, and the second-device failure-and-retry case. |
| `bun run test:e2e` | All 58 existing tests pass. |

The browser harness no longer logs its throwaway auth keys.

### Final follow-up: over-long notes

The follow-up review confirmed all seven fixes and found no P1 or P2 issues. It raised one P3: any `too_large` blocked sending for good, even when a person pasted over the limit and then undid or shortened the paste.

The fix separates the cases:

- **Note too long.** The server now returns `note_too_long` when a batch's end result exceeds 200,000 characters. Only the end result is checked, so a paste and its undo can be accepted together.
- **Batch choice.** The client tracks each queued update's resulting length and size. When the ordinary batch (512 KiB, 200 updates) would leave the note too long, it extends the batch to the first point where the note fits again. The extended batch stays within the server's budgets: 836 KiB, and 1,000 updates per stored batch, well under Convex's array limit. Sequence numbers never change; only how many updates are sent.
- **Waiting.** If no such point exists yet, the client waits and shows "shorten this note". A later local edit, or newer text from the server, retries automatically. When the server refuses a queue as too long because of other people's text, the client waits until the queue or confirmed text changes.
- **Truly blocked.** A single change too large for any stored batch is blocked locally, before any send, as `too_large`. A note that only fits again past the extended budgets is blocked as `queue_too_large`. Both keep a copy under Kept text and offer to start again from the shared note.
- **Restore.** A restore that can't go ahead now names the actual reason instead of always asking for a connection.

New tests cover:

- an over-limit ASCII paste then undo, and a CJK paste larger than an ordinary batch then shortened, each converging without a restart;
- waiting caused by other people's text, then resuming;
- an unsendable single change leading to kept text and a restart;
- the honest `queue_too_large` case;
- the server accepting a paste together with its undo.

Results after this fix:

| Check | Result |
| --- | --- |
| `bun run typecheck`, `bun run lint` | Pass; lint shows the same two earlier warnings. |
| `bun run test:unit` | 83 tests pass. |
| `scripts/collab-e2e.sh` | 5 browser tests pass, including the production build. |
| `bun run test:e2e` | Not rerun; this fix doesn't touch the local-note flow, and the last run passed all 58. |

Separate verification by the orchestrating session matched these results:

- 83 unit tests pass, type checking passes and `git diff --check` is clean;
- the collaboration browser report shows 5 of 5 passing, with nothing flaky, skipped or failed;
- the existing browser report shows 58 of 58 passing.

**Status:** implementation and independent review are complete. The final read-only Claude Opus review confirmed the over-long-note fix and found no new correctness, regression or security issues. It also confirmed that sequence numbers, retry deduplication and history read limits still hold. The earlier seven findings are resolved. The reviewer ran 77 unit tests in the preceding review; the final 83-test result and browser results were verified by the author and orchestrating session. Nothing is committed, pushed or deployed.

Review record: [Monotes agent editing independent Opus review](t3-thread://v1/mcp:ce7f919e-8bfa-4c12-a7ca-aae77cb7dc5d). Production sign-in, deployment and real Claude Code/Codex setup still need a beta smoke test; history retention and compaction remain a gate before broad release.
