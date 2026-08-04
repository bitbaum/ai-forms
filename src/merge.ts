import type { AssistIntent, FieldSpec } from './types.js';

/**
 * Decide the final form values and report which fields actually changed.
 *
 * This is the SSOT for who wins on conflict, and it is the single most common
 * place a form assistant silently does nothing: if existing values always beat
 * the model's output, then asking it to rewrite a field that is already filled
 * can never take effect — which reads to the user as "the AI ignored me".
 *
 * - `fill`   — the user's own input is protected; the model only lands in gaps,
 *              plus any field marked `overridable` (template defaults, not intent).
 * - `refine` — the model wins for the fields it returns, because changing them
 *              is the entire request. Fields it omits keep their current values.
 */
export function mergeValues(
  aiValues: Record<string, unknown>,
  existingValues: Record<string, unknown> | undefined,
  intent: AssistIntent,
  fields: readonly FieldSpec[]
): { values: Record<string, unknown>; changed: string[] } {
  const existing = existingValues ?? {};

  if (intent === 'refine') {
    const changed = Object.keys(aiValues).filter(key => !valuesEqual(aiValues[key], existing[key]));
    return { values: { ...existing, ...aiValues }, changed };
  }

  const overridable = new Set(fields.filter(f => f.overridable).map(f => f.name));
  const values: Record<string, unknown> = { ...aiValues };

  for (const [key, value] of Object.entries(existing)) {
    if (isProvided(value) && !overridable.has(key)) {
      values[key] = value;
    }
  }

  const changed = Object.keys(aiValues).filter(key => !valuesEqual(values[key], existing[key]));
  return { values, changed };
}

/** Whether the user has actually put something in this field. */
function isProvided(value: unknown): boolean {
  if (value === '' || value === null || value === undefined) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return true;
}

/** Structural equality good enough for form values (scalars, arrays, plain objects). */
export function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}
