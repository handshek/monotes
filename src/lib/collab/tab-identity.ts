/*
 * Each tab is its own collaboration client for a note. Its id survives a
 * reload of the same tab through sessionStorage, and a Web Lock held for the
 * tab's lifetime proves the owner is alive. Duplicating a tab copies
 * sessionStorage, so an id is only reused when its lock is free.
 *
 * Without the Web Locks API there is no safe way to tell a closed tab from a
 * live one: every load then gets a fresh id and other queues are offered for
 * manual review instead of being replayed.
 */

const SESSION_KEY = "monotes-collab-client:";
const PREVIOUS_LOCK_ATTEMPTS = 6;
const PREVIOUS_LOCK_WAIT_MS = 150;

export interface ClientIdentity {
  clientId: string;
  locksAvailable: boolean;
  release(): void;
}

function lockName(noteId: string, clientId: string) {
  return `monotes-collab:${noteId}:${clientId}`;
}

export function newClientId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `c_${Array.from(bytes, (byte) => byte.toString(36).padStart(2, "0")).join("").slice(0, 20)}`;
}

function locks(): LockManager | null {
  return typeof navigator !== "undefined" && navigator.locks && typeof navigator.locks.request === "function"
    ? navigator.locks
    : null;
}

function readSessionId(noteId: string): string | null {
  try {
    const value = sessionStorage.getItem(SESSION_KEY + noteId);
    return value && /^c_[A-Za-z0-9_-]{8,64}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

function writeSessionId(noteId: string, clientId: string) {
  try {
    sessionStorage.setItem(SESSION_KEY + noteId, clientId);
  } catch {
    // A fresh id is used next time; that is always safe.
  }
}

/* Hold a lock until released. Resolves false when another holder has it. */
function holdLock(manager: LockManager, name: string): Promise<{ held: boolean; release: () => void }> {
  return new Promise((resolve) => {
    let release = () => {};
    const held = new Promise<void>((done) => {
      release = done;
    });
    manager
      .request(name, { ifAvailable: true }, async (lock) => {
        if (!lock) {
          resolve({ held: false, release: () => {} });
          return;
        }
        resolve({ held: true, release });
        await held;
      })
      .catch(() => resolve({ held: false, release: () => {} }));
  });
}

/*
 * `canReuse` says whether this tab's previous id still has a stored queue.
 * Without one the server may already hold updates under that id, so a new
 * id is always taken rather than restarting its sequence numbers.
 */
export async function claimClientId(noteId: string, canReuse: (clientId: string) => boolean): Promise<ClientIdentity> {
  const manager = locks();
  if (!manager) {
    const clientId = newClientId();
    return { clientId, locksAvailable: false, release: () => {} };
  }
  const previous = readSessionId(noteId);
  if (previous && canReuse(previous)) {
    // On reload the old page may release its lock a moment after this page
    // starts; wait briefly before treating the id as taken by another tab.
    for (let attempt = 0; attempt < PREVIOUS_LOCK_ATTEMPTS; attempt++) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, PREVIOUS_LOCK_WAIT_MS));
      const lock = await holdLock(manager, lockName(noteId, previous));
      if (lock.held) return { clientId: previous, locksAvailable: true, release: lock.release };
    }
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const clientId = newClientId();
    const lock = await holdLock(manager, lockName(noteId, clientId));
    if (lock.held) {
      writeSessionId(noteId, clientId);
      return { clientId, locksAvailable: true, release: lock.release };
    }
  }
  throw new Error("Couldn't establish an identity for this tab");
}

/*
 * Run `work` while holding another client's lock, only if that client is not
 * alive. Returns false without running when the lock is held.
 */
export async function withOrphanLock(noteId: string, clientId: string, work: () => Promise<void>): Promise<boolean> {
  const manager = locks();
  if (!manager) return false;
  const lock = await holdLock(manager, lockName(noteId, clientId));
  if (!lock.held) return false;
  try {
    await work();
    return true;
  } finally {
    lock.release();
  }
}
