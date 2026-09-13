import test from 'node:test';
import assert from 'node:assert/strict';

import { EditorSession, PREVIEW_DISCARD_REASON, SESSION_FORMAT } from '../core/actions.js';
import { EventLog, EVENT_TYPES, coalesceEdits } from '../core/events.js';
import { isDeepFrozen } from '../core/freeze.js';
import { serialize, layoutHash, cloneLayout } from '../core/layout.js';
import { generateLayout } from '../core/generate.js';
import { score } from '../core/scoring/v0-as-shipped.js';
import { MemoryStorage, PilotExport, saveOnce } from '../core/storage.js';
import { listPresets, getPreset } from '../core/presets/registry.js';

const base = () => generateLayout({ seed: 2024 });
const session = (opts) => new EditorSession(base(), { log: new EventLog({ enabled: true, trialId: 't1', clock: (() => { let t = 0; return () => (t += 10); })() }), ...opts });

test('EXPLAIN CHANGES NOTHING: layout is byte-identical after explaining every preset', () => {
  const s = session();
  const before = serialize(s.layout);
  const beforeId = s.stateId;

  for (const p of listPresets()) {
    const doc = s.explain(p.id);
    assert.equal(doc.id, p.id);
    assert.ok(doc.description.length > 0);
    assert.equal(serialize(s.layout), before, `explain(${p.id}) mutated the layout`);
  }
  // Open and close repeatedly, including the double-click pattern that applied
  // the transform twice in the shipped build.
  for (let i = 0; i < 5; i++) {
    s.explain('strict-grid');
    s.closeExplanation();
  }

  assert.equal(serialize(s.layout), before);
  assert.equal(s.stateId, beforeId);
  assert.equal(s.history.length, 1, 'explaining must not create history entries');
  assert.equal(
    s.log.events.filter((e) => e.actionType === EVENT_TYPES.PRESET_APPLIED).length,
    0,
    'explaining must never emit a preset.applied event',
  );
});

test('PREVIEW IS UNCOMMITTED: the committed layout is untouched while a preview is pending', () => {
  const s = session();
  const before = serialize(s.layout);

  const p = s.preview('strict-grid');
  assert.ok(s.hasPendingPreview);
  assert.notEqual(p.previewStateId, p.beforeStateId, 'preview should differ from the current state');
  assert.equal(serialize(s.layout), before, 'preview must not commit');
  assert.equal(s.history.length, 1);
});

test('APPLY MATCHES PREVIEW: the exact previewed layout is committed, not a recomputation', () => {
  for (const p of listPresets()) {
    const s = session();
    const preview = s.preview(p.id);
    const committed = s.apply(p.id);

    assert.equal(
      layoutHash(committed),
      preview.previewStateId,
      `apply(${p.id}) committed a different layout than was previewed`,
    );
    assert.equal(serialize(committed), serialize(preview.layout));

    const applied = s.log.events.find((e) => e.actionType === EVENT_TYPES.PRESET_APPLIED);
    assert.equal(applied.committedFromPreview, true);
    assert.equal(applied.afterStateId, preview.previewStateId);
  }
});

test('CANCEL PRESERVES THE STARTING LAYOUT', () => {
  const s = session();
  const before = serialize(s.layout);
  const beforeId = s.stateId;

  s.preview('radial-distribution');
  s.cancelPreview();

  assert.equal(s.hasPendingPreview, false);
  assert.equal(serialize(s.layout), before);
  assert.equal(s.stateId, beforeId);
  assert.equal(s.history.length, 1);

  const types = s.log.typesInOrder();
  assert.deepEqual(types, [EVENT_TYPES.PREVIEW_REQUESTED, EVENT_TYPES.PREVIEW_CANCELLED]);
});

test('a superseded preview is logged as cancelled, never silently dropped', () => {
  const s = session();
  s.preview('strict-grid');
  s.preview('radial-distribution');
  const cancels = s.log.events.filter((e) => e.actionType === EVENT_TYPES.PREVIEW_CANCELLED);
  assert.equal(cancels.length, 1);
  assert.equal(cancels[0].reason, 'superseded');
});

test('apply without a preview still commits and is logged as such', () => {
  const s = session();
  s.apply('strict-grid');
  const ev = s.log.events.find((e) => e.actionType === EVENT_TYPES.PRESET_APPLIED);
  assert.equal(ev.committedFromPreview, false);
  assert.equal(s.history.length, 2);
});

test('EVENT NAMING: apply emits "preset.applied", never an acceptance claim', () => {
  const s = session();
  s.explain('strict-grid');
  s.preview('strict-grid');
  s.apply('strict-grid');

  const types = s.log.typesInOrder();
  assert.deepEqual(types, [
    EVENT_TYPES.EXPLANATION_OPENED,
    EVENT_TYPES.PREVIEW_REQUESTED,
    EVENT_TYPES.PRESET_APPLIED,
  ]);
  const serialized = JSON.stringify(s.log.toJSON());
  assert.ok(!/accept/i.test(serialized), 'the log must not assert acceptance');
  assert.ok(!/useful|agree|suggestion/i.test(serialized), 'the log must not assert usefulness');
});

test('undo/redo build correct history and emit distinct events', () => {
  const s = session();
  const s0 = s.stateId;
  s.apply('strict-grid');
  const s1 = s.stateId;
  s.apply('radial-distribution');
  const s2 = s.stateId;

  assert.equal(s.history.length, 3);
  assert.ok(s.canUndo);
  assert.ok(!s.canRedo);

  s.undo();
  assert.equal(s.stateId, s1);
  s.undo();
  assert.equal(s.stateId, s0);
  assert.ok(!s.canUndo);
  assert.ok(s.canRedo);

  s.redo();
  assert.equal(s.stateId, s1);
  s.redo();
  assert.equal(s.stateId, s2);

  const types = s.log.typesInOrder();
  assert.equal(types.filter((t) => t === EVENT_TYPES.UNDO).length, 2);
  assert.equal(types.filter((t) => t === EVENT_TYPES.REDO).length, 2);
});

test('a new commit truncates the redo branch', () => {
  const s = session();
  s.apply('strict-grid');
  s.apply('radial-distribution');
  s.undo();
  assert.ok(s.canRedo);
  s.apply('size-uniformity');
  assert.ok(!s.canRedo, 'committing after undo discards the redo branch');
  assert.equal(s.history.length, 3);
});

test('manual edits commit and record before/after state and changed properties', () => {
  const s = session();
  const target = s.layout.elements[0];
  s.editElement(target.id, { x: 111, rotation: 45 });
  const ev = s.log.events.find((e) => e.actionType === EVENT_TYPES.MANUAL_EDIT);
  assert.deepEqual([...ev.changedProperties].sort(), ['rotation', 'x']);
  assert.equal(ev.to.x, 111);
  assert.equal(ev.from.x, target.x);
  assert.notEqual(ev.beforeStateId, ev.afterStateId);
});

test('slider gestures coalesce into one committed edit, not forty', () => {
  const raw = [];
  for (let i = 0; i < 40; i++) {
    raw.push({ elementId: 'circle-1', property: 'x', previous: 100 + i, value: 101 + i, t: i * 16 });
  }
  raw.push({ elementId: 'circle-1', property: 'x', previous: 200, value: 260, t: 5000 });
  const out = coalesceEdits(raw, { windowMs: 400 });
  assert.equal(out.length, 2, 'one drag plus one later drag');
  assert.equal(out[0].rawInputCount, 40);
  assert.equal(out[0].from, 100);
  assert.equal(out[0].to, 140);
});

test('event log is append-only and disabled by default', () => {
  const off = new EventLog();
  assert.equal(off.enabled, false);
  assert.equal(off.record(EVENT_TYPES.UNDO, {}), null);
  assert.equal(off.length, 0);

  const on = new EventLog({ enabled: true, trialId: 't' });
  on.record(EVENT_TYPES.UNDO, {});
  // The returned snapshot is deep-frozen: mutation THROWS rather than being
  // silently accepted on a detached copy.
  assert.throws(() => on.events.push({ bogus: true }), TypeError);
  assert.equal(on.length, 1);
  assert.equal(on.events[0].sequenceNumber, 0);
});

test('session state serializes for local recovery, excluding uncommitted previews', () => {
  const s = session();
  s.apply('strict-grid');
  s.preview('radial-distribution');

  const json = s.toJSON();
  assert.equal(json.history.length, 2);
  assert.equal(json.cursor, 1);
  assert.ok(!('preview' in json), 'an uncommitted preview must not be persisted');
});

test('local recovery restores committed history and the score', async () => {
  const store = new MemoryStorage();
  const s = session();
  s.apply('strict-grid');
  s.apply('size-uniformity');
  const expected = score(s.layout).total;

  await store.save('session/t1', s.toJSON());
  const restored = await store.load('session/t1');

  assert.equal(restored.history.length, 3);
  const finalLayout = restored.history[restored.cursor];
  assert.equal(score(finalLayout).total, expected);
});

test('saveOnce is idempotent: a retry creates no duplicate submission', async () => {
  const store = new PilotExport();
  const rec = { trialId: 't1', payload: 'x' };
  const first = await saveOnce(store, 'submission/t1', rec);
  const retry = await saveOnce(store, 'submission/t1', rec);
  const retry2 = await saveOnce(store, 'submission/t1', rec);

  assert.equal(first.duplicate, false);
  assert.equal(retry.duplicate, true);
  assert.equal(retry2.duplicate, true);
  assert.deepEqual(await store.list(), ['submission/t1']);
});

test('pilot storage states plainly that nothing was transmitted', async () => {
  const store = new PilotExport();
  const res = await store.save('k', { a: 1 });
  assert.equal(store.collectionReady, false);
  assert.equal(res.receipt.transmitted, false);
  assert.match(res.receipt.note, /NOT ready/);
});

test('preset registry exposes stable IDs and never relies on a mode number', () => {
  const presets = listPresets();
  assert.equal(presets.length, 12);
  assert.equal(new Set(presets.map((p) => p.id)).size, 12);
  for (const p of presets) {
    assert.match(p.id, /^[a-z][a-z0-9-]*$/, 'IDs are stable slugs');
    assert.ok(p.registryVersion && p.implementationVersion);
    assert.ok(!('modeNumber' in p), 'no human-readable mode number is exposed as an identifier');
  }
  // The manuscript's Study 3 modes genuinely do not exist here.
  for (const missing of ['golden-ratio', 'free-form-grid']) {
    assert.throws(() => getPreset(missing), /unknown preset/);
  }
});

test('presets are pure: applying one never mutates its input', () => {
  for (const p of listPresets()) {
    const input = base();
    const before = serialize(input);
    getPreset(p.id).apply(input);
    assert.equal(serialize(input), before, `preset ${p.id} mutated its input`);
  }
});
