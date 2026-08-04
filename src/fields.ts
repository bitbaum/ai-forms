import type { FieldSpec } from './types.js';

/**
 * Identity helper that pins the literal field names into the type, so
 * `values`/`onChange` on the consuming form are checked against the spec
 * instead of being a bag of strings.
 */
export function defineFields<const T extends readonly FieldSpec[]>(fields: T): T {
  return fields;
}

export type FieldNames<T extends readonly FieldSpec[]> = T[number]['name'];

/** Fields the model is allowed to read and write. */
export function assistableFields(fields: readonly FieldSpec[]): FieldSpec[] {
  return fields.filter(f => !f.aiExcluded);
}

/** Strip excluded fields out of a value bag before it reaches a prompt. */
export function redactExcluded(
  values: Record<string, unknown>,
  fields: readonly FieldSpec[]
): Record<string, unknown> {
  const excluded = new Set(fields.filter(f => f.aiExcluded).map(f => f.name));
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (!excluded.has(key)) {
      out[key] = value;
    }
  }
  return out;
}

/** Blank values for every declared field — the initial state of an empty form. */
export function emptyValues(fields: readonly FieldSpec[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    out[field.name] =
      field.type === 'boolean' ? false
      : field.type === 'tags' || field.type === 'multiselect' ? []
      : '';
  }
  return out;
}
