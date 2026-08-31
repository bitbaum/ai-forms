import { assistableFields, redactExcluded } from './fields.js';
import { mergeValues } from './merge.js';
import { buildSystemPrompt, buildUserPrompt, parseAssistResponse } from './prompt.js';
import { sanitizeValues } from './sanitize.js';
import type { AssistIntent, AssistRequest, AssistResult, CompleteFn, FieldSpec } from './types.js';

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
}

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
}): Promise<AssistResult> {
  const { target, request, complete } = input;
  const intent: AssistIntent = request.intent === 'refine' ? 'refine' : 'fill';
  const instruction = (request.instruction ?? '').trim();

  const minLength = MIN_INSTRUCTION_LENGTH[intent];
  if (instruction.length < minLength) {
    return {
      ok: false,
      error:
        intent === 'refine'
          ? `Describe the change you want (at least ${minLength} characters).`
          : `Describe what you want in a bit more detail (at least ${minLength} characters).`,
    };
  }

  const fields = assistableFields(target.fields);
  if (fields.length === 0) {
    return { ok: false, error: 'This form has no fields the assistant may edit.' };
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
      error: error instanceof Error ? error.message : 'The assistant is unavailable right now.',
    };
  }

  const parsed = parseAssistResponse(content);
  if (!parsed) {
    return { ok: false, error: "Could not read the assistant's reply. Try rephrasing." };
  }

  const aiValues = sanitizeValues(parsed.values, target.fields);
  const { values: merged, changed } = mergeValues(aiValues, values, intent, target.fields);

  if (changed.length === 0) {
    return {
      ok: false,
      error:
        intent === 'refine'
          ? 'Nothing changed — try naming the field you want changed.'
          : 'Nothing could be filled in from that. Try describing it differently.',
    };
  }

  return {
    ok: true,
    values: merged,
    changed,
    message: parsed.message.trim() || describeChange(changed, target.fields),
  };
}

/** Honest fallback when the model returns values but no sentence. */
function describeChange(changed: readonly string[], fields: readonly FieldSpec[]): string {
  const labels = changed.map((name) => fields.find((f) => f.name === name)?.label ?? name);
  if (labels.length === 1) {
    return `Updated ${labels[0]}.`;
  }
  const last = labels[labels.length - 1];
  return `Updated ${labels.slice(0, -1).join(', ')} and ${last}.`;
}
