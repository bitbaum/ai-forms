/**
 * Wire and configuration types for AI form assistance.
 *
 * The field list is deliberately NOT part of the request wire format. The
 * server resolves it from its own registry by `target`, so a client can never
 * widen the set of fields the model is allowed to write, and the app keeps one
 * source of truth for what a form contains.
 */

export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'select'
  | 'multiselect'
  | 'boolean'
  | 'date'
  | 'url'
  | 'email'
  | 'tags';

export interface FieldOption {
  value: string;
  label?: string;
}

export interface FieldSpec {
  /** Key in the form's value object. */
  name: string;
  /** Human label — the model sees this, so make it read like the UI. */
  label: string;
  type: FieldType;
  required?: boolean;
  /** Extra guidance for the model and, usually, for the user too. */
  hint?: string;
  placeholder?: string;
  /** Required for `select` / `multiselect`; the model may only return these values. */
  options?: FieldOption[];
  min?: number;
  max?: number;
  maxLength?: number;
  /**
   * Never shown to the model and never written by it. Use for ids, tokens,
   * ownership columns — anything a user's prose has no business setting.
   */
  aiExcluded?: boolean;
  /**
   * The value carries a template default rather than user intent, so a `fill`
   * pass is allowed to replace it even when non-empty (e.g. a currency that
   * defaults to CHF). Ignored for `refine`, where the model always wins.
   */
  overridable?: boolean;
}

/**
 * `fill`   — turn prose into a whole form. The user's own input is protected.
 * `refine` — change what is already there. The model wins for fields it returns,
 *            because changing them is the entire request.
 */
export type AssistIntent = 'fill' | 'refine';

export interface AssistTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface AssistRequest {
  /** Which form — resolved against the server's field registry. */
  target: string;
  intent: AssistIntent;
  /** What the user typed: a description to fill from, or a change to apply. */
  instruction: string;
  /** Current form values, so the model can revise rather than reinvent. */
  values?: Record<string, unknown>;
  /** Prior turns for this form, so "now make it shorter" has something to shorten. */
  history?: AssistTurn[];
  /** What the user can see on the page, when the caller is a page-aware chat. */
  pageContext?: string;
}

export interface AssistSuccess {
  ok: true;
  /** The full value object to apply — already merged and type-coerced. */
  values: Record<string, unknown>;
  /** Only the fields this turn actually changed. Drives "AI touched this" affordances. */
  changed: string[];
  /** One short sentence describing what changed, for the conversation transcript. */
  message: string;
}

export interface AssistFailure {
  ok: false;
  error: string;
}

export type AssistResult = AssistSuccess | AssistFailure;

/**
 * The single seam between this package and any LLM provider. Apps pass their
 * own caller (Groq, OpenRouter, a BYOK chain) so the package never owns keys,
 * models, budgets, or fallback policy.
 */
export type CompleteFn = (input: {
  system: string;
  prompt: string;
  maxTokens: number;
  temperature: number;
}) => Promise<string>;
