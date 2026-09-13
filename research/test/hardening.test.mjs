/**
 * Foundation-hardening tests: stale previews, parameter logging, external
 * mutability, and resumable sessions.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { EditorSession, PREVIEW_DISCARD_REASON, SESSION_FORMAT } from '../core/actions.js';
import { EventLog, EVENT_TYPES } from '../core/events.js';
import { isDeepFrozen } from '../core/freeze.js';
import { serialize, layoutHash } from '../core/layout.js';
import { generateLayout } from '../core/generate.js';
import { score } from '../core/scoring/v0-as-shipped.js';
import { getPreset } from '../core/presets/registry.js';

const base = () => generateLayout({ seed: 2024 });
const session = () =>
  new EditorSession(base(), {
    log: new EventLog({
      enabled: true,
      trialId: 't1',
      clock: (() => { let t = 0; return () => (t += 10); })(),
    }),
    trialId: 't1',
  });

const appliedEvents = (s) => s.log.events.filter((e) => e.actionType === EVENT_TYPES.PRESET_APPLIED);
const cancelEvents = (s) => s.log.events.filter((e) => e.actionType === EVENT_TYPES.PREVIEW_CANCELLED);

// ---------------------------------------------------------------------------
// Stale previews
// ---------------------------------------------------------------------------

test('STALE PREVIEW: a manual edit after preview invalidates it; apply recomputes', () => {
  const s = session();
  const pv = s.preview('strict-grid');
  const stalePreviewState = pv.previewStateId;

  s.editElement(s.layout.elements.find((e) => e.visible).id, { x: 137 });
  assert.equal(s.hasPendingPreview, false, 'the commit must have dropped the preview');

  const baseForApply = s.layout;
  const committed = s.apply('strict-grid');
  const applied = appliedEvents(s).at(-1);

  assert.equal(applied.committedFromPreview, false, 'a stale preview must never be committed');
  assert.notEqual(
    layoutHash(committed),
    stalePreviewState,
    'the committed layout must derive from the CURRENT state, not the superseded preview',
  );
  const fresh = getPreset('strict-grid').apply(baseForApply);
  assert.equal(layoutHash(committed), layoutHash(fresh));
});

test('STALE PREVIEW: undo after preview invalidates it and logs reason "stale"', () => {
  const s = session();
  s.apply('size-uniformity');
  const pv = s.preview('strict-grid');
  assert.equal(s.isPreviewStale, false);

  s.undo();
  assert.equal(s.hasPendingPreview, false);

  const last = cancelEvents(s).at(-1);
  assert.equal(last.reason, PREVIEW_DISCARD_REASON.STALE);
  assert.equal(last.previewStateId, pv.previewStateId);
  assert.notEqual(last.beforeStateId, last.currentStateId);
});

test('STALE PREVIEW: differing params force recomputation rather than reusing the preview', () => {
  const s = session();
  s.preview('strict-grid', { gridSize: 8, rotationStep: 15 });
  s.apply('strict-grid', { gridSize: 32, rotationStep: 15 });

  const applied = appliedEvents(s).at(-1);
  assert.equal(applied.committedFromPreview, false);
  assert.equal(applied.params.gridSize, 32, 'the APPLIED params are logged, not the previewed ones');

  const superseded = cancelEvents(s).at(-1);
  assert.equal(superseded.reason, PREVIEW_DISCARD_REASON.SUPERSEDED_BY_APPLY);
  assert.equal(superseded.params.gridSize, 8, 'the CANCELLED preview logs the params it used');
});

test('NO SILENT DROPS: every discarded preview has a matching cancelled event', () => {
  // Regression: #commit() used to null the pending preview directly, so a
  // preview invalidated by a manual edit vanished with no record.
  const s = session();
  let previews = 0;

  s.preview('strict-grid'); previews++;
  s.editElement(s.layout.elements.find((e) => e.visible).id, { x: 140 }); // drops it

  s.preview('radial-distribution'); previews++;
  s.undo();                                                              // drops it

  s.preview('size-uniformity'); previews++;
  s.cancelPreview();                                                     // explicit

  s.preview('strict-grid'); previews++;
  s.apply('strict-grid');                                                // consumed, not dropped

  const requested = s.log.events.filter((e) => e.actionType === EVENT_TYPES.PREVIEW_REQUESTED).length;
  const cancelled = cancelEvents(s).length;
  assert.equal(requested, previews);
  assert.equal(cancelled, previews - 1, 'exactly one preview was consumed by apply; the rest were logged as cancelled');
  for (const ev of cancelEvents(s)) {
    assert.ok(ev.reason, 'every cancellation records a reason');
    assert.ok(ev.presetId && ev.params, 'every cancellation records preset and params');
  }
  assert.equal(s.hasPendingPreview, false);
});

test('a fresh preview is still committed from the preview', () => {
  const s = session();
  s.preview('strict-grid');
  s.apply('strict-grid');
  assert.equal(appliedEvents(s).at(-1).committedFromPreview, true);
});

test('state-changing events form an unbroken before/after chain', () => {
  // Guards against a stale preview silently breaking the state chain.
  // Note: committing after an undo truncates the redo branch, so a state that
  // was real at the time legitimately leaves `history` while remaining in the
  // append-only log. The invariant is chain CONTINUITY, not reachability.
  const s = session();
  s.preview('strict-grid');
  s.editElement(s.layout.elements.find((e) => e.visible).id, { y: 210 });
  s.apply('strict-grid');
  s.preview('radial-distribution');
  s.undo();
  s.apply('size-uniformity');

  const stateful = s.log.events.filter((e) => e.afterStateId);
  assert.ok(stateful.length >= 4);
  for (const ev of stateful) {
    assert.ok(ev.beforeStateId, `${ev.actionType} must record a beforeStateId`);
  }
  for (let i = 1; i < stateful.length; i++) {
    assert.equal(
      stateful[i].beforeStateId,
      stateful[i - 1].afterStateId,
      `chain broken between ${stateful[i - 1].actionType} and ${stateful[i].actionType}`,
    );
  }
  // The final logged state is the live one.
  assert.equal(stateful.at(-1).afterStateId, s.stateId);
});

// ---------------------------------------------------------------------------
// Parameter logging
// ---------------------------------------------------------------------------

test('PARAMS ARE LOGGED: preview, cancel and apply all record resolved parameters', () => {
  const s = session();
  s.preview('proximity-clustering');
  s.cancelPreview();
  s.apply('proximity-clustering', { passes: 3, step: 0.5, minGap: 4 });

  const [prev, cancel, applied] = s.log.events;
  for (const [name, ev] of [['preview', prev], ['cancel', cancel], ['apply', applied]]) {
    assert.ok(ev.params, `${name} must log params`);
  }
  assert.equal(prev.params.passes, 10, 'defaults are resolved and recorded, not left implicit');
  assert.equal(prev.paramsExplicit, false);
  assert.equal(applied.params.passes, 3);
  assert.equal(applied.paramsExplicit, true);
  assert.ok(prev.presetImplementationVersion, 'implementation version recorded on preview');
  assert.ok(applied.presetImplementationVersion, 'implementation version recorded on apply');
  assert.ok(applied.presetRegistryVersion, 'registry version recorded on apply');
});

// ---------------------------------------------------------------------------
// External mutability
// ---------------------------------------------------------------------------

test('IMMUTABLE: committed layouts cannot be mutated by a caller', () => {
  const s = session();
  s.apply('strict-grid');
  const before = serialize(s.layout);

  assert.ok(isDeepFrozen(s.layout), 'the committed layout must be deep-frozen');
  assert.throws(() => { s.layout.elements[0].x = -999; }, TypeError);
  assert.throws(() => { s.layout.elements.push({}); }, TypeError);
  assert.throws(() => { s.layout.canvas.width = 1; }, TypeError);
  assert.equal(serialize(s.layout), before);
});

test('IMMUTABLE: history and previews cannot be mutated by a caller', () => {
  const s = session();
  s.apply('strict-grid');
  assert.ok(isDeepFrozen(s.history));
  assert.throws(() => { s.history[0].layout.elements[0].y = 1; }, TypeError);

  const pv = s.preview('radial-distribution');
  assert.ok(isDeepFrozen(pv), 'the preview must be deep-frozen');
  assert.throws(() => { pv.layout.elements[0].x = 5; }, TypeError);
});

test('IMMUTABLE: event records resist tampering, including via the caller payload', () => {
  const s = session();
  const params = { passes: 10, step: 0.3, minGap: 10 };
  s.apply('proximity-clustering', params);

  const ev = s.log.events.at(-1);
  assert.ok(isDeepFrozen(ev), 'the event record must be deep-frozen');
  assert.throws(() => { ev.presetId = 'tampered'; }, TypeError);
  assert.throws(() => { ev.params.passes = 999; }, TypeError);
  assert.throws(() => { ev.changedProperties.push('x'); }, TypeError);

  // Mutating the object the caller passed in must not reach the stored record.
  params.passes = 12345;
  assert.equal(s.log.events.at(-1).params.passes, 10);
});

// ---------------------------------------------------------------------------
// Resumable sessions
// ---------------------------------------------------------------------------

test('RESUME: fromJSON restores history, cursor, redo branch and scores', () => {
  const s = session();
  s.apply('strict-grid');
  s.apply('radial-distribution');
  s.apply('size-uniformity');
  s.undo();

  const json = JSON.parse(JSON.stringify(s.toJSON()));
  const r = EditorSession.fromJSON(json);

  assert.equal(r.history.length, s.history.length);
  assert.equal(r.cursor, s.cursor);
  assert.equal(r.stateId, s.stateId);
  assert.equal(r.canRedo, true, 'the redo branch must survive a resume');
  assert.equal(r.canUndo, true);
  assert.equal(score(r.layout).total, score(s.layout).total);

  for (let i = 0; i < s.history.length; i++) {
    assert.equal(r.history[i].stateId, s.history[i].stateId);
  }
  r.redo();
  assert.equal(r.stateId, s.history.at(-1).stateId);
});

test('RESUME: event sequence numbering continues rather than restarting', () => {
  const s = session();
  s.apply('strict-grid');
  s.apply('size-uniformity');
  const nBefore = s.log.length;
  const lastSeq = s.log.events.at(-1).sequenceNumber;

  const r = EditorSession.fromJSON(JSON.parse(JSON.stringify(s.toJSON())));
  assert.equal(r.log.length, nBefore, 'prior events are retained');

  r.apply('radial-distribution');
  assert.equal(r.log.events.at(-1).sequenceNumber, lastSeq + 1, 'numbering continues');
  assert.equal(
    new Set(r.log.events.map((e) => e.sequenceNumber)).size,
    r.log.length,
    'sequence numbers stay unique after a resume',
  );
});

test('RESUME: a pending preview is NOT restored', () => {
  const s = session();
  s.apply('strict-grid');
  s.preview('radial-distribution');
  const r = EditorSession.fromJSON(JSON.parse(JSON.stringify(s.toJSON())));
  assert.equal(r.hasPendingPreview, false);
  assert.equal(r.stateId, s.stateId);
});

test('RESUME: an unknown session format is rejected rather than guessed', () => {
  const s = session();
  const json = s.toJSON();
  assert.equal(json.sessionFormat, SESSION_FORMAT);
  assert.throws(
    () => EditorSession.fromJSON({ ...json, sessionFormat: 'session-99' }),
    /unsupported sessionFormat/,
  );
  assert.throws(() => EditorSession.fromJSON({ ...json, cursor: 99 }), /out of range/);
  assert.throws(() => EditorSession.fromJSON({ ...json, history: [] }), /empty or malformed/);
});

test('RESUME: a restored session is still immutable and still stale-safe', () => {
  const s = session();
  s.apply('strict-grid');
  const r = EditorSession.fromJSON(JSON.parse(JSON.stringify(s.toJSON())));
  assert.ok(isDeepFrozen(r.layout));

  r.preview('radial-distribution');
  r.editElement(r.layout.elements.find((e) => e.visible).id, { x: 200 });
  assert.equal(r.hasPendingPreview, false, 'staleness handling survives a resume');
});

test('RESUME: colour strings survive a resume verbatim', () => {
  const s = session();
  s.apply('color-harmony');
  const r = EditorSession.fromJSON(JSON.parse(JSON.stringify(s.toJSON())));
  for (const e of r.layout.elements.filter((x) => x.visible)) {
    assert.match(e.color, /^hsl\(/, 'hsl() must not be normalised across a resume');
  }
  assert.equal(score(r.layout).submetrics.balanceDegenerate, true);
});
