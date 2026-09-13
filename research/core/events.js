/**
 * Append-only event recorder — DEVELOPMENT ONLY in this milestone.
 *
 * No participant data is collected and no transport exists. `enabled` defaults
 * to false; the study workflow that would turn it on has not been built or
 * approved.
 *
 * NAMING DISCIPLINE
 * Event types describe OBSERVED OPERATIONS, never inferred intent.
 * `preset.applied` means a preset was applied. It does NOT mean the suggestion
 * was accepted, was useful, or was agreed with. Acceptance is a downstream
 * inference requiring further evidence — whether the change survived to the
 * final layout, whether it was undone, and what the participant said about it.
 * That inference belongs to analysis, not to the logger.
 */

import { deepFreeze } from './freeze.js';

export const EVENT_SCHEMA_VERSION = 'events-1';

export const EVENT_TYPES = Object.freeze({
  EXPLANATION_OPENED: 'explanation.opened',
  EXPLANATION_CLOSED: 'explanation.closed',
  PREVIEW_REQUESTED: 'preview.requested',
  PREVIEW_CANCELLED: 'preview.cancelled',
  PRESET_APPLIED: 'preset.applied',
  MANUAL_EDIT: 'edit.manual',
  UNDO: 'history.undo',
  REDO: 'history.redo',
  RESET: 'history.reset',
});

export class EventLog {
  #events = [];
  #seq = 0;

  constructor({ enabled = false, trialId = null, clock = () => Date.now(), t0 = null } = {}) {
    this.enabled = enabled;
    this.trialId = trialId;
    this.clock = clock;
    this.t0 = t0 ?? clock();
  }

  /**
   * Appends one event. Returns the stored record, or null when disabled.
   * Records are append-only: there is no update or delete path.
   *
   * The record is DEEP-frozen. `Object.freeze` alone is shallow, which left
   * nested payload values (params objects, changedProperties arrays, from/to
   * maps) writable by whoever received the record — meaning a caller could
   * silently rewrite recorded history.
   */
  record(type, payload = {}) {
    if (!this.enabled) return null;
    const now = this.clock();
    const event = deepFreeze({
      eventId: `${this.trialId ?? 'dev'}-${this.#seq}`,
      trialId: this.trialId,
      sequenceNumber: this.#seq++,
      elapsedMs: now - this.t0,
      actionType: type,
      schemaVersion: EVENT_SCHEMA_VERSION,
      // Structurally cloned so a later mutation of the caller's object cannot
      // reach into the stored record.
      ...structuredClone(payload),
    });
    this.#events.push(event);
    return event;
  }

  get events() {
    return deepFreeze([...this.#events]);
  }

  get length() {
    return this.#events.length;
  }

  /** Sequence number the next recorded event will take. */
  get nextSequenceNumber() {
    return this.#seq;
  }

  typesInOrder() {
    return this.#events.map((e) => e.actionType);
  }

  toJSON() {
    return {
      schemaVersion: EVENT_SCHEMA_VERSION,
      trialId: this.trialId,
      t0: this.t0,
      nextSequenceNumber: this.#seq,
      events: this.#events.map((e) => structuredClone(e)),
    };
  }

  /**
   * Restores a log, continuing its sequence numbering so that events recorded
   * after a reload do not collide with events recorded before it.
   */
  static fromJSON(json, { clock, enabled = true } = {}) {
    if (!json) return new EventLog({ enabled, clock });
    if (json.schemaVersion !== EVENT_SCHEMA_VERSION) {
      throw new Error(
        `unsupported event schemaVersion ${json.schemaVersion}; this build reads ${EVENT_SCHEMA_VERSION}`,
      );
    }
    const log = new EventLog({
      enabled,
      trialId: json.trialId,
      clock,
      t0: json.t0 ?? 0,
    });
    for (const e of json.events ?? []) log.#events.push(deepFreeze(structuredClone(e)));
    log.#seq = json.nextSequenceNumber ?? log.#events.length;
    return log;
  }
}

/**
 * Coalesces a burst of continuous-control edits (a slider drag) into one
 * committed edit. A drag is one design decision, not forty.
 *
 * Events are grouped when they touch the same element and property within
 * `windowMs` of one another. The returned record keeps the first `from` and the
 * last `to`, plus how many raw inputs were folded in.
 */
export function coalesceEdits(rawEdits, { windowMs = 400 } = {}) {
  const out = [];
  for (const edit of rawEdits) {
    const last = out[out.length - 1];
    if (
      last &&
      last.elementId === edit.elementId &&
      last.property === edit.property &&
      edit.t - last.tLast <= windowMs
    ) {
      last.to = edit.value;
      last.tLast = edit.t;
      last.rawInputCount += 1;
    } else {
      out.push({
        elementId: edit.elementId,
        property: edit.property,
        from: edit.previous,
        to: edit.value,
        tFirst: edit.t,
        tLast: edit.t,
        rawInputCount: 1,
      });
    }
  }
  return out;
}
