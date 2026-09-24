import { assistableFields, redactExcluded } from './fields.js';
import { mergeValues } from './merge.js';
import {
  buildSuggestSystemPrompt,
  buildSystemPrompt,
  buildUserPrompt,
  describeFields,
  parseAssistResponse,
  parseSuggestResponse,
} from './prompt.js';
import { sanitizeValues } from './sanitize.js';
import type {
  AssistIntent,
  AssistMessages,
  AssistRequest,
  AssistResult,
  CompleteFn,
  FieldSpec,
  SuggestResult,
} from './types.js';

/** A form the assistant is allowed to operate on. Registered server-side. */
export interface FormTarget {
  /** Stable key sent on the wire, e.g. "goal". */
  key: string;
  /** Human name used in prompts, e.g. "Goal". */
  name: string;
  fields: readonly FieldSpec[];
  /** Form-specific rules the model should follow (units, tone, house style). */
  instructions?: readonly string[];
  maxTokens?: number;
  temperature?: number;
  /** Per-form copy overrides; wins over the handler's `messages`. */
  messages?: Partial<AssistMessages>;
}

export const DEFAULT_MESSAGES: AssistMessages = {
  tooShort: (intent, minLength) =>
    intent === 'refine'
      ? `Describe the change you want (at least ${minLength} characters).`
      : `Describe what you want in a bit more detail (at least ${minLength} characters).`,
  noFields: 'This form has no fields the assistant may edit.',
  unavailable: 'The assistant is unavailable right now.',
  unreadable: "Could not read the assistant's reply. Try rephrasing.",
  nothingChanged: (intent) =>
    intent === 'refine'
      ? 'Nothing changed — try naming the field you want changed.'
      : 'Nothing could be filled in from that. Try describing it differently.',
  updated: (labels) =>
    labels.length === 1
      ? `Updated ${labels[0]}.`
      : `Updated ${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}.`,
  badBody: 'Expected a JSON body.',
  unknownForm: (key) => `Unknown form "${key}".`,
  nothingToReview: 'Fill something in first — there is nothing to review yet.',
  noSuggestions: 'Nothing to suggest — the form looks good.',
};

/**
 * Shortest instruction worth sending, per intent. A refine instruction is
 * legitimately tiny ("shorter", "less formal"); a fill description is not.
 * One floor for both used to reject the very refine instructions that matter.
 */
export const MIN_INSTRUCTION_LENGTH: Record<AssistIntent, number> = {
  fill: 10,
  refine: 3,
};

/** Keep the tail of the conversation; older turns stop being about this edit. */
const MAX_HISTORY_TURNS = 8;
/** Page text is context, not the payload — cap it so it cannot crowd out the form. */
const MAX_PAGE_CONTEXT_CHARS = 1800;

export async function runFormAssist(input: {
  target: FormTarget;
  request: Omit<AssistRequest, 'target'>;
  complete: CompleteFn;
  /** App-wide copy; `target.messages` overrides it per form. */
  messages?: Partial<AssistMessages>;
}): Promise<AssistResult> {
  const { target, request, complete } = input;
  const t: AssistMessages = { ...DEFAULT_MESSAGES, ...input.messages, ...target.messages };
  const intent: AssistIntent = request.intent === 'refine' ? 'refine' : 'fill';
  const instruction = (request.instruction ?? '').trim();

  const minLength = MIN_INSTRUCTION_LENGTH[intent];
  if (instruction.length < minLength) {
    return { ok: false, error: t.tooShort(intent, minLength) };
  }

  const fields = assistableFields(target.fields);
  if (fields.length === 0) {
    return { ok: false, error: t.noFields };
  }

  const values = request.values ?? {};
  const prompt = buildUserPrompt({
    target: target.name,
    intent,
    instruction,
    fields,
    values: redactExcluded(values, target.fields),
    history: (request.history ?? []).slice(-MAX_HISTORY_TURNS),
    pageContext: request.pageContext?.slice(0, MAX_PAGE_CONTEXT_CHARS),
    extraInstructions: target.instructions,
  });

  let content: string;
  try {
    content = await complete({
      system: buildSystemPrompt(target.name, intent),
      prompt,
      maxTokens: target.maxTokens ?? 2000,
      temperature: target.temperature ?? 0.3,
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : t.unavailable,
    };
  }

  const parsed = parseAssistResponse(content);
  if (!parsed) {
    return { ok: false, error: t.unreadable };
  }

  const aiValues = sanitizeValues(parsed.values, target.fields);
  const { values: merged, changed } = mergeValues(aiValues, values, intent, target.fields);

  if (changed.length === 0) {
    return { ok: false, error: t.nothingChanged(intent) };
  }

  return {
    ok: true,
    values: merged,
    changed,
    message:
      parsed.message.trim() ||
      t.updated(changed.map((name) => target.fields.find((f) => f.name === name)?.label ?? name)),
  };
}

/**
 * Propose improvements to a form that already has content. Changes nothing:
 * the user picks a suggestion, and its `instruction` goes through `refine`
 * like anything they typed, with the same undo.
 */
export async function runFormSuggest(input: {
  target: FormTarget;
  values: Record<string, unknown>;
  complete: CompleteFn;
  messages?: Partial<AssistMessages>;
}): Promise<SuggestResult> {
  const { target, complete } = input;
  const t: AssistMessages = { ...DEFAULT_MESSAGES, ...input.messages, ...target.messages };

  const fields = assistableFields(target.fields);
  if (fields.length === 0) {
    return { ok: false, error: t.noFields };
  }
  const values = redactExcluded(input.values, target.fields);
  if (!Object.values(values).some(isFilled)) {
    return { ok: false, error: t.nothingToReview };
  }

  const parts = [`Form: ${target.name}`, '', 'Fields:', describeFields(fields)];
  if (target.instructions && target.instructions.length > 0) {
    parts.push('', 'Rules for this form:', target.instructions.map((l) => `- ${l}`).join('\n'));
  }
  parts.push('', 'Current values:', JSON.stringify(values, null, 2));

  let content: string;
  try {
    content = await complete({
      system: buildSuggestSystemPrompt(target.name),
      prompt: parts.join('\n'),
      maxTokens: 800,
      temperature: 0.3,
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : t.unavailable };
  }

  const suggestions = parseSuggestResponse(content);
  if (!suggestions) {
    return { ok: false, error: t.unreadable };
  }
  return { ok: true, suggestions };
}

function isFilled(value: unknown): boolean {
  if (value === '' || value === null || value === undefined) return false;
  return Array.isArray(value) ? value.length > 0 : true;
}
