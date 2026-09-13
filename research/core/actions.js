/**
 * Editor session: Explain, Preview, Apply, Cancel, Undo, Redo as distinct,
 * separately logged actions.
 *
 * This replaces the shipped behaviour where one click both opened the
 * explanation panel and applied the transform (index.bf617e4.html L1576), which
 * made it impossible to tell a documentation read from a design decision.
 *
 * Guarantees, each covered by a test:
 *   - explain() returns documentation and leaves state byte-identical.
 *   - preview() computes a candidate WITHOUT committing it, and records the
 *     resolved parameters it was computed with.
 *   - apply() commits the EXACT previewed layout ONLY when that preview is
 *     still current. A preview whose base state has since changed is STALE: it
 *     is discarded and logged, never committed. See #assertFresh.
 *   - cancel() leaves the committed layout untouched.
 *   - undo()/redo() move through committed history, are logged, and invalidate
 *     any pending preview.
 *   - Everything handed to a caller is deep-frozen. A caller cannot rewrite
 *     committed history or a recorded event.
 */

import { cloneLayout, layoutHash, layoutsEqual, serialize } from './layout.js';
import { getPreset, listPresets } from './presets/registry.js';
import { EventLog, EVENT_TYPES } from './events.js';
import { deepFreeze } from './freeze.js';

/** Why a pending preview was discarded. */
export const PREVIEW_DISCARD_REASON = Object.freeze({
  USER: 'user',
  SUPERSEDED: 'superseded',
  SUPERSEDED_BY_APPLY: 'superseded-by-apply',
  /** The committed layout changed after the preview was computed. */
  STALE: 'stale',
});

export class EditorSession {
  #history;
  #cursor;
  #preview = null;
  #openExplanation = null;

  /**
   * @param {object} initialLayout canonical layout
   * @param {{log?:EventLog, trialId?:string}} [opts]
   */
  constructor(initialLayout, { log, trialId = null } = {}) {
    this.#history = [deepFreeze(cloneLayout(initialLayout))];
    this.#cursor = 0;
    this.log = log ?? new EventLog({ enabled: false, trialId });
    this.trialId = trialId;
  }

  /** The committed layout. Deep-frozen; never reflects an uncommitted preview. */
  get layout() {
    return this.#history[this.#cursor];
  }

  get stateId() {
    return layoutHash(this.layout);
  }

  get canUndo() {
    return this.#cursor > 0;
  }

  get canRedo() {
    return this.#cursor < this.#history.length - 1;
  }

  /** The pending preview (deep-frozen), or null. */
  get pendingPreview() {
    return this.#preview;
  }

  get hasPendingPreview() {
    return this.#preview !== null;
  }

  /**
   * True when a preview exists but the committed layout has moved on since it
   * was computed. A stale preview is never committed.
   */
  get isPreviewStale() {
    return this.#preview !== null && this.#preview.beforeStateId !== this.stateId;
  }

  // -------------------------------------------------------------------------

  /**
   * Opens documentation for a preset. MUTATES NOTHING — it does not read,
   * transform, or replace the layout, and creates no history entry.
   */
  explain(presetId) {
    const preset = getPreset(presetId);
    this.#openExplanation = preset.id;
    this.log.record(EVENT_TYPES.EXPLANATION_OPENED, {
      presetId: preset.id,
      presetRegistryVersion: preset.registryVersion,
      stateId: this.stateId, // context only; unchanged by this call
    });
    return deepFreeze({
      id: preset.id,
      name: preset.name,
      description: preset.description,
      params: preset.params,
      knownDefects: preset.knownDefects,
    });
  }

  closeExplanation() {
    if (this.#openExplanation === null) return null;
    const presetId = this.#openExplanation;
    this.#openExplanation = null;
    this.log.record(EVENT_TYPES.EXPLANATION_CLOSED, { presetId });
    return presetId;
  }

  get openExplanation() {
    return this.#openExplanation;
  }

  /**
   * Computes a candidate layout without committing it.
   * Records the RESOLVED parameters actually used, not merely the preset id.
   */
  preview(presetId, params) {
    const preset = getPreset(presetId);
    if (this.#preview) this.#discardPreview(PREVIEW_DISCARD_REASON.SUPERSEDED);

    const before = this.layout;
    const resolvedParams = params ?? preset.params;
    const candidate = preset.apply(before, resolvedParams);

    this.#preview = deepFreeze({
      presetId: preset.id,
      params: resolvedParams,
      paramsExplicit: params !== undefined,
      implementationVersion: preset.implementationVersion,
      registryVersion: preset.registryVersion,
      beforeStateId: layoutHash(before),
      previewStateId: layoutHash(candidate),
      layout: cloneLayout(candidate),
      changesNothing: layoutsEqual(before, candidate),
    });

    this.log.record(EVENT_TYPES.PREVIEW_REQUESTED, {
      presetId: preset.id,
      params: resolvedParams,
      paramsExplicit: params !== undefined,
      presetImplementationVersion: preset.implementationVersion,
      presetRegistryVersion: preset.registryVersion,
      beforeStateId: this.#preview.beforeStateId,
      previewStateId: this.#preview.previewStateId,
      changesNothing: this.#preview.changesNothing,
    });

    return this.#preview;
  }

  /** Discards a pending preview. The committed layout was never touched. */
  cancelPreview({ reason = PREVIEW_DISCARD_REASON.USER } = {}) {
    return this.#discardPreview(reason);
  }

  #discardPreview(reason) {
    if (!this.#preview) return null;
    const { presetId, beforeStateId, previewStateId, params } = this.#preview;
    this.#preview = null;
    this.log.record(EVENT_TYPES.PREVIEW_CANCELLED, {
      presetId,
      params,
      beforeStateId,
      previewStateId,
      currentStateId: this.stateId,
      reason,
    });
    return presetId;
  }

  /**
   * Invalidates a pending preview whose base state has moved on.
   * Called before any commit and after any history move.
   */
  #dropIfStale() {
    if (this.isPreviewStale) this.#discardPreview(PREVIEW_DISCARD_REASON.STALE);
  }

  /**
   * Commits a preset.
   *
   * The previewed layout is committed ONLY if that preview is for this preset
   * AND is still fresh — i.e. the committed layout has not changed since the
   * preview was computed. A stale preview is discarded and the preset is
   * recomputed from the current state, so what is committed is always derived
   * from what the participant was actually looking at.
   *
   * Logged as "preset applied". An observed operation, not evidence of
   * acceptance or usefulness.
   */
  apply(presetId, params) {
    const preset = getPreset(presetId);
    this.#dropIfStale();

    const before = this.layout;
    const beforeStateId = layoutHash(before);
    const resolvedParams = params ?? preset.params;

    let next;
    let fromPreview = false;
    const usable =
      this.#preview &&
      this.#preview.presetId === preset.id &&
      this.#preview.beforeStateId === beforeStateId &&
      stableStringify(this.#preview.params) === stableStringify(resolvedParams);

    if (usable) {
      next = this.#preview.layout;
      fromPreview = true;
      this.#preview = null;
    } else {
      if (this.#preview) this.#discardPreview(PREVIEW_DISCARD_REASON.SUPERSEDED_BY_APPLY);
      next = preset.apply(before, resolvedParams);
    }

    this.#commit(next);

    this.log.record(EVENT_TYPES.PRESET_APPLIED, {
      presetId: preset.id,
      params: resolvedParams,
      paramsExplicit: params !== undefined,
      presetImplementationVersion: preset.implementationVersion,
      presetRegistryVersion: preset.registryVersion,
      beforeStateId,
      afterStateId: this.stateId,
      committedFromPreview: fromPreview,
      changedProperties: diffProperties(before, this.layout),
    });

    return this.layout;
  }

  /** Commits a manual element edit. */
  editElement(elementId, changes) {
    this.#dropIfStale();
    const before = this.layout;
    const beforeStateId = layoutHash(before);
    const next = cloneLayout(before);
    const target = next.elements.find((e) => e.id === elementId);
    if (!target) throw new Error(`unknown element: ${elementId}`);
    const from = {};
    for (const [k, v] of Object.entries(changes)) {
      from[k] = target[k];
      target[k] = v;
    }
    this.#commit(next);
    // Any preview computed against the previous state is now stale.
    this.#dropIfStale();
    this.log.record(EVENT_TYPES.MANUAL_EDIT, {
      elementId,
      beforeStateId,
      afterStateId: this.stateId,
      changedProperties: Object.keys(changes),
      from,
      to: { ...changes },
    });
    return this.layout;
  }

  undo() {
    if (!this.canUndo) return null;
    const beforeStateId = this.stateId;
    this.#cursor -= 1;
    this.#dropIfStale();
    this.log.record(EVENT_TYPES.UNDO, {
      beforeStateId,
      afterStateId: this.stateId,
      historyIndex: this.#cursor,
    });
    return this.layout;
  }

  redo() {
    if (!this.canRedo) return null;
    const beforeStateId = this.stateId;
    this.#cursor += 1;
    this.#dropIfStale();
    this.log.record(EVENT_TYPES.REDO, {
      beforeStateId,
      afterStateId: this.stateId,
      historyIndex: this.#cursor,
    });
    return this.layout;
  }

  /** Committed states, oldest first. Deep-frozen. */
  get history() {
    return deepFreeze(this.#history.map((l) => ({ stateId: layoutHash(l), layout: l })));
  }

  get cursor() {
    return this.#cursor;
  }

  #commit(next) {
    // A commit always invalidates any pending preview. Discard it through the
    // logged path: silently nulling it here would break the guarantee that a
    // preview is never dropped without a record.
    if (this.#preview) this.#discardPreview(PREVIEW_DISCARD_REASON.STALE);
    this.#history = this.#history.slice(0, this.#cursor + 1);
    this.#history.push(deepFreeze(cloneLayout(next)));
    this.#cursor = this.#history.length - 1;
  }

  // -------------------------------------------------------------------------
  // Resumable sessions
  // -------------------------------------------------------------------------

  /**
   * Serializable session state.
   *
   * A pending preview is deliberately NOT persisted: it is uncommitted by
   * definition, and restoring one across a reload would blur the commit
   * boundary and could resurrect a preview whose base state no longer exists.
   */
  toJSON() {
    return {
      sessionFormat: SESSION_FORMAT,
      trialId: this.trialId,
      cursor: this.#cursor,
      history: this.#history.map((l) => JSON.parse(serialize(l))),
      openExplanation: this.#openExplanation,
      events: this.log.toJSON(),
    };
  }

  /**
   * Restores a session from `toJSON()` output, including committed history, the
   * undo/redo cursor, and the event log with its sequence numbering continued.
   *
   * @param {object} json
   * @param {{clock?:Function, enabled?:boolean}} [opts]
   */
  static fromJSON(json, { clock, enabled = true } = {}) {
    if (json.sessionFormat !== SESSION_FORMAT) {
      throw new Error(
        `unsupported sessionFormat ${json.sessionFormat}; this build reads ${SESSION_FORMAT}`,
      );
    }
    if (!Array.isArray(json.history) || json.history.length === 0) {
      throw new Error('session history is empty or malformed');
    }
    const cursor = json.cursor;
    if (!Number.isInteger(cursor) || cursor < 0 || cursor >= json.history.length) {
      throw new Error(`session cursor ${cursor} is out of range`);
    }

    const log = EventLog.fromJSON(json.events, { clock, enabled });
    const session = new EditorSession(json.history[0], { log, trialId: json.trialId });
    // Rebuild the full committed history, then restore the cursor.
    for (let i = 1; i < json.history.length; i++) {
      session.#history.push(deepFreeze(cloneLayout(json.history[i])));
    }
    session.#cursor = cursor;
    session.#openExplanation = json.openExplanation ?? null;
    return session;
  }

  static presets() {
    return listPresets();
  }
}

export const SESSION_FORMAT = 'session-1';

/**
 * Order-insensitive, stable stringify for comparing resolved preset parameters.
 * NOT the layout serializer — that expects a layout shape.
 */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

/** Which element properties differ between two layouts. */
function diffProperties(a, b) {
  const changed = new Set();
  const byId = new Map(b.elements.map((e) => [e.id, e]));
  for (const before of a.elements) {
    const after = byId.get(before.id);
    if (!after) continue;
    for (const k of ['x', 'y', 'size', 'size2', 'rotation', 'color', 'filled', 'visible', 'order']) {
      if (before[k] !== after[k]) changed.add(k);
    }
  }
  return [...changed].sort();
}
