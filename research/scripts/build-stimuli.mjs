/**
 * Builds the blind-rating stimulus set.
 *
 *   node scripts/build-stimuli.mjs [--n 12] [--seed-offset 0]
 *
 * SEPARATION OF BUNDLES — the point of this script.
 *
 *   study/stimuli/          PARTICIPANT BUNDLE. Layout geometry and integrity
 *                           hashes only. No scores, no condition labels, no
 *                           generating method, no ordering rationale.
 *   study-private/          RESEARCHER ONLY. The key that maps each stimulus id
 *                           to its condition and its v1 score. Never served to
 *                           a participant and never referenced by the app.
 *
 * The app is served from study/; study-private/ is a sibling directory outside
 * it, so a participant-facing static host rooted at study/ cannot reach the key
 * even by guessing a URL.
 *
 * Stimulus ids are opaque (content-hash based). They deliberately carry no hint
 * of condition, score, or generation order.
 */

import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { generateLayout, randomizePositions } from '../core/generate.js';
import { getPreset } from '../core/presets/registry.js';
import { createLayout, serialize, layoutHash } from '../core/layout.js';
import { score as scoreV1 } from '../core/scoring/v1.js';
import { RENDERER_2 } from '../core/geometry.js';
import { createRng } from '../core/rng.js';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? dflt : process.argv[i + 1];
};
const N = Number(arg('n', 12));
const OFFSET = Number(arg('seed-offset', 0));

const ROOT = join(import.meta.dirname, '..');
const PUBLIC_DIR = join(ROOT, 'study', 'stimuli');
const PRIVATE_DIR = join(ROOT, 'study-private');

for (const d of [PUBLIC_DIR, PRIVATE_DIR]) {
  if (existsSync(d)) rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
}

/** Conditions are researcher metadata. They never reach the participant bundle. */
const CONDITIONS = [
  { id: 'structured-grid', build: (l) => getPreset('strict-grid').apply(l) },
  { id: 'radial', build: (l) => getPreset('radial-distribution').apply(l) },
  { id: 'as-generated', build: (l) => l },
  { id: 'random-position', build: (l, seed) => randomizePositions(l, { seed: `stim-rand-${seed}` }) },
];

const publicItems = [];
const privateItems = [];

for (let i = 0; i < N; i++) {
  const seed = OFFSET + i + 1;
  const cond = CONDITIONS[i % CONDITIONS.length];
  const generated = generateLayout({ seed });
  const built = cond.build(generated, seed);

  // Stamp the renderer the stimulus is authored under; it travels with the file.
  const layout = createLayout({
    id: null, // replaced with the opaque id below
    canvas: built.canvas,
    renderer: { gridOverlay: false, gridSize: 8, showArrows: false },
    elements: built.elements,
    meta: { rendererVersion: RENDERER_2, schemaNote: 'blind-rating stimulus' },
  });

  const hash = layoutHash(layout);
  const stimulusId = `stim-${hash}`;
  layout.id = stimulusId;

  const canonical = serialize(layout);
  const integrity = layoutHash(layout);

  // Participant-facing file: geometry + integrity only.
  writeFileSync(join(PUBLIC_DIR, `${stimulusId}.json`), canonical);
  publicItems.push({ stimulusId, file: `stimuli/${stimulusId}.json`, integrity, rendererVersion: RENDERER_2 });

  // Researcher-only record.
  const s = scoreV1(layout);
  privateItems.push({
    stimulusId,
    seed,
    condition: cond.id,
    integrity,
    scoreAvailable: s.scorable,
    v1: s.scorable
      ? { total: s.total, dimensions: s.dimensions, submetrics: s.submetrics }
      : null,
    diagnostics: s.diagnostics,
    modelVersion: s.modelVersion,
    configVersion: s.configVersion,
    approval: s.approval.overall,
  });
}

// One deliberately UNSCORABLE stimulus (3 elements, below minElements = 4).
// It exists to demonstrate the rule that a human rating stays valid when the
// model cannot score the layout. It is a normal, perfectly ratable composition
// to a participant; only the model declines it.
{
  const rng = createRng('unscorable-1');
  const three = createLayout({
    id: 'placeholder',
    canvas: { width: 500, height: 500, background: '#FFFFFF' },
    renderer: { gridOverlay: false, gridSize: 8, showArrows: false },
    elements: [
      { type: 'circle', index: 1, order: 0, visible: true, x: 150, y: 170, size: 90, rotation: 0, color: '#DC2626', filled: true },
      { type: 'square', index: 1, order: 1, visible: true, x: 340, y: 200, size: 110, rotation: 0, color: '#1F2937', filled: true },
      { type: 'triangle', index: 1, order: 2, visible: true, x: 250, y: 360, size: 100, rotation: 0, color: '#D97706', filled: true },
    ],
    meta: { rendererVersion: RENDERER_2, schemaNote: 'blind-rating stimulus' },
  });
  const h = layoutHash(three);
  three.id = `stim-${h}`;
  const integrity = layoutHash(three);
  writeFileSync(join(PUBLIC_DIR, `${three.id}.json`), serialize(three));
  publicItems.push({ stimulusId: three.id, file: `stimuli/${three.id}.json`, integrity, rendererVersion: RENDERER_2 });
  const s3 = scoreV1(three);
  privateItems.push({
    stimulusId: three.id,
    seed: null,
    condition: 'deliberately-unscorable',
    integrity,
    scoreAvailable: s3.scorable,
    v1: null,
    diagnostics: s3.diagnostics,
    modelVersion: s3.modelVersion,
    configVersion: s3.configVersion,
    approval: s3.approval.overall,
  });
}

writeFileSync(join(PUBLIC_DIR, 'manifest.json'), JSON.stringify({
  manifestVersion: 'stimuli-1',
  builtAt: new Date().toISOString(),
  note: 'Participant bundle. Geometry and integrity hashes only - no scores, conditions or methods.',
  count: publicItems.length,
  items: publicItems,
}, null, 2));

writeFileSync(join(PRIVATE_DIR, 'stimulus-key.json'), JSON.stringify({
  keyVersion: 'stimulus-key-2',
  // Identity binding (F2): a join must be able to confirm this key describes the
  // same archived manifest the participant actually saw.
  manifestVersion: 'stimuli-1',
  builtAt: new Date().toISOString(),
  warning: 'RESEARCHER ONLY. Never place this file inside study/. It carries conditions and model scores.',
  approval: 'DEVELOPMENT CANDIDATE - NOT APPROVED. Scores here are not approved measurements.',
  count: privateItems.length,
  items: privateItems,
}, null, 2));

writeFileSync(join(PRIVATE_DIR, 'README.md'),
  `# study-private\n\n`
  + `**Researcher only.** Holds the stimulus key: condition labels and v1 scores.\n\n`
  + `This directory is deliberately a SIBLING of \`study/\`, not inside it, so a\n`
  + `static host rooted at \`study/\` cannot serve it. Do not move it, do not link\n`
  + `to it from the app, and do not copy it into a participant deployment.\n\n`
  + `Scores here come from the v1 **development candidate**. None of S1-S21 is\n`
  + `approved, so these are not approved measurements.\n`);

const unscorable = privateItems.filter((p) => !p.scoreAvailable);
console.log(`built ${publicItems.length} stimuli`);
console.log(`  participant bundle : study/stimuli/        (${publicItems.length} layouts + manifest)`);
console.log(`  researcher key     : study-private/        (conditions + v1 scores)`);
console.log(`  conditions         : ${[...new Set(privateItems.map((p) => p.condition))].join(', ')}`);
console.log(`  unscorable by v1   : ${unscorable.length}${unscorable.length ? ' -> ' + unscorable.map((u) => u.stimulusId).join(',') : ''}`);
console.log('\nParticipant bundle leak check:');
const pub = JSON.stringify(publicItems);
for (const term of ['condition', 'score', 'total', 'strict-grid', 'radial', 'random-position', 'seed']) {
  console.log(`  contains "${term}": ${pub.includes(term)}`);
}
