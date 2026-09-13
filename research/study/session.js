/**
 * Blind-rating session: state machine, persistence, recovery, export.
 *
 * NO COLLECTION MECHANISM IS APPROVED. This module has no network transport of
 * any kind. `exportRecord()` produces a file the participant downloads; a
 * download is a LOCAL SAVE and is never described as a submission.
 *
 * Three independent flags per trial, per V1-SPECIFICATION §10:
 *   scoreAvailable    - can the model score this stimulus? (filled offline)
 *   trialValid        - was the trial completed under valid conditions?
 *   analysisEligible  - { modelAgreement, ratingOnly }
 * A rating stays valid when the model cannot score the layout: trialValid stays
 * true and analysisEligible.ratingOnly stays true, only modelAgreement goes false.
 */

export const SESSION_FORMAT = 'rating-session-3';

/**
 * WITHDRAWAL POLICY (enforced, not merely recorded).
 *
 * On withdrawal every response by that participant becomes ineligible for ALL
 * analysis - both model-agreement and rating-only. The data is retained in the
 * local export so the withdrawal is auditable, but each response carries
 * `exclusionRule: 'X2-withdrawn'` and `analysisEligible` all-false, and the
 * export is stamped so a downstream join cannot reinstate it.
 *
 * Retention-without-eligibility is the conservative reading: a participant who
 * stops has not consented to their partial data being analysed, and silently
 * keeping it eligible would be the wrong default. `erase()` removes it outright.
 */
export const WITHDRAWAL_POLICY = Object.freeze({
  id: 'withdrawal-policy-1',
  onWithdraw: 'all responses become analysis-ineligible (model-agreement AND rating-only)',
  retention: 'responses retained in the local export for audit, flagged X2-withdrawn',
  erasure: 'erase() removes responses entirely and clears local storage',
});

/** Typed errors so callers can distinguish a rejected transition from a bug. */
export class SessionError extends Error {
  constructor(code, message) { super(message ?? code); this.name = 'SessionError'; this.code = code; }
}

export const RATING_BOUNDS = Object.freeze({ min: 1, max: 7, commentMaxLength: 2000 });
export const INSTRUMENT_VERSION = 'blind-rating-0.1.0-development';
export const INSTRUCTIONS_VERSION = 'instructions-2';
export const ACKNOWLEDGEMENT_VERSION = 'acknowledgement-2';
export const RELEASE_STATUS = 'DEVELOPMENT PILOT - NOT A DATA COLLECTION RELEASE';

/**
 * Release mode comes from the frozen release package, never from this file.
 * `development` marks everything produced as rehearsal data that must be kept
 * out of the study dataset; `participant` is only ever set by a package built
 * from a recorded approval record.
 */
export const RELEASE_MODES = Object.freeze({
  development: Object.freeze({ mode: 'development', dataClass: 'development-rehearsal' }),
  participant: Object.freeze({ mode: 'participant', dataClass: 'study-data' }),
});
export const DEFAULT_RELEASE_MODE = 'development';

import { SessionStore, STORAGE_KEY as STORE_KEY, PersistenceError } from './persistence.js';

const STORAGE_KEY = STORE_KEY;

/** Deterministic PRNG so presentation order is reproducible from the seed. */
export function createRng(seedInput) {
  let a = typeof seedInput === 'number' ? seedInput >>> 0 : hashString(String(seedInput));
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** Fisher-Yates with a seeded RNG. Same seed -> same order, always. */
export function reproducibleOrder(ids, seed) {
  const rng = createRng(seed);
  const out = [...ids];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Pseudonymous id. No name, email, IP or device fingerprint is collected. */
export function newParticipantId() {
  const r = new Uint8Array(8);
  (globalThis.crypto ?? { getRandomValues: (a) => a.forEach((_, i) => { a[i] = Math.floor(Math.random() * 256); }) })
    .getRandomValues(r);
  return `p-${[...r].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export class RatingSession {
  /** Revision last synchronised with storage; the CAS baseline. */
  #baseRevision = 0;

  constructor(state, baseRevision) {
    this.state = state;
    this.#baseRevision = baseRevision ?? (Number.isInteger(state?.revision) ? state.revision : 0);
  }

  static create({ manifest, orderSeed, participantId, releasePackage } = {}) {
    const pid = participantId ?? newParticipantId();
    const ids = manifest.items.map((i) => i.stimulusId);
    const seed = orderSeed ?? pid; // reproducible from the participant id alone
    return new RatingSession({
      sessionFormat: SESSION_FORMAT,
      instrumentVersion: INSTRUMENT_VERSION,
      instructionsVersion: INSTRUCTIONS_VERSION,
      acknowledgementVersion: ACKNOWLEDGEMENT_VERSION,
      releaseStatus: RELEASE_STATUS,
      manifestVersion: manifest.manifestVersion,
      // Frozen identity binding (B). A reusable label such as 'stimuli-1'
      // survives a rebuild that changes every stimulus, so the CONTENT DIGEST
      // is what an export is bound to.
      releasePackageId: releasePackage?.packageId ?? null,
      releasePackageDigest: releasePackage?.packageDigest ?? null,
      // An unmarked package is development by default. A rehearsal can never
      // be promoted to study data by omission (deployment item 26).
      releaseMode: RELEASE_MODES[releasePackage?.releaseMode] ? releasePackage.releaseMode : DEFAULT_RELEASE_MODE,
      dataClass: (RELEASE_MODES[releasePackage?.releaseMode] ?? RELEASE_MODES[DEFAULT_RELEASE_MODE]).dataClass,
      // The approved return channel, verbatim from the package. Never invented
      // here: a null channel means the participant has not been told where to
      // send the file, and the interface must say exactly that.
      returnChannel: releasePackage?.returnChannel ?? null,
      participantId: pid,
      orderSeed: String(seed),
      order: reproducibleOrder(ids, seed),
      startedAt: new Date().toISOString(),
      acknowledged: false,
      acknowledgedAt: null,
      withdrawn: false,
      withdrawnAt: null,
      index: 0,
      responses: {},
      status: 'created',
      revision: 0,
      withdrawalPolicy: WITHDRAWAL_POLICY.id,
    });
  }

  acknowledge() {
    if (this.state.withdrawn) throw new SessionError('withdrawn', 'cannot acknowledge after withdrawal');
    if (this.state.status === 'erased') throw new SessionError('erased', 'cannot acknowledge an erased session');
    if (this.state.acknowledged) return; // idempotent
    this.state.acknowledged = true;
    this.state.acknowledgedAt = new Date().toISOString();
    this.state.status = 'in-progress';
    this.state.revision += 1;
  }

  get currentStimulusId() {
    return this.state.order[this.state.index] ?? null;
  }

  get complete() {
    return this.state.index >= this.state.order.length;
  }

  get progress() {
    return { current: Math.min(this.state.index + 1, this.state.order.length), total: this.state.order.length };
  }

  /**
   * Records one rating. `integrityOk` comes from the app after re-hashing the
   * loaded stimulus; a mismatch marks the trial invalid but still keeps the
   * response, so a corrupt asset is visible rather than silently dropped.
   */
  record(stimulusId, { order: perceivedOrder, appeal, confidence, comment, integrityOk, shownAt, stimulusIntegrity } = {}) {
    // --- transition validity (F3) -----------------------------------------
    if (!this.state.acknowledged) {
      throw new SessionError('not-acknowledged', 'a rating cannot be recorded before acknowledgement');
    }
    if (this.state.withdrawn) {
      throw new SessionError('withdrawn', 'a rating cannot be recorded after withdrawal');
    }
    if (this.state.status === 'erased') {
      throw new SessionError('erased', 'a rating cannot be recorded into an erased session');
    }
    if (this.complete) {
      throw new SessionError('complete', 'the session has no remaining trials');
    }
    // Stale or out-of-order submission: the id must be the trial on screen.
    if (stimulusId !== this.currentStimulusId) {
      throw new SessionError('stale-trial',
        `expected ${this.currentStimulusId}, got ${stimulusId}`);
    }
    // Duplicate submission for a stimulus already answered.
    if (Object.prototype.hasOwnProperty.call(this.state.responses, stimulusId)) {
      throw new SessionError('duplicate-response', `${stimulusId} has already been rated`);
    }
    // --- rating validity ---------------------------------------------------
    const { min, max, commentMaxLength } = RATING_BOUNDS;
    const okRating = (v) => Number.isInteger(v) && v >= min && v <= max;
    if (!okRating(perceivedOrder)) {
      throw new SessionError('invalid-rating', `order must be an integer ${min}-${max}, got ${perceivedOrder}`);
    }
    if (!okRating(appeal)) {
      throw new SessionError('invalid-rating', `appeal must be an integer ${min}-${max}, got ${appeal}`);
    }
    if (confidence !== undefined && confidence !== null && !okRating(confidence)) {
      throw new SessionError('invalid-rating', `confidence must be an integer ${min}-${max} or null`);
    }
    if (comment !== undefined && comment !== null && typeof comment !== 'string') {
      throw new SessionError('invalid-comment', 'comment must be a string');
    }
    if (typeof comment === 'string' && comment.length > commentMaxLength) {
      throw new SessionError('invalid-comment', `comment exceeds ${commentMaxLength} characters`);
    }

    this.state.responses[stimulusId] = {
      stimulusId,
      presentationIndex: this.state.index,
      perceivedOrder,
      appeal,
      confidence: confidence ?? null,
      comment: comment ?? '',
      shownAt: shownAt ?? null,
      respondedAt: new Date().toISOString(),
      // The integrity hash actually computed from the served bytes, so a join
      // can bind this response to a specific archived layout (F2).
      stimulusIntegrity: stimulusIntegrity ?? null,
      // Independent flags. scoreAvailable is joined offline by the researcher.
      scoreAvailable: null,
      trialValid: integrityOk !== false,
      analysisEligible: { modelAgreement: null, ratingOnly: integrityOk !== false },
      exclusionRule: integrityOk === false ? 'X1-integrity-mismatch' : null,
      invalidReason: integrityOk === false ? 'stimulus-integrity-mismatch' : null,
    };
    this.state.index += 1;
    this.state.revision += 1;
    if (this.complete) this.state.status = 'completed';
    return this.state.responses[stimulusId];
  }

  /** Advances past a trial that could not be presented. Records no rating. */
  skipUnavailable(stimulusId, reason) {
    if (stimulusId !== this.currentStimulusId) {
      throw new SessionError('stale-trial', `cannot skip ${stimulusId}; current is ${this.currentStimulusId}`);
    }
    this.state.skipped = this.state.skipped ?? {};
    this.state.skipped[stimulusId] = { reason: reason ?? 'unavailable', at: new Date().toISOString() };
    this.state.index += 1;
    this.state.revision += 1;
    if (this.complete) this.state.status = 'completed';
  }

  /**
   * Withdrawal. Enforces WITHDRAWAL_POLICY on every already-recorded response:
   * retained for audit, ineligible for all analysis.
   */
  withdraw() {
    if (this.state.status === 'erased') throw new SessionError('erased', 'cannot withdraw an erased session');
    this.state.withdrawn = true;
    this.state.withdrawnAt = new Date().toISOString();
    this.state.status = 'withdrawn';
    this.state.revision += 1;
    for (const r of Object.values(this.state.responses)) {
      r.analysisEligible = { modelAgreement: false, ratingOnly: false };
      r.exclusionRule = 'X2-withdrawn';
      r.withdrawnAt = this.state.withdrawnAt;
    }
  }

  /** Erases every stored response and the local save. Irreversible by design. */
  erase(storage = defaultStorage()) {
    this.state.responses = {};
    this.state.index = 0;
    this.state.status = 'erased';
    this.state.erasedAt = new Date().toISOString();
    this.state.revision += 1;
    try { storage?.removeItem(STORAGE_KEY); } catch { /* storage may be unavailable */ }
    this.#baseRevision = this.state.revision;
  }

  toJSON() { return JSON.parse(JSON.stringify(this.state)); }

  /**
   * Saves with OPTIMISTIC CONCURRENCY (F4).
   *
   * Two tabs share one storage key. Previously the last writer won, so a rating
   * made in one tab could be silently replaced by a stale view from the other.
   * Now a write is refused unless the stored revision is the one this session
   * last observed. The caller gets `stale-session` and must reload.
   *
   * `force: true` exists only for erase(), which is deliberately destructive.
   */
  save(storage = defaultStorage(), { force = false } = {}) {
    if (!storage) return { ok: false, reason: 'storage-unavailable' };
    try {
      if (!force) {
        const raw = storage.getItem(STORAGE_KEY);
        if (raw !== null) {
          let stored = null;
          try { stored = JSON.parse(raw); } catch { stored = null; }
          if (stored && stored.participantId === this.state.participantId) {
            const storedRev = Number.isInteger(stored.revision) ? stored.revision : 0;
            // A conflicting writer has advanced the record past what we based on.
            if (storedRev > this.#baseRevision) {
              return {
                ok: false,
                reason: 'stale-session',
                storedRevision: storedRev,
                localRevision: this.state.revision,
                baseRevision: this.#baseRevision,
              };
            }
          }
        }
      }
      storage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      this.#baseRevision = this.state.revision;
      return { ok: true, revision: this.state.revision };
    } catch (e) {
      return { ok: false, reason: 'storage-write-failed', detail: String(e?.message ?? e) };
    }
  }

  /** The revision this session last read from or wrote to storage. */
  get baseRevision() { return this.#baseRevision; }

  // =========================================================================
  // Transactional persistence (A). The compare-and-swap above is retained for
  // the synchronous API, but these are what the app uses: every write happens
  // inside an exclusive critical section against the LATEST stored state.
  // =========================================================================

  /**
   * Commits this session's responses onto whatever is currently stored,
   * MERGING rather than replacing. A response already present in storage is
   * never overwritten by a stale copy, and rows this tab never saw survive.
   */
  async commitTo(store) {
    const local = this.state;
    const res = await store.commit((latest) => {
      if (!latest) return local;
      if (latest.participantId !== local.participantId) return null; // different session; leave it
      const merged = JSON.parse(JSON.stringify(latest));
      // Responses are append-only by stimulusId. First write wins per stimulus.
      for (const [id, r] of Object.entries(local.responses)) {
        if (!Object.prototype.hasOwnProperty.call(merged.responses, id)) merged.responses[id] = r;
      }
      merged.skipped = { ...(latest.skipped ?? {}), ...(local.skipped ?? {}) };
      // The cursor is the furthest either tab reached.
      merged.index = Math.max(latest.index ?? 0, local.index ?? 0);
      merged.revision = Math.max(latest.revision ?? 0, local.revision ?? 0) + 1;
      merged.acknowledged = latest.acknowledged || local.acknowledged;
      merged.acknowledgedAt = latest.acknowledgedAt ?? local.acknowledgedAt;
      // Withdrawal is sticky: once either side withdrew, it stays withdrawn.
      if (latest.withdrawn || local.withdrawn) {
        merged.withdrawn = true;
        merged.withdrawnAt = latest.withdrawnAt ?? local.withdrawnAt;
        merged.status = 'withdrawn';
        for (const r of Object.values(merged.responses)) {
          r.analysisEligible = { modelAgreement: false, ratingOnly: false };
          r.exclusionRule = 'X2-withdrawn';
          r.withdrawnAt = merged.withdrawnAt;
        }
      } else if (merged.index >= merged.order.length) {
        merged.status = 'completed';
      }
      return merged;
    });
    if (res.ok && res.state) {
      this.state = res.state;
      this.#baseRevision = res.state.revision ?? 0;
    }
    return res;
  }

  /**
   * Withdrawal applied to the LATEST stored session (A).
   *
   * Previously a stale tab could force-write its own thin copy, destroying rows
   * it had never seen. Withdrawal now loads current state inside the lock and
   * marks THOSE rows, preserving every one of them under the documented
   * audit-retention policy.
   */
  async withdrawLatest(store) {
    const localResponses = this.state.responses;
    const at = new Date().toISOString();
    const res = await store.commit((latest) => {
      const base = (latest && latest.participantId === this.state.participantId)
        ? JSON.parse(JSON.stringify(latest))
        : JSON.parse(JSON.stringify(this.state));
      // Union of rows: nothing is dropped by withdrawing from a stale tab.
      for (const [id, r] of Object.entries(localResponses)) {
        if (!Object.prototype.hasOwnProperty.call(base.responses, id)) base.responses[id] = r;
      }
      base.withdrawn = true;
      base.withdrawnAt = base.withdrawnAt ?? at;
      base.status = 'withdrawn';
      base.revision = (base.revision ?? 0) + 1;
      for (const r of Object.values(base.responses)) {
        r.analysisEligible = { modelAgreement: false, ratingOnly: false };
        r.exclusionRule = 'X2-withdrawn';
        r.withdrawnAt = base.withdrawnAt;
      }
      return base;
    }, { requireOwnership: false });   // withdrawal must always be possible
    if (res.ok && res.state) {
      this.state = res.state;
      this.#baseRevision = res.state.revision ?? 0;
    }
    return res;
  }

  /** Erases via the store so a tombstone blocks resurrection by a stale tab. */
  async eraseVia(store) {
    this.state.responses = {};
    this.state.index = 0;
    this.state.status = 'erased';
    this.state.erasedAt = new Date().toISOString();
    this.state.revision += 1;
    return store.erase(this.state.participantId);
  }

  static load(storage = defaultStorage()) {
    if (!storage) return { ok: false, reason: 'storage-unavailable' };
    let raw;
    try { raw = storage.getItem(STORAGE_KEY); } catch (e) { return { ok: false, reason: 'storage-read-failed' }; }
    if (raw === null) return { ok: false, reason: 'no-saved-session' };
    let parsed;
    try { parsed = JSON.parse(raw); } catch { return { ok: false, reason: 'corrupt-saved-session' }; }
    const bad = validateState(parsed);
    if (bad) return { ok: false, reason: 'corrupt-saved-session', detail: bad };
    return { ok: true, session: new RatingSession(parsed, parsed.revision ?? 0) };
  }

  static clear(storage = defaultStorage()) {
    try { storage?.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }

  /**
   * The export record. A LOCAL FILE, not a submission.
   * `transmitted: false` is stated in the record itself so a downstream reader
   * cannot mistake a download for server-side collection.
   */
  exportRecord() {
    return {
      exportFormat: 'rating-export-1',
      exportedAt: new Date().toISOString(),
      transmitted: false,
      // Rehearsal output is labelled in the file itself so it cannot be merged
      // into the study dataset by accident (deployment item 26).
      dataClass: this.state.dataClass ?? RELEASE_MODES[DEFAULT_RELEASE_MODE].dataClass,
      releaseMode: this.state.releaseMode ?? DEFAULT_RELEASE_MODE,
      collection: {
        mechanism: 'local-download-only',
        approvedEndpoint: null,
        // The channel the participant was actually shown, or null. A join must
        // not assume any particular route was used.
        returnChannel: this.state.returnChannel ?? null,
        note: 'No collection endpoint exists. This file was saved locally by the '
          + 'participant; downloading it is NOT a submission and does not send it '
          + 'anywhere. Any return of this file happens outside the application, '
          + 'through a channel that may itself attach identifying information.',
      },
      releaseStatus: this.state.releaseStatus,
      instrumentVersion: this.state.instrumentVersion,
      instructionsVersion: this.state.instructionsVersion,
      acknowledgementVersion: this.state.acknowledgementVersion,
      manifestVersion: this.state.manifestVersion,
      releasePackageId: this.state.releasePackageId ?? null,
      releasePackageDigest: this.state.releasePackageDigest ?? null,
      sessionFormat: this.state.sessionFormat,
      participantId: this.state.participantId,
      orderSeed: this.state.orderSeed,
      order: this.state.order,
      startedAt: this.state.startedAt,
      acknowledgedAt: this.state.acknowledgedAt,
      withdrawn: this.state.withdrawn,
      withdrawnAt: this.state.withdrawnAt,
      status: this.state.status,
      responseCount: Object.keys(this.state.responses).length,
      // Withdrawal is enforced at export, not merely flagged (F1). If a session
      // is withdrawn, every response leaves here already ineligible.
      withdrawalPolicy: WITHDRAWAL_POLICY,
      responses: Object.values(this.state.responses).map((r) => (this.state.withdrawn
        ? {
          ...r,
          analysisEligible: { modelAgreement: false, ratingOnly: false },
          exclusionRule: 'X2-withdrawn',
          withdrawnAt: this.state.withdrawnAt,
        }
        : r)),
      skipped: this.state.skipped ?? {},
      revision: this.state.revision,
      modelJoin: {
        // Deliberately does NOT name the researcher-side file. This note ships
        // inside the participant bundle and inside every export, so it must not
        // disclose where the scoring key lives or that conditions exist.
        note: 'scoreAvailable and analysisEligible.modelAgreement are null here and are '
          + 'completed offline by the researcher. The participant bundle carries no scores.',
      },
    };
  }
}

function validateState(s) {
  if (!s || typeof s !== 'object') return 'not-an-object';
  if (s.sessionFormat !== SESSION_FORMAT) return `unsupported sessionFormat ${s.sessionFormat}`;
  if (s.revision !== undefined && !Number.isInteger(s.revision)) return 'revision must be an integer';
  if (!Array.isArray(s.order) || s.order.length === 0) return 'order missing or empty';
  if (!Number.isInteger(s.index) || s.index < 0 || s.index > s.order.length) return `index ${s.index} out of range`;
  if (!s.responses || typeof s.responses !== 'object') return 'responses missing';
  if (typeof s.participantId !== 'string' || !s.participantId) return 'participantId missing';
  return null;
}

export function defaultStorage() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const probe = '__order_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null; // private window, blocked site data, quota exhausted
  }
}

export { STORAGE_KEY };
