/**
 * Demonstrations required by the milestone checkpoint:
 *   1. Explain changes nothing.
 *   2. Apply commits exactly what Preview showed.
 *   3. Serialization + replay reproduces a session.
 *
 *   node scripts/demo-actions-and-replay.mjs
 */

import { EditorSession } from '../core/actions.js';
import { EventLog } from '../core/events.js';
import { generateLayout } from '../core/generate.js';
import { serialize, layoutHash } from '../core/layout.js';
import { score } from '../core/scoring/v0-as-shipped.js';
import { listPresets } from '../core/presets/registry.js';
import { MemoryStorage } from '../core/storage.js';

const line = (s = '') => console.log(s);
const rule = (t) => { line(); line(`=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`); };

let tick = 0;
const clock = () => (tick += 10);
const newSession = () =>
  new EditorSession(generateLayout({ seed: 2024 }), {
    log: new EventLog({ enabled: true, trialId: 'demo', clock }),
    trialId: 'demo',
  });

// ---------------------------------------------------------------------------
rule('1. EXPLAIN CHANGES NOTHING');

const s1 = newSession();
const before = serialize(s1.layout);
line(`start stateId        ${s1.stateId}`);
line(`committed history    ${s1.history.length}`);

for (const p of listPresets()) s1.explain(p.id);
// The shipped build applied the transform on the collapse branch too; do that
// double-click pattern here as well.
for (let i = 0; i < 5; i++) { s1.explain('strict-grid'); s1.closeExplanation(); }

line(`after explaining all ${listPresets().length} presets + 5 open/close cycles:`);
line(`  stateId            ${s1.stateId}`);
line(`  bytes identical    ${serialize(s1.layout) === before}`);
line(`  history entries    ${s1.history.length}  (unchanged)`);
line(`  preset.applied ev.  ${s1.log.events.filter((e) => e.actionType === 'preset.applied').length}`);

// ---------------------------------------------------------------------------
rule('2. APPLY COMMITS EXACTLY WHAT PREVIEW SHOWED');

line('preset                     beforeState  previewState  committedState  match');
for (const p of listPresets()) {
  const s = newSession();
  const pv = s.preview(p.id);
  const committed = s.apply(p.id);
  const ok = layoutHash(committed) === pv.previewStateId;
  line(
    `${p.id.padEnd(26)} ${pv.beforeStateId}     ${pv.previewStateId}      ${layoutHash(committed)}        ${ok ? 'YES' : 'NO'}`,
  );
  if (!ok) process.exitCode = 1;
}

rule('2b. CANCEL PRESERVES THE STARTING LAYOUT');
const s2 = newSession();
const startId = s2.stateId;
const pv = s2.preview('radial-distribution');
line(`previewed            ${pv.previewStateId}  (uncommitted)`);
line(`committed during     ${s2.stateId}  (unchanged: ${s2.stateId === startId})`);
s2.cancelPreview();
line(`after cancel         ${s2.stateId}  (unchanged: ${s2.stateId === startId})`);
line(`history entries      ${s2.history.length}`);
line(`event sequence       ${s2.log.typesInOrder().join(' -> ')}`);

// ---------------------------------------------------------------------------
rule('3. SERIALIZATION + REPLAY');

const store = new MemoryStorage();
const live = newSession();
const chain = ['strict-grid', 'visual-balance', 'rhythmic-spacing'];

line('live session:');
line(`  generate           ${live.stateId}   total ${score(live.layout).total.toFixed(4)}`);
for (const id of chain) {
  live.preview(id);
  live.apply(id);
  line(`  apply ${id.padEnd(18)} ${live.stateId}   total ${score(live.layout).total.toFixed(4)}`);
}
live.undo();
line(`  undo               ${live.stateId}   total ${score(live.layout).total.toFixed(4)}`);
live.redo();
line(`  redo               ${live.stateId}   total ${score(live.layout).total.toFixed(4)}`);

await store.save('session/demo', live.toJSON());
const restored = await store.load('session/demo');
const finalLayout = restored.history[restored.cursor];

line();
line('restored from storage:');
line(`  history entries    ${restored.history.length}`);
line(`  cursor             ${restored.cursor}`);
line(`  final stateId      ${layoutHash(finalLayout)}`);
line(`  final total        ${score(finalLayout).total.toFixed(4)}`);
line(`  matches live       ${layoutHash(finalLayout) === live.stateId}`);

line();
line('independent replay from seed + preset chain:');
const replay = newSession();
for (const id of chain) replay.apply(id);
line(`  replay stateId     ${replay.stateId}`);
line(`  matches live       ${replay.stateId === live.stateId}`);
if (replay.stateId !== live.stateId) process.exitCode = 1;

// ---------------------------------------------------------------------------
rule('4. EVENT LOG (observed operations only)');
for (const e of live.log.events) {
  const extra = e.presetId ? ` preset=${e.presetId}` : '';
  const states = e.beforeStateId ? ` ${e.beforeStateId}->${e.afterStateId ?? '-'}` : '';
  line(`  #${String(e.sequenceNumber).padStart(2)} +${String(e.elapsedMs).padStart(4)}ms  ${e.actionType.padEnd(20)}${extra}${states}`);
}
line();
line('  Note: "preset.applied" records that a preset was applied. It is NOT');
line('  evidence of acceptance, agreement, or usefulness — those require');
line('  retention data and the participant\'s own explanation.');

// ---------------------------------------------------------------------------
rule('5. STALE PREVIEW IS NEVER COMMITTED');
{
  const s = newSession();
  const pv = s.preview('strict-grid');
  line(`previewed against    ${pv.beforeStateId} -> ${pv.previewStateId}`);
  const target = s.layout.elements.find((e) => e.visible);
  s.editElement(target.id, { x: Math.round(target.x) + 17 });
  line(`manual edit moved committed state to ${s.stateId}`);
  line(`pending preview now  ${s.hasPendingPreview} (dropped as stale)`);
  const committed = s.apply('strict-grid');
  const ev = s.log.events.filter((e) => e.actionType === 'preset.applied').at(-1);
  line(`apply committed      ${layoutHash(committed)}`);
  line(`committedFromPreview ${ev.committedFromPreview}  (false = recomputed from current state)`);
  line(`differs from stale   ${layoutHash(committed) !== pv.previewStateId}`);
  const cancelled = s.log.events.filter((e) => e.actionType === 'preview.cancelled').at(-1);
  line(`cancel reason logged "${cancelled.reason}"`);
  if (layoutHash(committed) === pv.previewStateId) process.exitCode = 1;
}
