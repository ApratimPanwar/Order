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

export const SESSION_FORMAT = 'rating-session-1';
export const INSTRUMENT_VERSION = 'blind-rating-0.1.0-development';
export const INSTRUCTIONS_VERSION = 'instructions-1';
export const ACKNOWLEDGEMENT_VERSION = 'acknowledgement-1';
export const RELEASE_STATUS = 'DEVELOPMENT PILOT - NOT A DATA COLLECTION RELEASE';

const STORAGE_KEY = 'order-blind-rating/session';

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
  constructor(state) { this.state = state; }

  static create({ manifest, orderSeed, participantId } = {}) {
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
    });
  }

  acknowledge() {
    this.state.acknowledged = true;
    this.state.acknowledgedAt = new Date().toISOString();
    this.state.status = 'in-progress';
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
  record(stimulusId, { order: perceivedOrder, appeal, confidence, comment, integrityOk, shownAt }) {
    this.state.responses[stimulusId] = {
      stimulusId,
      presentationIndex: this.state.index,
      perceivedOrder,
      appeal,
      confidence: confidence ?? null,
      comment: comment ?? '',
      shownAt: shownAt ?? null,
      respondedAt: new Date().toISOString(),
      // Independent flags. scoreAvailable is joined offline by the researcher.
      scoreAvailable: null,
      trialValid: integrityOk !== false,
      analysisEligible: { modelAgreement: null, ratingOnly: integrityOk !== false },
      invalidReason: integrityOk === false ? 'stimulus-integrity-mismatch' : null,
    };
    this.state.index += 1;
    if (this.complete) this.state.status = 'completed';
    return this.state.responses[stimulusId];
  }

  withdraw() {
    this.state.withdrawn = true;
    this.state.withdrawnAt = new Date().toISOString();
    this.state.status = 'withdrawn';
  }

  /** Erases every stored response and the local save. Irreversible by design. */
  erase(storage = defaultStorage()) {
    this.state.responses = {};
    this.state.index = 0;
    this.state.status = 'erased';
    this.state.erasedAt = new Date().toISOString();
    try { storage?.removeItem(STORAGE_KEY); } catch { /* storage may be unavailable */ }
  }

  toJSON() { return JSON.parse(JSON.stringify(this.state)); }

  save(storage = defaultStorage()) {
    if (!storage) return { ok: false, reason: 'storage-unavailable' };
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: 'storage-write-failed', detail: String(e?.message ?? e) };
    }
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
    return { ok: true, session: new RatingSession(parsed) };
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
      collection: {
        mechanism: 'local-download-only',
        approvedEndpoint: null,
        note: 'No collection endpoint is configured or approved. This file was saved '
          + 'locally by the participant. Downloading it is NOT a server submission.',
      },
      releaseStatus: this.state.releaseStatus,
      instrumentVersion: this.state.instrumentVersion,
      instructionsVersion: this.state.instructionsVersion,
      acknowledgementVersion: this.state.acknowledgementVersion,
      manifestVersion: this.state.manifestVersion,
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
      responses: Object.values(this.state.responses),
      modelJoin: {
        note: 'scoreAvailable and analysisEligible.modelAgreement are filled OFFLINE by '
          + 'joining study-private/stimulus-key.json on stimulusId. They are null here '
          + 'because the participant bundle carries no scores.',
      },
    };
  }
}

function validateState(s) {
  if (!s || typeof s !== 'object') return 'not-an-object';
  if (s.sessionFormat !== SESSION_FORMAT) return `unsupported sessionFormat ${s.sessionFormat}`;
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
