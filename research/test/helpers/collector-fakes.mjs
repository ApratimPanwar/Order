/**
 * In-memory fakes for the Apps Script services the collector uses, and a loader
 * that runs the collector's .gs files in a Node vm context. Shared by the test
 * suite and scripts/collector-local-harness.mjs.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

export const COLLECTOR_DIR = join(import.meta.dirname, '..', '..', '..', 'collector');
export const COLLECTOR_SOURCE = readdirSync(COLLECTOR_DIR).filter((f) => f.endsWith('.gs')).sort()
  .map((f) => readFileSync(join(COLLECTOR_DIR, f), 'utf8')).join('\n;\n');

/* ---------------------------------------------------------------------------
 * fakes
 * ------------------------------------------------------------------------ */

export function fakeProps(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getProperty: (k) => (m.has(k) ? m.get(k) : null),
    setProperty: (k, v) => { m.set(k, String(v)); },
    getProperties: () => Object.fromEntries(m),
  };
}

export function fakeSheets() {
  const tabs = new Map();
  const faults = { appendFailAfter: null, updateFailOnce: null, corruptAppend: null };
  const tab = (name) => { if (!tabs.has(name)) throw new Error(`no tab ${name}`); return tabs.get(name); };
  const api = {
    tabs, faults,
    ensureTab(name, header) {
      if (!tabs.has(name)) tabs.set(name, [header.slice()]);
      else assert.deepEqual(tabs.get(name)[0], header);
    },
    readColumn(name, idx) { return tab(name).slice(1).map((r) => (r[idx] === undefined ? '' : r[idx])); },
    readRow(name, rowNumber, width) {
      const r = (tab(name)[rowNumber - 1] || []).slice(0, width);
      while (r.length < width) r.push('');
      return r;
    },
    append(name, rows) {
      const t = tab(name);
      rows.forEach((row, i) => {
        if (faults.appendFailAfter !== null && i === faults.appendFailAfter) {
          faults.appendFailAfter = null;
          throw new Error('injected: append interrupted');
        }
        const stored = row.slice();
        if (faults.corruptAppend && name === faults.corruptAppend.tab) {
          stored[faults.corruptAppend.col] = '#CORRUPTED';
        }
        t.push(stored);
      });
    },
    updateRow(name, rowNumber, row) {
      if (faults.updateFailOnce && faults.updateFailOnce(name, row)) {
        faults.updateFailOnce = null;
        throw new Error('injected: update failed');
      }
      tab(name)[rowNumber - 1] = row.slice();
    },
    deleteRow(name, rowNumber) { tab(name).splice(rowNumber - 1, 1); },
    flush() {},
    rows(name) { return tabs.has(name) ? tabs.get(name).slice(1) : []; },
  };
  return api;
}

export function fakeDrive() {
  const files = new Map();   // id -> {area, name, text, trashed}
  const faults = { createFailOnce: false };
  let next = 1;
  return {
    files, faults,
    findByName(area, name) {
      const hits = [...files.entries()].filter(([, f]) => f.area === area && f.name === name && !f.trashed);
      if (hits.length > 1) throw new Error('duplicate stored file');
      return hits.length ? { id: hits[0][0] } : null;
    },
    create(area, name, text) {
      if (faults.createFailOnce) { faults.createFailOnce = false; throw new Error('injected: drive create failed'); }
      const id = `file-${next++}`;
      files.set(id, { area, name, text, trashed: false });
      return id;
    },
    readText(id) { return files.get(id).text; },
    trash(id) { files.get(id).trashed = true; },
    live(area) { return [...files.values()].filter((f) => f.area === area && !f.trashed); },
  };
}

export function fakeLock() {
  return {
    held: false, waits: 0, releases: 0,
    waitLock() { this.waits++; if (this.held) throw new Error('Lock timeout'); },
    releaseLock() { this.releases++; },
  };
}

export function loadCollector(extraGlobals = {}) {
  const context = vm.createContext({ console, JSON, Math, Date, Object, Array, String, Number, Error, ...extraGlobals });
  vm.runInContext(COLLECTOR_SOURCE, context, { filename: 'collector.gs' });
  return context;
}

