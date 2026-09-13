import test from 'node:test';
import assert from 'node:assert/strict';

import { serialize, deserialize, cloneLayout, layoutHash, layoutsEqual, SCHEMA_VERSION } from '../core/layout.js';
import { generateLayout, randomizePositions, GENERATOR_VERSION } from '../core/generate.js';
import { createRng, RNG_ALGORITHM } from '../core/rng.js';
import { score } from '../core/scoring/v0-as-shipped.js';
import { getPreset } from '../core/presets/registry.js';
import { FIXTURES } from './fixtures/layouts.mjs';

test('serialization round-trips exactly', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const layout = generateLayout({ seed });
    const back = deserialize(serialize(layout));
    assert.equal(serialize(back), serialize(layout));
    assert.deepEqual(back.elements, layout.elements);
  }
});

test('round-trip preserves the score exactly', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const layout = generateLayout({ seed });
    const before = score(layout);
    const after = score(deserialize(serialize(layout)));
    assert.deepEqual(after.dimensions, before.dimensions);
    assert.equal(after.total, before.total);
  }
});

test('serialization preserves the ORIGINAL colour string, never normalising it', () => {
  const harmonised = getPreset('color-harmony').apply(generateLayout({ seed: 7 }));
  const back = deserialize(serialize(harmonised));
  for (const e of back.elements.filter((x) => x.visible)) {
    assert.match(e.color, /^hsl\(/, 'hsl() strings must survive serialization verbatim');
  }
  // And the score must therefore still see the defect.
  assert.equal(score(back).submetrics.balanceDegenerate, true);
});

test('serialization is stable regardless of element array order', () => {
  const layout = generateLayout({ seed: 42 });
  const shuffled = { ...layout, elements: [...layout.elements].reverse() };
  assert.equal(serialize(shuffled), serialize(layout), 'order field, not array position, defines drawing order');
});

test('layoutHash distinguishes states and matches for identical states', () => {
  const a = generateLayout({ seed: 3 });
  const b = generateLayout({ seed: 3 });
  const c = generateLayout({ seed: 4 });
  assert.equal(layoutHash(a), layoutHash(b));
  assert.notEqual(layoutHash(a), layoutHash(c));
  assert.ok(layoutsEqual(a, b));
});

test('deserialize rejects an unknown schema version rather than guessing', () => {
  const raw = JSON.parse(serialize(generateLayout({ seed: 1 })));
  raw.schemaVersion = 'layout-99';
  assert.throws(() => deserialize(raw), /unsupported layout schemaVersion/);
});

test('cloneLayout produces an independent copy', () => {
  const a = generateLayout({ seed: 11 });
  const b = cloneLayout(a);
  b.elements[0].x = -999;
  assert.notEqual(a.elements[0].x, -999);
});

test('generation is reproducible: same seed => byte-identical layout', () => {
  for (const seed of [1, 2, 'pilot-A', 'pilot-B', 99999]) {
    assert.equal(serialize(generateLayout({ seed })), serialize(generateLayout({ seed })));
  }
  assert.notEqual(serialize(generateLayout({ seed: 1 })), serialize(generateLayout({ seed: 2 })));
});

test('generated layouts record full RNG and generator provenance', () => {
  const l = generateLayout({ seed: 'pilot-A' });
  assert.equal(l.meta.generator.version, GENERATOR_VERSION);
  assert.equal(l.meta.generator.rngAlgorithm, RNG_ALGORITHM);
  assert.equal(l.meta.generator.seedInput, 'pilot-A');
  assert.equal(typeof l.meta.generator.seed, 'number');
  assert.ok(l.meta.generator.params, 'parameter ranges are recorded, not implied');
});

test('SEED IS NOT SUFFICIENT: the full state is what gets saved', () => {
  // A seed reproduces a generation only under the same generator version.
  // The saved state is the artifact; the seed is provenance metadata.
  const l = generateLayout({ seed: 5 });
  const saved = serialize(l);
  const restored = deserialize(saved);
  assert.equal(serialize(restored), saved);
  assert.ok(saved.length > 500, 'the record contains the state, not just a seed');
});

test('RNG is deterministic and reports its algorithm and version', () => {
  const a = createRng('x');
  const b = createRng('x');
  const seqA = Array.from({ length: 20 }, () => a.next());
  const seqB = Array.from({ length: 20 }, () => b.next());
  assert.deepEqual(seqA, seqB);
  assert.ok(seqA.every((v) => v >= 0 && v < 1));
  assert.equal(a.algorithm, 'mulberry32');
});

test('matched random-position baseline preserves inventory and non-position attributes', () => {
  const base = generateLayout({ seed: 21 });
  const rand = randomizePositions(base, { seed: 'b1' });

  assert.equal(rand.elements.length, base.elements.length);
  for (let i = 0; i < base.elements.length; i++) {
    const a = base.elements[i];
    const b = rand.elements[i];
    for (const k of ['id', 'type', 'index', 'order', 'visible', 'size', 'size2', 'rotation', 'color', 'filled']) {
      assert.equal(b[k], a[k], `${k} must be preserved by the position-only baseline`);
    }
  }
  assert.deepEqual(rand.meta.baseline.randomizedAttributes, ['x', 'y']);
  assert.equal(rand.meta.baseline.kind, 'matched-random-position');
  assert.equal(serialize(randomizePositions(base, { seed: 'b1' })), serialize(rand));
});

test('replay demonstration: generate -> preset chain -> serialize -> restore -> rescore', () => {
  const chain = ['strict-grid', 'visual-balance', 'rhythmic-spacing'];
  let layout = generateLayout({ seed: 123 });
  const trace = [{ step: 'generate', stateId: layoutHash(layout), total: score(layout).total }];
  for (const id of chain) {
    layout = getPreset(id).apply(layout);
    trace.push({ step: id, stateId: layoutHash(layout), total: score(layout).total });
  }

  // Persist and restore the final state, then replay the whole chain fresh.
  const restored = deserialize(serialize(layout));
  assert.equal(layoutHash(restored), trace.at(-1).stateId);

  let replay = generateLayout({ seed: 123 });
  const replayTrace = [{ step: 'generate', stateId: layoutHash(replay), total: score(replay).total }];
  for (const id of chain) {
    replay = getPreset(id).apply(replay);
    replayTrace.push({ step: id, stateId: layoutHash(replay), total: score(replay).total });
  }
  assert.deepEqual(replayTrace, trace, 'the full chain replays identically');
});

test('degenerate fixtures serialize and restore without loss', () => {
  for (const [name, layout] of Object.entries(FIXTURES)) {
    const back = deserialize(serialize(layout));
    assert.equal(serialize(back), serialize(layout), `fixture ${name} failed round-trip`);
  }
});

test('schema version is stamped on every layout', () => {
  assert.equal(generateLayout({ seed: 1 }).schemaVersion, SCHEMA_VERSION);
});
