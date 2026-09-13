/**
 * Persistence interface + local adapters.
 *
 * COLLECTION IS NOT READY. No server endpoint has been chosen or approved, so
 * the only modes available are local autosave and manual export. `PilotExport`
 * exists to make that limitation explicit rather than implicit: it refuses to
 * pretend a submission happened.
 *
 * No participant records and no secrets live in this repository.
 */

export const STORAGE_INTERFACE_VERSION = 'storage-1';

/**
 * The interface any future server adapter must satisfy.
 * @typedef {{
 *   save(key: string, record: object): Promise<{ok:boolean, receipt?:object, error?:string}>,
 *   load(key: string): Promise<object|null>,
 *   list(): Promise<string[]>,
 *   remove(key: string): Promise<boolean>,
 *   readonly mode: string,
 *   readonly collectionReady: boolean
 * }} StorageAdapter
 */

/** In-memory adapter. Used by tests and by Node-side tooling. */
export class MemoryStorage {
  #map = new Map();
  mode = 'memory';
  collectionReady = false;

  async save(key, record) {
    this.#map.set(key, JSON.parse(JSON.stringify(record)));
    return { ok: true, receipt: makeReceipt(key, record, this.mode) };
  }
  async load(key) {
    const v = this.#map.get(key);
    return v === undefined ? null : JSON.parse(JSON.stringify(v));
  }
  async list() {
    return [...this.#map.keys()];
  }
  async remove(key) {
    return this.#map.delete(key);
  }
}

/**
 * Browser localStorage adapter with autosave. Every read and write is guarded:
 * storage can be unavailable (private windows, blocked site data) and must not
 * take the editor down with it.
 */
export class LocalStorageAdapter {
  mode = 'localStorage';
  collectionReady = false;

  constructor({ prefix = 'order-research/', storage } = {}) {
    this.prefix = prefix;
    this.storage = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  }

  get available() {
    try {
      if (!this.storage) return false;
      const probe = `${this.prefix}__probe`;
      this.storage.setItem(probe, '1');
      this.storage.removeItem(probe);
      return true;
    } catch {
      return false;
    }
  }

  async save(key, record) {
    try {
      this.storage.setItem(this.prefix + key, JSON.stringify(record));
      return { ok: true, receipt: makeReceipt(key, record, this.mode) };
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) };
    }
  }

  async load(key) {
    try {
      const raw = this.storage.getItem(this.prefix + key);
      return raw === null ? null : JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async list() {
    try {
      const out = [];
      for (let i = 0; i < this.storage.length; i++) {
        const k = this.storage.key(i);
        if (k && k.startsWith(this.prefix)) out.push(k.slice(this.prefix.length));
      }
      return out;
    } catch {
      return [];
    }
  }

  async remove(key) {
    try {
      this.storage.removeItem(this.prefix + key);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Export-only pilot mode. Every save() succeeds locally and returns a receipt
 * that states plainly that nothing was transmitted.
 */
export class PilotExport {
  mode = 'export-only';
  collectionReady = false;
  #inner;

  constructor(inner = new MemoryStorage()) {
    this.#inner = inner;
  }

  async save(key, record) {
    const res = await this.#inner.save(key, record);
    return {
      ...res,
      receipt: {
        ...res.receipt,
        transmitted: false,
        note:
          'Stored locally only. No collection endpoint is configured or approved; ' +
          'centralized collection is NOT ready. Export manually to retain this record.',
      },
    };
  }
  load(key) { return this.#inner.load(key); }
  list() { return this.#inner.list(); }
  remove(key) { return this.#inner.remove(key); }
}

function makeReceipt(key, record, mode) {
  return {
    key,
    mode,
    storageInterfaceVersion: STORAGE_INTERFACE_VERSION,
    savedAt: new Date().toISOString(),
    byteLength: JSON.stringify(record).length,
  };
}

/**
 * Idempotent save. Re-submitting the same idempotencyKey does not create a
 * second record, so a reconnect cannot duplicate a submission.
 */
export async function saveOnce(adapter, idempotencyKey, record) {
  const existing = await adapter.load(idempotencyKey);
  if (existing !== null) {
    return { ok: true, duplicate: true, receipt: existing.__receipt ?? null };
  }
  const res = await adapter.save(idempotencyKey, { ...record, __receipt: makeReceipt(idempotencyKey, record, adapter.mode) });
  return { ...res, duplicate: false };
}

/** Autosave wrapper: debounced, failure-tolerant, reports status. */
export function createAutosave(adapter, key, { debounceMs = 500, scheduler = setTimeout } = {}) {
  let timer = null;
  let lastStatus = { state: 'idle' };
  return {
    get status() { return lastStatus; },
    schedule(getRecord) {
      if (timer) clearTimeout(timer);
      lastStatus = { state: 'pending' };
      timer = scheduler(async () => {
        try {
          const res = await adapter.save(key, getRecord());
          lastStatus = res.ok
            ? { state: 'saved', at: Date.now(), receipt: res.receipt }
            : { state: 'error', error: res.error };
        } catch (e) {
          lastStatus = { state: 'error', error: String(e) };
        }
      }, debounceMs);
    },
    async flush(getRecord) {
      if (timer) clearTimeout(timer);
      const res = await adapter.save(key, getRecord());
      lastStatus = res.ok ? { state: 'saved', at: Date.now(), receipt: res.receipt } : { state: 'error', error: res.error };
      return lastStatus;
    },
  };
}
