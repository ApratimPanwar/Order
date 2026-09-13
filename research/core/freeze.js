/**
 * Deep freeze.
 *
 * `Object.freeze` is shallow, so freezing a layout or an event record left its
 * nested objects and arrays writable. Anything this module hands out across a
 * boundary — a committed layout, a preview, an event record — must be
 * unmutatable by the receiver, otherwise a caller can silently rewrite recorded
 * history.
 */

export function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.getOwnPropertyNames(value)) {
    const v = value[key];
    if (v !== null && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v);
  }
  return value;
}

/** True only if `value` and everything reachable from it is frozen. */
export function isDeepFrozen(value, seen = new Set()) {
  if (value === null || typeof value !== 'object') return true;
  if (seen.has(value)) return true;
  seen.add(value);
  if (!Object.isFrozen(value)) return false;
  for (const key of Object.getOwnPropertyNames(value)) {
    if (!isDeepFrozen(value[key], seen)) return false;
  }
  return true;
}
