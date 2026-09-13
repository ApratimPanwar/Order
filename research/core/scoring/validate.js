/**
 * Output validation — a SEPARATE layer from the scorer.
 *
 * This module reports whether a score is usable. It never repairs one. A v0
 * score that comes back NaN stays NaN in the record; this layer only attaches
 * a finding so analysis can exclude it explicitly rather than silently treating
 * it as zero or as a plausible value.
 *
 * Missing results must never be computed as zero. `null` means "not computed";
 * `NaN` means "the model produced an invalid number". They are different facts.
 */

export const DIMENSION_BOUNDS = Object.freeze({
  // Documented ATTAINABLE ranges for v0, which are not all [0,10].
  // structure's ceiling is ((1+1)*4 + 4 + 2)/1.5 = 9.333..., inside [0,10].
  hierarchy: [0, 10],
  grouping: [0, 10],
  structure: [0, 10],
  flow: [0, 10],
  spatial: [0, 10],
  harmony: [0, 10],
});

export const V0_ATTAINABLE_MAX = Object.freeze({
  hierarchy: 10,
  grouping: 10,
  structure: 14 / 1.5, // 9.3333...
  flow: 10,
  spatial: 10,
  harmony: 10,
});

/**
 * @returns {{valid:boolean, findings:Array<{code:string, field:string, value:*, detail:string}>}}
 */
export function validateScore(result) {
  const findings = [];

  const check = (field, value) => {
    if (value === null || value === undefined) {
      findings.push({ code: 'not-computed', field, value, detail: 'no value was produced' });
      return;
    }
    if (typeof value !== 'number') {
      findings.push({ code: 'non-numeric', field, value, detail: `type ${typeof value}` });
      return;
    }
    if (Number.isNaN(value)) {
      findings.push({ code: 'nan', field, value, detail: 'model produced NaN' });
      return;
    }
    if (!Number.isFinite(value)) {
      findings.push({ code: 'non-finite', field, value, detail: 'model produced +/-Infinity' });
      return;
    }
    const bounds = DIMENSION_BOUNDS[field];
    if (bounds && (value < bounds[0] || value > bounds[1])) {
      findings.push({
        code: 'out-of-bounds',
        field,
        value,
        detail: `outside documented [${bounds[0]}, ${bounds[1]}]`,
      });
    }
  };

  for (const [field, value] of Object.entries(result.dimensions ?? {})) check(field, value);

  const total = result.total;
  if (typeof total !== 'number' || Number.isNaN(total) || !Number.isFinite(total)) {
    findings.push({ code: 'nan', field: 'total', value: total, detail: 'invalid total' });
  } else if (total < 0 || total > 100) {
    findings.push({
      code: 'out-of-bounds',
      field: 'total',
      value: total,
      detail: 'outside documented [0, 100]',
    });
  }

  if (result.submetrics?.balanceDegenerate) {
    findings.push({
      code: 'balance-degenerate',
      field: 'spatial',
      value: result.dimensions?.spatial,
      detail:
        'every colour failed to parse, so the balance term fell back to the canvas centre and is a constant 10/10',
    });
  }

  return { valid: findings.length === 0, findings };
}

/**
 * Input gate. Rejects layouts the scorer is not defined for, BEFORE scoring,
 * so an unsupported input is distinguishable from a defective output.
 */
export function validateLayoutForScoring(layout) {
  const findings = [];
  if (!layout || !Array.isArray(layout.elements)) {
    findings.push({ code: 'malformed', field: 'elements', detail: 'not an array' });
    return { supported: false, findings };
  }
  for (const e of layout.elements) {
    if (!e.visible) continue;
    for (const k of ['x', 'y', 'size', 'rotation']) {
      if (typeof e[k] !== 'number' || !Number.isFinite(e[k])) {
        findings.push({ code: 'non-finite-property', field: `${e.id}.${k}`, value: e[k], detail: 'must be a finite number' });
      }
    }
    if (typeof e.color !== 'string') {
      findings.push({ code: 'non-string-color', field: `${e.id}.color`, value: e.color, detail: 'colour must be a string' });
    }
  }
  return { supported: findings.length === 0, findings };
}
