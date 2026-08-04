import type { AssistIntent, AssistTurn, FieldSpec } from './types.js';

/** Render one field the way the model needs to see it: name, type, rules, examples. */
function describeField(field: FieldSpec): string {
  const constraints: string[] = [];
  const examples: string[] = [];

  switch (field.type) {
    case 'textarea':
      constraints.push('longer text, multiple lines allowed');
      break;
    case 'number':
      constraints.push('number');
      if (field.min !== undefined) constraints.push(`minimum ${field.min}`);
      if (field.max !== undefined) constraints.push(`maximum ${field.max}`);
      break;
    case 'select':
      constraints.push(`exactly one of: ${(field.options ?? []).map(o => o.value).join(', ')}`);
      break;
    case 'multiselect':
      constraints.push(`array, values from: ${(field.options ?? []).map(o => o.value).join(', ')}`);
      break;
    case 'boolean':
      constraints.push('boolean (true or false)');
      break;
    case 'date':
      constraints.push('ISO date string, YYYY-MM-DD');
      examples.push('2026-12-25');
      break;
    case 'url':
      constraints.push('absolute URL');
      examples.push('https://example.com');
      break;
    case 'email':
      constraints.push('email address');
      examples.push('someone@example.com');
      break;
    case 'tags':
      constraints.push('array of short keyword strings');
      examples.push('["bitcoin", "handmade"]');
      break;
    default:
      constraints.push('string');
  }

  if (field.maxLength !== undefined) {
    constraints.push(`at most ${field.maxLength} characters`);
  }
  if (field.placeholder) {
    examples.push(field.placeholder);
  }

  let line = `- ${field.name} (${field.type}${field.required ? ', required' : ''}): ${field.label}`;
  if (field.hint) {
    line += ` — ${field.hint}`;
  }
  if (constraints.length > 0) {
    line += `\n    Rules: ${constraints.join('; ')}`;
  }
  if (examples.length > 0) {
    line += `\n    Examples: ${examples.join(', ')}`;
  }
  return line;
}

export function describeFields(fields: readonly FieldSpec[]): string {
  return fields.map(describeField).join('\n');
}

export function buildSystemPrompt(target: string, intent: AssistIntent): string {
  const shared = [
    `You fill in a "${target}" form on behalf of a user who does not want to type into form fields.`,
    '',
    'Reply with a single JSON object and nothing else:',
    '{ "values": { <field name>: <value>, ... }, "message": "<one short sentence>" }',
    '',
    'Rules:',
    '- Only use field names from the list you are given. Never invent fields.',
    '- Obey every stated type and constraint exactly.',
    '- Omit a field entirely rather than guessing a value you have no basis for.',
    '- Never put a placeholder, a TODO, or the word "unknown" in a value.',
    '- "message" describes what you did in plain language, addressed to the user.',
  ];

  if (intent === 'refine') {
    return [
      ...shared,
      '- The form already has values. Return ONLY the fields the user asked you to change.',
      '- Leave every other field out of "values" so it keeps its current value.',
      '- Apply the change literally. If asked to shorten, return a shorter version of the',
      '  existing text — do not write something new on the same topic.',
    ].join('\n');
  }

  return [
    ...shared,
    '- Fill in as many fields as the description genuinely supports.',
    '- Prefer the user\'s own words for titles and descriptions over marketing phrasing.',
  ].join('\n');
}

export function buildUserPrompt(input: {
  target: string;
  intent: AssistIntent;
  instruction: string;
  fields: readonly FieldSpec[];
  values?: Record<string, unknown>;
  history?: readonly AssistTurn[];
  pageContext?: string;
  extraInstructions?: readonly string[];
}): string {
  const parts: string[] = [];

  parts.push(`Form: ${input.target}`);
  parts.push('');
  parts.push('Fields you may set:');
  parts.push(describeFields(input.fields));

  if (input.extraInstructions && input.extraInstructions.length > 0) {
    parts.push('');
    parts.push('Additional rules for this form:');
    parts.push(input.extraInstructions.map(line => `- ${line}`).join('\n'));
  }

  const currentValues = input.values ?? {};
  if (Object.keys(currentValues).length > 0) {
    parts.push('');
    parts.push('Current values in the form right now:');
    parts.push(JSON.stringify(currentValues, null, 2));
  }

  if (input.history && input.history.length > 0) {
    parts.push('');
    parts.push('Earlier turns in this conversation about this form:');
    parts.push(
      input.history.map(turn => `${turn.role === 'user' ? 'User' : 'You'}: ${turn.text}`).join('\n')
    );
  }

  if (input.pageContext) {
    parts.push('');
    parts.push('Visible on the page right now (use it only if relevant):');
    parts.push(input.pageContext);
  }

  parts.push('');
  parts.push(
    input.intent === 'refine'
      ? `The user asks you to change the form: "${input.instruction}"`
      : `Fill the form from this description: "${input.instruction}"`
  );

  return parts.join('\n');
}

export interface ParsedAssistResponse {
  values: unknown;
  message: string;
}

/**
 * Pull the JSON object out of a completion. Models wrap it in prose or fences
 * often enough that a bare `JSON.parse` loses real responses.
 */
export function parseAssistResponse(content: string): ParsedAssistResponse | null {
  const candidates: string[] = [];
  const trimmed = content.trim();
  candidates.push(trimmed);

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) {
    candidates.push(fenced[1].trim());
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        continue;
      }
      const record = parsed as Record<string, unknown>;
      // Tolerate a bare value object from models that ignore the envelope.
      const values = 'values' in record ? record['values'] : record;
      const message = typeof record['message'] === 'string' ? record['message'] : '';
      return { values, message };
    } catch {
      continue;
    }
  }

  return null;
}
