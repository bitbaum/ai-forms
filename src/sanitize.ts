import type { FieldSpec } from './types.js';

/**
 * Coerce a model's JSON into the types the form actually declares, and drop
 * anything it invented.
 *
 * The prompt asks for option values, numbers, and ISO dates; this is what
 * guarantees them. Without it a single hallucinated key or a number returned as
 * `"about 5"` lands straight in form state and surfaces as a validation error
 * the user cannot explain.
 */
export function sanitizeValues(
  raw: unknown,
  fields: readonly FieldSpec[]
): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }

  const source = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const field of fields) {
    if (field.aiExcluded) {
      continue;
    }
    if (!(field.name in source)) {
      continue;
    }
    const coerced = coerce(source[field.name], field);
    if (coerced !== undefined) {
      out[field.name] = coerced;
    }
  }

  return out;
}

function coerce(value: unknown, field: FieldSpec): unknown {
  if (value === null || value === undefined) {
    return undefined;
  }

  switch (field.type) {
    case 'number':
      return coerceNumber(value, field);
    case 'boolean':
      return coerceBoolean(value);
    case 'select':
      return coerceOption(value, field);
    case 'multiselect':
      return coerceStringArray(value).filter(v => optionValues(field).includes(v));
    case 'tags':
      return coerceStringArray(value);
    case 'date':
      return coerceDate(value);
    default:
      return coerceText(value, field);
  }
}

function optionValues(field: FieldSpec): string[] {
  return (field.options ?? []).map(o => o.value);
}

/** A number, possibly wrapped in prose or formatting ("about 5", "CHF 1,200"). */
const NUMERIC = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function coerceNumber(value: unknown, field: FieldSpec): number | undefined {
  let num: number;
  if (typeof value === 'number') {
    num = value;
  } else if (typeof value === 'string') {
    const stripped = value.replace(/[^0-9.eE+-]/g, '');
    // Without this test, "lots" strips to "" and Number("") is 0 — which then
    // clamps up to the field minimum, turning nonsense into a plausible value.
    if (!NUMERIC.test(stripped)) {
      return undefined;
    }
    num = Number(stripped);
  } else {
    return undefined;
  }
  if (!Number.isFinite(num)) {
    return undefined;
  }
  let clamped = num;
  if (field.min !== undefined) {
    clamped = Math.max(field.min, clamped);
  }
  if (field.max !== undefined) {
    clamped = Math.min(field.max, clamped);
  }
  return clamped;
}

function coerceBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', 'yes', 'y', '1'].includes(normalized)) {
      return true;
    }
    if (['false', 'no', 'n', '0'].includes(normalized)) {
      return false;
    }
  }
  return undefined;
}

function coerceOption(value: unknown, field: FieldSpec): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const allowed = optionValues(field);
  if (allowed.includes(value)) {
    return value;
  }
  // Models routinely return the label, or the value in a different case.
  const normalized = value.trim().toLowerCase();
  const byLabel = (field.options ?? []).find(
    o => o.value.toLowerCase() === normalized || (o.label ?? '').toLowerCase() === normalized
  );
  return byLabel?.value;
}

function coerceStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string').map(v => v.trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(',').map(v => v.trim()).filter(Boolean);
  }
  return [];
}

function coerceDate(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  // Read back the local calendar date, not the UTC one: `new Date("March 3")`
  // is local midnight, and toISOString() would report March 2 anywhere east of
  // Greenwich. A date field the user sees is a calendar date, not an instant.
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function coerceText(value: unknown, field: FieldSpec): string | undefined {
  const text =
    typeof value === 'string' ? value
    : typeof value === 'number' || typeof value === 'boolean' ? String(value)
    : undefined;
  if (text === undefined) {
    return undefined;
  }
  const trimmed = text.trim();
  return field.maxLength !== undefined ? trimmed.slice(0, field.maxLength) : trimmed;
}
