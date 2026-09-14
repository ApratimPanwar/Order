/**
 * GOOGLE FORMS SURVEY PIPELINE
 *
 *   rasterizer -> prepare-forms-build -> check-images -> FormsBuilder.gs -> export-analysis
 *
 * The Apps Script builder runs here against an in-memory FormApp fake that
 * implements only the calls the builder makes. What the fake cannot prove —
 * Google's own behaviour for settings, destinations and image storage — is left
 * to the authorised first run and the rehearsal checklist.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync, cpSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { crc32 as zlibCrc32 } from 'node:zlib';

import { rasterizeLayout, encodePng, decodePng, PNG_SIGNATURE } from '../core/rasterize.js';
import { createLayout } from '../core/layout.js';

const ROOT = join(import.meta.dirname, '..');
const BUILDER_DIR = join(ROOT, '..', 'forms-builder');
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const run = (script, args) => {
  try {
    return { code: 0, out: execFileSync(process.execPath, [join(ROOT, script), ...args], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), err: '' };
  } catch (e) { return { code: e.status, out: String(e.stdout ?? ''), err: String(e.stderr ?? '') }; }
};

/* ---------------------------------------------------------------------------
 * rasterizer
 * ------------------------------------------------------------------------ */

const single = (el) => createLayout({
  id: 't', canvas: { width: 500, height: 500, background: '#FFFFFF' },
  renderer: { gridOverlay: false, gridSize: 8, showArrows: false },
  elements: [{ id: 'e', type: 'square', index: 1, order: 0, visible: true, x: 250, y: 250, size: 100, size2: 100, rotation: 0, color: '#000000', filled: true, ...el }],
  meta: { rendererVersion: 'renderer-2' },
});
const darkness = (img) => { let s = 0; for (let i = 0; i < img.rgb.length; i += 3) s += (255 - img.rgb[i]) / 255; return s; };

test('RASTER: filled shapes cover their analytic area', () => {
  assert.ok(Math.abs(darkness(rasterizeLayout(single({}))) - 10000) < 60, 'square 100x100');
  assert.ok(Math.abs(darkness(rasterizeLayout(single({ type: 'circle' }))) - Math.PI * 2500) < 60, 'circle d=100');
  assert.ok(Math.abs(darkness(rasterizeLayout(single({ type: 'rectangle', size2: 50 }))) - 5000) < 60, 'rectangle 100x50');
  const tri = (Math.sqrt(3) / 4) * 100 * 100;
  assert.ok(Math.abs(darkness(rasterizeLayout(single({ type: 'triangle' }))) - tri) < 60, 'equilateral triangle side 100');
});

test('RASTER: outlines are a 3-unit stroke centred on the outline', () => {
  const ring = darkness(rasterizeLayout(single({ filled: false })));
  // outer (103^2) minus inner (97^2) = 1200 for miter-joined squares
  assert.ok(Math.abs(ring - (103 * 103 - 97 * 97)) < 40, `square outline ${ring}`);
  const circle = darkness(rasterizeLayout(single({ type: 'circle', filled: false })));
  assert.ok(Math.abs(circle - Math.PI * (51.5 ** 2 - 48.5 ** 2)) < 40, `circle outline ${circle}`);
});

test('RASTER: rotation follows the canvas renderer and circles ignore it', () => {
  const a = rasterizeLayout(single({ type: 'circle', rotation: 0 }));
  const b = rasterizeLayout(single({ type: 'circle', rotation: 73 }));
  assert.ok(Buffer.from(a.rgb).equals(Buffer.from(b.rgb)));
  // A 45-degree square reaches further horizontally than an unrotated one.
  const r45 = rasterizeLayout(single({ rotation: 45 }));
  const row = 250;
  let first = -1;
  for (let x = 0; x < 500; x++) if (r45.rgb[(row * 500 + x) * 3] < 128) { first = x; break; }
  assert.ok(Math.abs(first - (250 - 50 * Math.SQRT2)) <= 1.5, `diamond left tip at ${first}`);
});

test('RASTER: painter order is ascending `order`, and renderer-2 triangles are centroid-centred', () => {
  const L = single({});
  L.elements.push({ id: 'f', type: 'square', index: 2, order: 1, visible: true, x: 250, y: 250, size: 40, size2: 40, rotation: 0, color: '#FF0000', filled: true });
  const img = rasterizeLayout(L);
  const k = (250 * 500 + 250) * 3;
  assert.deepEqual([img.rgb[k], img.rgb[k + 1], img.rgb[k + 2]], [255, 0, 0], 'later order draws on top');
  const tri = rasterizeLayout(single({ type: 'triangle', size: 120 }));
  let sx = 0; let sy = 0; let w = 0;
  for (let y = 0; y < 500; y++) for (let x = 0; x < 500; x++) { const d = (255 - tri.rgb[(y * 500 + x) * 3]) / 255; sx += d * (x + 0.5); sy += d * (y + 0.5); w += d; }
  assert.ok(Math.abs(sx / w - 250) < 0.5 && Math.abs(sy / w - 250) < 0.5, 'centroid at (x, y)');
});

test('RASTER: output is byte-deterministic and the PNG carries no metadata', () => {
  const L = single({ type: 'triangle', rotation: 17, filled: false, color: '#65A30D' });
  const a = encodePng(rasterizeLayout(L, { width: 750, height: 750 }));
  const b = encodePng(rasterizeLayout(L, { width: 750, height: 750 }));
  assert.ok(a.equals(b));
  const d = decodePng(a);
  assert.deepEqual(d.chunks, ['IHDR', 'IDAT', 'IEND']);
  assert.equal(d.width, 750);
  const broken = Buffer.from(a); broken[40] ^= 0xff;
  assert.throws(() => decodePng(broken), /bad CRC|incorrect|invalid/i);
  assert.ok(a.subarray(0, 8).equals(PNG_SIGNATURE));
});

/* ---------------------------------------------------------------------------
 * build preparation, image checks, builder, exporter — on a tiny private corpus
 * ------------------------------------------------------------------------ */

let work; let corpus; let build;
before(() => {
  work = mkdtempSync(join(tmpdir(), 'order-forms-'));
  corpus = join(work, 'corpus');
  build = join(work, 'build');
  mkdirSync(corpus, { recursive: true });
  writeFileSync(join(corpus, 'corpus-plan.json'), JSON.stringify({
    planFormat: 'corpus-plan-1', purpose: 'rehearsal', status: 'rehearsal-only',
    design: 'matched-pairs/strict-grid-vs-position-twin', candidateDraws: 60,
    elementCount: { min: 4, max: 16 },
    strata: [{ id: 'any', positiveDeltaQuantile: [0, 1], pairs: 4 }],
    includeDeliberatelyUnsupportedItem: false,
  }));
  const c = run('scripts/build-study-corpus.mjs', ['--private-dir', corpus, '--label', 'forms-test']);
  assert.equal(c.code, 0, c.err);
  const p = run('scripts/forms/prepare-forms-build.mjs', ['--private-dir', corpus, '--out', build, '--mode', 'rehearsal', '--variants', '4', '--codes', '8', '--image-size', '300']);
  assert.equal(p.code, 0, p.err);
});
after(() => { if (work) rmSync(work, { recursive: true, force: true }); });

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

test('PREPARE: private outputs, opaque image keys, and no research metadata reach Apps Script', () => {
  const plan = readJson(join(build, 'build-plan.json'));
  const mapping = readJson(join(build, 'mapping.json'));
  const key = readJson(join(corpus, 'stimulus-key.json'));
  assert.equal(plan.mode, 'rehearsal');
  assert.equal(plan.dataClass, 'development-rehearsal');
  assert.equal(plan.images.length, 8);
  const gs = readdirSync(join(build, 'apps-script')).map((f) => readFileSync(join(build, 'apps-script', f), 'utf8')).join('\n');
  for (const it of key.items) {
    assert.ok(!gs.includes(it.stimulusId), 'no stimulus ID in the Apps Script project');
    assert.ok(!gs.includes(it.pairId), 'no pair ID in the Apps Script project');
  }
  for (const word of ['stimulusId', 'pairId', 'stratum', 'grid-source', 'position-twin', 'v1Total', 'submetrics', 'secretNamespace', 'generatorSeed']) {
    assert.ok(!gs.includes(word), `${word} must not reach Apps Script`);
  }
  for (const f of readdirSync(join(build, 'images'))) assert.match(f, /^img-[0-9a-f]{10}\.png$/);
  assert.equal(mapping.images.length, 8);
  assert.match(plan.planDigest, /^[0-9a-f]{64}$/);
  assert.equal(plan.corpus.keySha256, sha256(readFileSync(join(corpus, 'stimulus-key.json'))));
});

test('PREPARE: defaults keep grading, feedback, summaries, email, sign-in and edits off, and build closed', () => {
  const { settings } = readJson(join(build, 'build-plan.json'));
  assert.deepEqual(settings, {
    isQuiz: false, collectEmail: false, requireLogin: false, limitOneResponsePerUser: false,
    allowResponseEdits: false, publishingSummary: false, showLinkToRespondAgain: false,
    progressBar: true, shuffleQuestions: false, acceptingResponses: false,
  });
});

test('PREPARE: recorded order variants show every stimulus once, rotate evenly, and never place pair members adjacently', () => {
  const mapping = readJson(join(build, 'mapping.json'));
  assert.equal(mapping.variants.length, 4);
  const positions = new Map();
  for (const v of mapping.variants) {
    assert.equal(new Set(v.sections.map((s) => s.stimulusId)).size, 8);
    v.sections.forEach((s, i) => {
      const next = v.sections[(i + 1) % v.sections.length];
      assert.notEqual(s.pairId, next.pairId, `form ${v.variant} position ${s.position}`);
      if (!positions.has(s.stimulusId)) positions.set(s.stimulusId, []);
      positions.get(s.stimulusId).push(s.position);
    });
    const titles = v.sections.flatMap((s) => [s.orderTitle, s.appealTitle]);
    assert.equal(new Set(titles).size, titles.length);
  }
  for (const [, pos] of positions) assert.equal(new Set(pos).size, 4, 'each stimulus appears at 4 different positions');
  const base = mapping.variants[0].sections.map((s) => s.stimulusId);
  mapping.variants.forEach((v, k) => {
    const shift = Math.round((k * 8) / 4) % 8;
    assert.deepEqual(v.sections.map((s) => s.stimulusId), [...base.slice(shift), ...base.slice(0, shift)]);
  });
});

test('PREPARE: issued study codes match the pattern and are assigned across forms', () => {
  const plan = readJson(join(build, 'build-plan.json'));
  const rows = readFileSync(join(build, 'issued-codes.csv'), 'utf8').trim().split('\n').slice(1).map((l) => l.split(','));
  assert.equal(rows.length, 8);
  const re = new RegExp(plan.codePattern);
  for (const [code, variant] of rows) { assert.match(code, re); assert.match(variant, /^[ABCD]$/); }
  assert.equal(new Set(rows.map((r) => r[0])).size, 8);
});

test('PREPARE: refuses development stimuli, study mode without approvals, rehearsing on a study corpus, and reuse of a build directory', () => {
  // development stimulus smuggled into the corpus
  const tainted = join(work, 'tainted');
  cpSync(corpus, tainted, { recursive: true });
  const dev = readJson(join(ROOT, 'study', 'stimuli', 'manifest.json')).items[0];
  const man = readJson(join(tainted, 'public-staging', 'stimuli', 'manifest.json'));
  const key = readJson(join(tainted, 'stimulus-key.json'));
  const victim = man.items[0].stimulusId;
  man.items[0].stimulusId = dev.stimulusId;
  key.items.find((it) => it.stimulusId === victim).stimulusId = dev.stimulusId;
  writeFileSync(join(tainted, 'public-staging', 'stimuli', 'manifest.json'), JSON.stringify(man));
  writeFileSync(join(tainted, 'stimulus-key.json'), JSON.stringify(key));
  const r1 = run('scripts/forms/prepare-forms-build.mjs', ['--private-dir', tainted, '--out', join(work, 'b1'), '--mode', 'rehearsal']);
  assert.equal(r1.code, 2);
  assert.match(r1.err, /reuses development stimuli/);

  const r2 = run('scripts/forms/prepare-forms-build.mjs', ['--private-dir', corpus, '--out', join(work, 'b2'), '--mode', 'study']);
  assert.equal(r2.code, 2);
  assert.match(r2.err, /approved study plan/);

  const studyish = join(work, 'studyish');
  cpSync(corpus, studyish, { recursive: true });
  const k2 = readJson(join(studyish, 'stimulus-key.json'));
  k2.purpose = 'study'; k2.planStatus = 'approved';
  writeFileSync(join(studyish, 'stimulus-key.json'), JSON.stringify(k2));
  const r3 = run('scripts/forms/prepare-forms-build.mjs', ['--private-dir', studyish, '--out', join(work, 'b3'), '--mode', 'study']);
  assert.equal(r3.code, 2);
  assert.match(r3.err, /approvals are recorded by the investigator/);
  assert.ok(!existsSync(join(studyish, 'approvals.json')), 'the script never creates an approval');
  const r4 = run('scripts/forms/prepare-forms-build.mjs', ['--private-dir', studyish, '--out', join(work, 'b4'), '--mode', 'rehearsal']);
  assert.equal(r4.code, 2);
  assert.match(r4.err, /never rehearse on the study corpus/);

  const r5 = run('scripts/forms/prepare-forms-build.mjs', ['--private-dir', corpus, '--out', build, '--mode', 'rehearsal']);
  assert.equal(r5.code, 2);
  assert.match(r5.err, /not empty/);

  const r6 = run('scripts/forms/prepare-forms-build.mjs', ['--private-dir', join(ROOT, 'study-private'), '--out', join(work, 'b6'), '--mode', 'rehearsal']);
  assert.equal(r6.code, 2);
  assert.match(r6.err, /inside the git work tree/);
});

test('PREPARE: study mode needs every approval, including the Forms wording, and cannot build open', () => {
  const studyC = join(work, 'study-corpus');
  cpSync(corpus, studyC, { recursive: true });
  const k = readJson(join(studyC, 'stimulus-key.json'));
  k.purpose = 'study'; k.planStatus = 'approved';
  writeFileSync(join(studyC, 'stimulus-key.json'), JSON.stringify(k));
  writeFileSync(join(studyC, 'approvals.json'), JSON.stringify({
    approvalFormat: 'investigator-approval-2', approvedBy: 'fixture', specFreezeId: 'f', ethicsReviewStatus: 'fixture',
    s1_s21: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`S${i + 1}`, 'accept'])),
    scorerRevision2: { 'R2-1': 'accept', 'R2-2': 'accept', 'R2-3': 'pending' },
    protocolApproved: true, participantWordingApproved: true, collectionProcedureApproved: true, corpusApproved: true,
    formsApproval: { formTitle: 't', participantInformation: 'p', consentQuestion: 'c', agreeChoice: 'a', declineChoice: 'd', codeQuestion: 'q', variants: 4, settingsOverrides: { acceptingResponses: true, collectEmail: 'yes' } },
  }));
  const r = run('scripts/forms/prepare-forms-build.mjs', ['--private-dir', studyC, '--out', join(work, 'bs'), '--mode', 'study', '--variants', '4']);
  assert.equal(r.code, 2);
  assert.match(r.err, /R2-3/);
  assert.match(r.err, /confirmationMessage is missing/);
  assert.match(r.err, /always built closed/);
  assert.match(r.err, /collectEmail must be boolean/);
});

test('IMAGES: a fresh build passes every check', () => {
  const r = run('scripts/forms/check-images.mjs', ['--private-dir', corpus, '--build', build]);
  assert.equal(r.code, 0, r.out + r.err);
  const report = readJson(join(build, 'image-check-report.json'));
  assert.equal(report.passed, true);
  for (const img of report.perImage) {
    for (const c of ['digest', 'format', 'source', 'reproduce', 'content', 'geometry', 'colours']) assert.equal(img.checks[c], 'pass', `${img.imageKey} ${c}`);
  }
});

test('IMAGES: altered pixels, altered source layouts and metadata chunks are caught', () => {
  const copy = join(work, 'tamper-build');
  cpSync(build, copy, { recursive: true });
  const f = readdirSync(join(copy, 'images'))[0];
  const png = readFileSync(join(copy, 'images', f));
  // Re-encode with one pixel changed: valid PNG, wrong content.
  const d = decodePng(png); d.rgb[0] = 17;
  writeFileSync(join(copy, 'images', f), encodePng(d));
  let r = run('scripts/forms/check-images.mjs', ['--private-dir', corpus, '--build', copy]);
  assert.equal(r.code, 1);
  assert.match(r.out, /digest/);
  assert.match(r.out, /reproduce/);

  // A metadata chunk inserted before IEND.
  const iend = png.length - 12;
  const text = Buffer.from('Comment\0stim-deadbeef');
  const len = Buffer.alloc(4); len.writeUInt32BE(text.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlibCrc32(Buffer.concat([Buffer.from('tEXt'), text])) >>> 0);
  const withText = Buffer.concat([png.subarray(0, iend), len, Buffer.from('tEXt'), text, crc, png.subarray(iend)]);
  assert.deepEqual(decodePng(withText).chunks, ['IHDR', 'IDAT', 'tEXt', 'IEND'], 'a valid PNG carrying a text chunk');
  const metaBuild = join(work, 'meta-build');
  cpSync(build, metaBuild, { recursive: true });
  writeFileSync(join(metaBuild, 'images', f), withText);
  r = run('scripts/forms/check-images.mjs', ['--private-dir', corpus, '--build', metaBuild]);
  assert.equal(r.code, 1);
  assert.match(r.out, /unexpected chunks IHDR,IDAT,tEXt,IEND/, 'metadata that could carry identifiers is rejected');

  const corpusCopy = join(work, 'tamper-corpus');
  cpSync(corpus, corpusCopy, { recursive: true });
  const man = readJson(join(corpusCopy, 'public-staging', 'stimuli', 'manifest.json'));
  const lp = join(corpusCopy, 'public-staging', man.items[0].file);
  writeFileSync(lp, readFileSync(lp, 'utf8').replace(/"x":\s*([0-9.]+)/, (m, v) => `"x":${Number(v) + 5}`));
  r = run('scripts/forms/check-images.mjs', ['--private-dir', corpusCopy, '--build', build]);
  assert.equal(r.code, 1);
  assert.match(r.out, /source layout changed/);
});

/* ---------------------------------------------------------------------------
 * FormsBuilder.gs against a FormApp fake
 * ------------------------------------------------------------------------ */

function fakeGoogle() {
  let nextId = 1000;
  const forms = [];
  const files = [];
  const props = new Map();
  class Item {
    constructor(type, form) { this.id = nextId++; this.type = type; this.form = form; this.title = ''; this.help = ''; this.required = false; }
    getId() { return this.id; }
    getType() { return this.type; }
    getTitle() { return this.title; }
    setTitle(t) { this.title = t; return this; }
    setHelpText(t) { this.help = t; return this; }
    setRequired(b) { this.required = b; return this; }
    isRequired() { return this.required; }
    setBounds(lo, hi) { this.lo = lo; this.hi = hi; return this; }
    setLabels(a, b) { this.labels = [a, b]; return this; }
    getLowerBound() { return this.lo; }
    getUpperBound() { return this.hi; }
    asScaleItem() { return this; }
    setImage(blob) { this.image = blob; return this; }
    setAlignment(a) { this.alignment = a; return this; }
    setWidth(w) { this.width = w; return this; }
    createChoice(value, nav) { return { value, nav }; }
    setChoices(c) { this.choices = c; return this; }
    setValidation(v) { this.validation = v; return this; }
    createResponse(v) { return { item: this, value: v }; }
  }
  class Form {
    constructor(title) {
      this.id = `form-${nextId++}`; this.title = title; this.items = [];
      this.s = { isQuiz: false, collectEmail: false, requireLogin: false, limitOne: false, edits: false, summary: false, again: true, progress: false, shuffle: false, accepting: true };
    }
    add(type) { const i = new Item(type, this); this.items.push(i); return i; }
    getId() { return this.id; }
    setDescription(d) { this.description = d; return this; }
    setConfirmationMessage(m) { this.confirmation = m; return this; }
    setIsQuiz(b) { this.s.isQuiz = b; return this; } isQuiz() { return this.s.isQuiz; }
    setCollectEmail(b) { this.s.collectEmail = b; return this; } collectsEmail() { return this.s.collectEmail; }
    setRequireLogin() { throw new Error('Only available for Google Workspace users'); } requiresLogin() { throw new Error('Only available for Google Workspace users'); }
    setLimitOneResponsePerUser(b) { this.s.limitOne = b; return this; } hasLimitOneResponsePerUser() { return this.s.limitOne; }
    setAllowResponseEdits(b) { this.s.edits = b; return this; } canEditResponse() { return this.s.edits; }
    setPublishingSummary(b) { this.s.summary = b; return this; } isPublishingSummary() { return this.s.summary; }
    setShowLinkToRespondAgain(b) { this.s.again = b; return this; } hasRespondAgainLink() { return this.s.again; }
    setProgressBar(b) { this.s.progress = b; return this; } hasProgressBar() { return this.s.progress; }
    setShuffleQuestions(b) { this.s.shuffle = b; return this; } getShuffleQuestions() { return this.s.shuffle; }
    setAcceptingResponses(b) { this.s.accepting = b; return this; } isAcceptingResponses() { return this.s.accepting; }
    addMultipleChoiceItem() { return this.add('MULTIPLE_CHOICE'); }
    addPageBreakItem() { return this.add('PAGE_BREAK'); }
    addTextItem() { return this.add('TEXT'); }
    addImageItem() { return this.add('IMAGE'); }
    addScaleItem() { return this.add('SCALE'); }
    getItems() { return this.items; }
    setDestination(type, id) { this.destination = { type, id }; return this; }
    getDestinationId() { return this.destination && this.destination.id; }
    getPublishedUrl() { return `https://docs.google.com/forms/d/e/${this.id}/viewform`; }
    getEditUrl() { return `https://docs.google.com/forms/d/${this.id}/edit`; }
    createResponse() { const self = this; return { withItemResponse(r) { return { toPrefilledUrl: () => `${self.getPublishedUrl()}?entry.${r.item.id}=${r.value}` }; } }; }
  }
  const b64 = (s) => [...Buffer.from(s, 'base64')].map((x) => (x > 127 ? x - 256 : x));
  const globals = {
    FormApp: {
      create: (t) => { const f = new Form(t); forms.push(f); return f; },
      openById: (id) => forms.find((f) => f.id === id),
      PageNavigationType: { CONTINUE: 'CONTINUE', SUBMIT: 'SUBMIT' },
      DestinationType: { SPREADSHEET: 'SPREADSHEET' },
      Alignment: { CENTER: 'CENTER' },
      ItemType: { SCALE: 'SCALE', IMAGE: 'IMAGE', PAGE_BREAK: 'PAGE_BREAK' },
      createTextValidation: () => { const v = {}; const bld = { setHelpText: (h) => { v.help = h; return bld; }, requireTextMatchesPattern: (p) => { v.pattern = p; return bld; }, build: () => v }; return bld; },
    },
    Utilities: {
      base64Decode: b64,
      computeDigest: (_alg, bytes) => [...createHash('sha256').update(Buffer.from(bytes.map((x) => (x + 256) % 256))).digest()].map((x) => (x > 127 ? x - 256 : x)),
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      newBlob: (data, type, name) => ({ data, type, name }),
    },
    Drive: {
      Files: {
        create: (meta, blob) => { const id = `drive-${nextId++}`; files.push({ id, meta, blob }); return { id }; },
        list: ({ q }) => ({ files: files.filter((f) => q.includes(`'${f.meta.name}'`) && f.meta.mimeType === 'application/vnd.google-apps.folder').map((f) => ({ id: f.id })) }),
      },
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (props.has(k) ? props.get(k) : null), setProperty: (k, v) => props.set(k, String(v)) }) },
    Logger: { log: () => {} },
  };
  return { globals, forms, files, props };
}

function loadBuilder(g) {
  const src = ['FormsBuilder.gs'].map((f) => readFileSync(join(BUILDER_DIR, f), 'utf8'))
    .concat(readdirSync(join(build, 'apps-script')).sort().map((f) => readFileSync(join(build, 'apps-script', f), 'utf8'))).join('\n;\n');
  const ctx = vm.createContext({ console, JSON, Math, Object, Array, String, Number, Error, Date, ...g.globals });
  vm.runInContext(src, ctx);
  return ctx;
}

test('BUILDER: builds one closed form per variant with consent, study code and a page per composition', () => {
  const g = fakeGoogle();
  const ctx = loadBuilder(g);
  const plan = readJson(join(build, 'build-plan.json'));
  const record = ctx.buildRatingForms();
  assert.equal(g.forms.length, 4);
  assert.equal(record.settingProblems.length, 0, JSON.stringify(record.settingProblems));
  for (const [i, form] of g.forms.entries()) {
    const v = plan.variants[i];
    assert.equal(form.title, v.formTitle);
    assert.equal(form.s.accepting, false, 'built closed');
    assert.equal(form.s.isQuiz, false);
    assert.equal(form.s.collectEmail, false);
    assert.equal(form.s.summary, false);
    assert.equal(form.s.limitOne, false);
    assert.equal(form.s.edits, false);
    assert.equal(form.destination.type, 'SPREADSHEET');
    assert.equal(form.destination.id, record.spreadsheetId, 'every form writes to the one private spreadsheet');
    const [consent, codePage, code, ...rest] = form.items;
    assert.equal(consent.type, 'MULTIPLE_CHOICE');
    assert.equal(consent.required, true);
    assert.equal(JSON.stringify(consent.choices), JSON.stringify([{ value: plan.texts.agreeChoice, nav: 'CONTINUE' }, { value: plan.texts.declineChoice, nav: 'SUBMIT' }]));
    assert.equal(codePage.type, 'PAGE_BREAK');
    assert.equal(code.type, 'TEXT');
    assert.equal(code.required, true);
    assert.equal(code.validation.pattern, plan.codePattern);
    assert.equal(rest.length, 4 * v.sections.length);
    v.sections.forEach((s, k) => {
      const [page, image, order, appeal] = rest.slice(4 * k, 4 * k + 4);
      assert.equal(page.type, 'PAGE_BREAK');
      assert.equal(page.title, s.sectionTitle);
      assert.equal(image.type, 'IMAGE');
      assert.equal(image.title, '', 'the image item carries no identifying title');
      const bytes = Buffer.from(image.image.data.map((x) => (x + 256) % 256));
      assert.equal(sha256(bytes), plan.images.find((im) => im.imageKey === s.imageKey).pngSha256, 'the planned image, byte for byte');
      for (const [item, title] of [[order, s.orderTitle], [appeal, s.appealTitle]]) {
        assert.equal(item.type, 'SCALE');
        assert.equal(item.title, title);
        assert.equal(item.required, true);
        assert.equal(item.lo, 1);
        assert.equal(item.hi, 7);
      }
    });
  }
  const recordFile = g.files.find((f) => f.meta.name.startsWith('forms-build-record-'));
  assert.ok(recordFile, 'the build record is written privately to Drive');
  assert.equal(JSON.parse(recordFile.blob.data).planDigest, plan.planDigest);
  assert.equal(record.forms[0].settings.requireLogin.unsupported !== undefined, true, 'a Workspace-only setting is recorded as unsupported, not assumed');
});

test('BUILDER: runs once, refuses a mismatched image, and never opens forms without recorded authorisation', () => {
  const g = fakeGoogle();
  const ctx = loadBuilder(g);
  ctx.buildRatingForms();
  assert.throws(() => ctx.buildRatingForms(), /already built/);
  assert.throws(() => ctx.openRatingForms(), /not authorised/);
  assert.ok(g.forms.every((f) => f.s.accepting === false));
  assert.deepEqual([...ctx.verifyRatingForms()], []);
  g.forms[1].s.summary = true;
  assert.ok(ctx.verifyRatingForms().some((p) => /publishes a response summary/.test(p)), 'verification notices a changed setting');

  const g2 = fakeGoogle();
  const ctx2 = loadBuilder(g2);
  const firstKey = Object.keys(ctx2.STIMULUS_IMAGES)[0];
  ctx2.STIMULUS_IMAGES[firstKey] = Buffer.from('not the planned image').toString('base64');
  assert.throws(() => ctx2.buildRatingForms(), /refusing to build/);
  assert.equal(g2.forms.length, 0, 'nothing is created when an image fails its check');

  const g3 = fakeGoogle();
  const ctx3 = loadBuilder(g3);
  ctx3.buildRatingForms();
  g3.props.set('AUTHORIZED_TO_OPEN', ctx3.BUILD_PLAN.planDigest);
  ctx3.openRatingForms();
  assert.ok(g3.forms.every((f) => f.s.accepting === true));
  ctx3.closeRatingForms();
  assert.ok(g3.forms.every((f) => f.s.accepting === false));
});

test('BUILDER: declares only the Forms scope and file-level Drive access', () => {
  const manifest = readJson(join(BUILDER_DIR, 'appsscript.json'));
  assert.deepEqual(manifest.oauthScopes.sort(), ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/forms']);
  assert.equal(manifest.webapp, undefined, 'the builder is not a web app and exposes no endpoint');
});

/* ---------------------------------------------------------------------------
 * analysis exporter
 * ------------------------------------------------------------------------ */

function responseCsv(plan, variant, rows) {
  const v = plan.variants.find((x) => x.variant === variant);
  const header = ['Timestamp', plan.texts.consentQuestion, plan.texts.codeQuestion, ...v.sections.flatMap((s) => [s.orderTitle, s.appealTitle])];
  const q = (s) => (/[",\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s));
  return `${[header, ...rows].map((r) => r.map(q).join(',')).join('\n')}\n`;
}

test('EXPORT: joins each rating to its frozen score by stimulus ID, whatever the presentation order', () => {
  const plan = readJson(join(build, 'build-plan.json'));
  const mapping = readJson(join(build, 'mapping.json'));
  const key = readJson(join(corpus, 'stimulus-key.json'));
  const codes = readFileSync(join(build, 'issued-codes.csv'), 'utf8').trim().split('\n').slice(1).map((l) => l.split(','));
  const codeFor = (variant) => codes.find((c) => c[1] === variant)[0];
  const n = mapping.variants[0].sections.length;
  // Participant ratings encode the stimulus: order = position of the stimulus in variant A (1..n mod 7 + 1)
  const aOrder = mapping.variants[0].sections.map((s) => s.stimulusId);
  const ratingFor = (id) => (aOrder.indexOf(id) % 7) + 1;
  const csvB = responseCsv(plan, 'B', [['9/14/2026 10:00:00', plan.texts.agreeChoice, codeFor('B'),
    ...mapping.variants[1].sections.flatMap((s) => [ratingFor(s.stimulusId), 8 - ratingFor(s.stimulusId)])]]);
  const csvA = responseCsv(plan, 'A', [['9/14/2026 10:05:00', plan.texts.agreeChoice, codeFor('A'),
    ...mapping.variants[0].sections.flatMap((s) => [ratingFor(s.stimulusId), 8 - ratingFor(s.stimulusId)])]]);
  const dir = join(work, 'export-ok');
  mkdirSync(dir);
  writeFileSync(join(dir, 'b.csv'), csvB); writeFileSync(join(dir, 'a.csv'), csvA);
  const out = join(work, 'export-ok-out');
  const r = run('scripts/forms/export-analysis.mjs', ['--private-dir', corpus, '--build', build, '--responses', join(dir, 'b.csv'), '--responses', join(dir, 'a.csv'), '--issued-codes', join(build, 'issued-codes.csv'), '--out', out]);
  assert.equal(r.code, 0, r.err);
  const lines = readFileSync(join(out, 'ratings-long.csv'), 'utf8').trim().split('\n');
  const cols = lines[0].split(',');
  const rows = lines.slice(1).map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v])));
  assert.equal(rows.length, 2 * n);
  const byKey = new Map(key.items.map((it) => [it.stimulusId, it]));
  for (const row of rows) {
    assert.equal(Number(row.perceivedOrder), ratingFor(row.stimulusId), 'the rating landed on the right stimulus');
    assert.equal(Number(row.appeal), 8 - ratingFor(row.stimulusId));
    assert.equal(Number(row.v1Total), byKey.get(row.stimulusId).v1.total, 'the frozen score of that stimulus');
    assert.equal(row.pairId, byKey.get(row.stimulusId).pairId);
    assert.equal(row.exclusionRules, 'X3-development-rehearsal', 'rehearsal rows are excluded from the study dataset');
  }
  const summary = readJson(join(out, 'summary.json'));
  assert.equal(summary.files.map((f) => f.variant).sort().join(''), 'AB', 'variants identified by header, not file name');
  const again = run('scripts/forms/export-analysis.mjs', ['--private-dir', corpus, '--build', build, '--responses', join(dir, 'a.csv'), '--out', out]);
  assert.equal(again.code, 4, 'an export is never overwritten');
});

test('EXPORT: exclusion rules for declined consent, bad, unissued, wrong-form, duplicate and withdrawn codes, and invalid ratings', () => {
  const plan = readJson(join(build, 'build-plan.json'));
  const mapping = readJson(join(build, 'mapping.json'));
  const codes = readFileSync(join(build, 'issued-codes.csv'), 'utf8').trim().split('\n').slice(1).map((l) => l.split(','));
  const aCodes = codes.filter((c) => c[1] === 'A').map((c) => c[0]);
  const bCode = codes.find((c) => c[1] === 'B')[0];
  const full = (code, consent = plan.texts.agreeChoice, override) => ['t', consent, code, ...mapping.variants[0].sections.flatMap(() => (override ?? [4, 4]))];
  const csv = responseCsv(plan, 'A', [
    ['t', plan.texts.declineChoice, '', ...mapping.variants[0].sections.flatMap(() => ['', ''])],
    full('bad-code'),
    full('ZZZZ-ZZZZ'),
    full(bCode),
    full(aCodes[0]),
    full(aCodes[0]),
    full(aCodes[1], plan.texts.agreeChoice, [9, 4]),
  ]);
  const dir = join(work, 'export-rules'); mkdirSync(dir);
  writeFileSync(join(dir, 'a.csv'), csv);
  writeFileSync(join(dir, 'withdrawn.txt'), `${aCodes[1]}\n`);
  const out = join(work, 'export-rules-out');
  const r = run('scripts/forms/export-analysis.mjs', ['--private-dir', corpus, '--build', build, '--responses', join(dir, 'a.csv'), '--issued-codes', join(build, 'issued-codes.csv'), '--withdrawn-codes', join(dir, 'withdrawn.txt'), '--out', out]);
  assert.equal(r.code, 0, r.err);
  const t = readJson(join(out, 'summary.json')).exclusionTallies;
  assert.equal(t['E1-declined'], 1);
  assert.equal(t['E2-invalid-code'], 1);
  assert.equal(t['E3-unissued-code'], 2, 'bad-code and ZZZZ-ZZZZ are both unissued');
  assert.equal(t['E7-wrong-form'], 1);
  assert.equal(t['E4-duplicate-code'], 1, 'the first use of a code in a tab is kept');
  assert.equal(t['E5-withdrawn'], 1);
  assert.ok(t['E6-invalid-rating'] >= 1);
});

test('EXPORT: refuses altered plans, substituted keys, unmatched headers, and outputs inside a repository', () => {
  const plan = readJson(join(build, 'build-plan.json'));
  const dir = join(work, 'export-refuse'); mkdirSync(dir);
  writeFileSync(join(dir, 'a.csv'), responseCsv(plan, 'A', []));

  const header = readFileSync(join(dir, 'a.csv'), 'utf8').replace('[A-01] How ordered', '[A-01] How orderly');
  writeFileSync(join(dir, 'edited.csv'), header);
  let r = run('scripts/forms/export-analysis.mjs', ['--private-dir', corpus, '--build', build, '--responses', join(dir, 'edited.csv'), '--out', join(work, 'x1')]);
  assert.equal(r.code, 3);
  assert.match(r.err, /matches no form variant/);

  const corpusCopy = join(work, 'key-swap'); cpSync(corpus, corpusCopy, { recursive: true });
  const k = readJson(join(corpusCopy, 'stimulus-key.json')); k.items[0].v1.total += 1;
  writeFileSync(join(corpusCopy, 'stimulus-key.json'), JSON.stringify(k, null, 2));
  r = run('scripts/forms/export-analysis.mjs', ['--private-dir', corpusCopy, '--build', build, '--responses', join(dir, 'a.csv'), '--out', join(work, 'x2')]);
  assert.equal(r.code, 3);
  assert.match(r.err, /not the frozen key/);

  const buildCopy = join(work, 'plan-edit'); cpSync(build, buildCopy, { recursive: true });
  const p2 = readJson(join(buildCopy, 'build-plan.json')); p2.texts.agreeChoice = 'I agree!';
  writeFileSync(join(buildCopy, 'build-plan.json'), JSON.stringify(p2, null, 2));
  r = run('scripts/forms/export-analysis.mjs', ['--private-dir', corpus, '--build', buildCopy, '--responses', join(dir, 'a.csv'), '--out', join(work, 'x3')]);
  assert.equal(r.code, 3);
  assert.match(r.err, /altered/);

  r = run('scripts/forms/export-analysis.mjs', ['--private-dir', corpus, '--build', build, '--responses', join(dir, 'a.csv'), '--out', join(ROOT, 'results', 'should-not-exist')]);
  assert.equal(r.code, 2);
  assert.match(r.err, /inside the git work tree/);
  assert.ok(!existsSync(join(ROOT, 'results', 'should-not-exist')));
});
