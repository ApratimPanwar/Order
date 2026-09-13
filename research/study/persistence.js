/**
 * Transactional session persistence with a single-active-tab policy.
 *
 * WHY THIS EXISTS
 *
 * The previous compare-and-swap on a revision counter was not sufficient.
 * `getItem` then `setItem` is not a transaction: two tabs can both read the
 * same revision, then both write, and both pass the check. The loser's rating
 * is lost. Even when the check does fire, the refused tab had no recovery path.
 * A forced withdrawal from a stale tab could also replace a newer session with
 * fewer rows.
 *
 * TWO MECHANISMS, BOTH REQUIRED
 *
 * 1. `commit()` is a genuine critical section. Where the Web Locks API exists
 *    it holds an exclusive named lock across the read-modify-write, so the
 *    interleaving above cannot occur. The mutator is handed the LATEST stored
 *    state, never a stale in-memory copy, so a write can never drop rows it
 *    never saw.
 *
 * 2. A single-active-tab lease. Only the owning tab may record. A second tab
 *    enters read-only mode and says so. This is the policy-level guarantee for
 *    browsers without Web Locks, and it keeps the failure mode safe and
 *    visible rather than silent.
 *
 * ERASURE leaves a tombstone so a suspended tab cannot resurrect erased rows.
 */

export const STORAGE_KEY = 'order-blind-rating/session';
export const LEASE_KEY = 'order-blind-rating/lease';
export const TOMBSTONE_KEY = 'order-blind-rating/erased';
export const LOCK_NAME = 'order-blind-rating-session';

/** How long a lease stays valid without a heartbeat. */
export const LEASE_TTL_MS = 15000;
export const LEASE_HEARTBEAT_MS = 5000;

export class PersistenceError extends Error {
  constructor(code, message) { super(message ?? code); this.name = 'PersistenceError'; this.code = code; }
}

function randomId() {
  const r = new Uint8Array(8);
  (globalThis.crypto ?? { getRandomValues: (a) => a.forEach((_, i) => { a[i] = Math.floor(Math.random() * 256); }) })
    .getRandomValues(r);
  return [...r].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class SessionStore {
  /**
   * @param {object} opts
   * @param {Storage|null} opts.storage
   * @param {() => number} [opts.now]
   * @param {object|null} [opts.locks] Web Locks manager, or null to force the lease path
   */
  constructor({ storage, now = () => Date.now(), locks } = {}) {
    this.storage = storage ?? null;
    this.now = now;
    this.tabId = randomId();
    this.locks = locks === undefined
      ? (typeof navigator !== 'undefined' && navigator.locks ? navigator.locks : null)
      : locks;
  }

  get available() { return this.storage !== null; }
  get hasExclusiveLocks() { return this.locks !== null; }

  // --- raw access ----------------------------------------------------------

  #readRaw() {
    if (!this.storage) return null;
    try { return this.storage.getItem(STORAGE_KEY); } catch { return null; }
  }

  #writeRaw(text) {
    if (!this.storage) throw new PersistenceError('storage-unavailable');
    this.storage.setItem(STORAGE_KEY, text);
  }

  /** Parsed stored state, or `{ ok:false, reason }`. Never throws. */
  read() {
    if (!this.storage) return { ok: false, reason: 'storage-unavailable' };
    const raw = this.#readRaw();
    if (raw === null) return { ok: false, reason: 'no-saved-session' };
    try { return { ok: true, state: JSON.parse(raw), raw }; }
    catch { return { ok: false, reason: 'corrupt-saved-session', raw }; }
  }

  // --- erasure tombstone ---------------------------------------------------

  isErased() {
    try { return this.storage?.getItem(TOMBSTONE_KEY) !== null && this.storage?.getItem(TOMBSTONE_KEY) !== undefined; }
    catch { return false; }
  }

  /** Removes the session and records a tombstone so it cannot be written back. */
  erase(participantId) {
    if (!this.storage) return { ok: false, reason: 'storage-unavailable' };
    try {
      this.storage.removeItem(STORAGE_KEY);
      this.storage.setItem(TOMBSTONE_KEY, JSON.stringify({
        participantId: participantId ?? null, erasedAt: new Date(this.now()).toISOString(),
      }));
      this.releaseLease();
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: 'storage-write-failed', detail: String(e?.message ?? e) };
    }
  }

  // --- single-active-tab lease --------------------------------------------

  readLease() {
    if (!this.storage) return null;
    try {
      const raw = this.storage.getItem(LEASE_KEY);
      return raw === null ? null : JSON.parse(raw);
    } catch { return null; }
  }

  /** True when no live lease exists or this tab already holds it. */
  canClaim() {
    const lease = this.readLease();
    if (!lease) return true;
    if (lease.tabId === this.tabId) return true;
    return this.now() > lease.expiresAt;
  }

  claimLease() {
    if (!this.storage) return { ok: false, reason: 'storage-unavailable' };
    if (!this.canClaim()) {
      const lease = this.readLease();
      return { ok: false, reason: 'another-tab-active', heldBy: lease?.tabId, expiresAt: lease?.expiresAt };
    }
    try {
      this.storage.setItem(LEASE_KEY, JSON.stringify({ tabId: this.tabId, expiresAt: this.now() + LEASE_TTL_MS }));
      return { ok: true, tabId: this.tabId };
    } catch (e) {
      return { ok: false, reason: 'storage-write-failed', detail: String(e?.message ?? e) };
    }
  }

  renewLease() {
    const lease = this.readLease();
    if (lease && lease.tabId !== this.tabId && this.now() <= lease.expiresAt) {
      return { ok: false, reason: 'another-tab-active' };
    }
    return this.claimLease();
  }

  isOwner() {
    const lease = this.readLease();
    return Boolean(lease && lease.tabId === this.tabId && this.now() <= lease.expiresAt);
  }

  releaseLease() {
    try {
      const lease = this.readLease();
      if (lease && lease.tabId === this.tabId) this.storage?.removeItem(LEASE_KEY);
    } catch { /* ignore */ }
  }

  // --- the transactional primitive ----------------------------------------

  /**
   * Runs `fn` inside an exclusive critical section.
   * Web Locks where available; otherwise the lease is the exclusion policy.
   */
  async withLock(fn) {
    if (this.locks && typeof this.locks.request === 'function') {
      return this.locks.request(LOCK_NAME, { mode: 'exclusive' }, async () => fn());
    }
    return fn();
  }

  /**
   * Read-modify-write as one transaction.
   *
   * `mutator(latestStateOrNull)` receives the LATEST stored state and returns
   * the state to write, or `null` to write nothing. Because the mutator always
   * sees current data, a commit can never silently drop rows written by another
   * tab between this tab's last read and this write.
   *
   * @param {(state:object|null)=>object|null} mutator
   * @param {{requireOwnership?:boolean, allowErased?:boolean}} [opts]
   */
  async commit(mutator, { requireOwnership = true, allowErased = false } = {}) {
    if (!this.storage) return { ok: false, reason: 'storage-unavailable' };
    return this.withLock(() => {
      if (!allowErased && this.isErased()) {
        return { ok: false, reason: 'session-erased' };
      }
      if (requireOwnership && !this.isOwner()) {
        const claimed = this.claimLease();
        if (!claimed.ok) return { ok: false, reason: 'not-active-tab', detail: claimed.reason };
      }
      const current = this.read();
      const latest = current.ok ? current.state : null;
      if (!current.ok && current.reason === 'corrupt-saved-session') {
        // Corrupt data is NEVER destroyed automatically. The caller decides.
        return { ok: false, reason: 'corrupt-saved-session', raw: current.raw };
      }
      let next;
      try { next = mutator(latest); } catch (e) {
        return { ok: false, reason: 'mutator-failed', detail: String(e?.message ?? e) };
      }
      if (next === null || next === undefined) return { ok: true, written: false, state: latest };
      try {
        this.#writeRaw(JSON.stringify(next));
        return { ok: true, written: true, state: next };
      } catch (e) {
        return { ok: false, reason: 'storage-write-failed', detail: String(e?.message ?? e) };
      }
    });
  }

  /**
   * Moves corrupt data aside instead of deleting it, so a participant's work is
   * recoverable by a researcher rather than destroyed by the app.
   */
  quarantineCorrupt() {
    const cur = this.read();
    if (cur.ok || cur.reason !== 'corrupt-saved-session') return { ok: false, reason: 'nothing-to-quarantine' };
    const key = `${STORAGE_KEY}/corrupt-${new Date(this.now()).toISOString().replace(/[:.]/g, '-')}`;
    try {
      this.storage.setItem(key, cur.raw);
      this.storage.removeItem(STORAGE_KEY);
      return { ok: true, quarantineKey: key, bytes: cur.raw.length };
    } catch (e) {
      return { ok: false, reason: 'storage-write-failed', detail: String(e?.message ?? e) };
    }
  }

  /** Lists quarantined blobs so a recovery path exists and is discoverable. */
  listQuarantined() {
    if (!this.storage) return [];
    const out = [];
    try {
      for (let i = 0; i < this.storage.length; i++) {
        const k = this.storage.key(i);
        if (k && k.startsWith(`${STORAGE_KEY}/corrupt-`)) out.push({ key: k, bytes: (this.storage.getItem(k) ?? '').length });
      }
    } catch { /* ignore */ }
    return out;
  }
}

/* ---------------------------------------------------------------------------
 * ENVIRONMENT PROBE
 *
 * The participant release requires BOTH mechanisms to be genuinely working,
 * not merely present as properties:
 *
 *   - persistent storage must round-trip a value, because an answer that is
 *     not written is an answer that is lost on reload;
 *   - the Web Locks API must actually grant a lock, because the lease alone is
 *     a policy, not a critical section, and the lease-only path has Node tests
 *     but no browser evidence.
 *
 * Both are probed by USE, not by feature detection. `navigator.locks` exists
 * and throws in some sandboxed and non-secure contexts; `localStorage` exists
 * and throws under "block all cookies" and in Safari private mode.
 * ------------------------------------------------------------------------- */

export const PROBE_KEY = 'order-blind-rating/probe';
export const PROBE_LOCK = `${LOCK_NAME}-probe`;
export const PROBE_TIMEOUT_MS = 4000;

/** Probes localStorage by round-tripping a value and removing it again. */
export function probeStorage(storage) {
  if (!storage) return { ok: false, reason: 'no-storage-object' };
  const token = `probe-${randomId()}`;
  try {
    storage.setItem(PROBE_KEY, token);
    const back = storage.getItem(PROBE_KEY);
    storage.removeItem(PROBE_KEY);
    if (back !== token) return { ok: false, reason: 'value-did-not-round-trip' };
    if (storage.getItem(PROBE_KEY) !== null) return { ok: false, reason: 'removal-ignored' };
    return { ok: true };
  } catch (e) {
    try { storage.removeItem(PROBE_KEY); } catch { /* nothing further to do */ }
    return { ok: false, reason: 'threw', detail: String(e && e.name ? e.name : e) };
  }
}

/** Probes the Web Locks API by actually acquiring an exclusive lock. */
export async function probeLocks(locks, { timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  if (!locks || typeof locks.request !== 'function') return { ok: false, reason: 'api-absent' };
  let granted = false;
  try {
    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new PersistenceError('lock-probe-timeout')), timeoutMs);
    });
    await Promise.race([
      locks.request(PROBE_LOCK, { mode: 'exclusive' }, async () => { granted = true; }),
      timeout,
    ]);
  } catch (e) {
    return { ok: false, reason: e && e.code === 'lock-probe-timeout' ? 'timed-out' : 'threw',
      detail: String(e && e.name ? e.name : e) };
  }
  return granted ? { ok: true } : { ok: false, reason: 'callback-never-ran' };
}

/**
 * The startup gate. `strict: true` is the participant-release requirement:
 * if either mechanism fails, the caller must show an unsupported-environment
 * message and must NOT start recording.
 */
export async function probeEnvironment({ storage, locks, strict = true, timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  const checks = {
    persistentStorage: probeStorage(storage),
    webLocks: await probeLocks(locks, { timeoutMs }),
  };
  const missing = Object.entries(checks).filter(([, v]) => !v.ok).map(([k]) => k);
  return { ok: missing.length === 0, strict, checks, missing };
}
