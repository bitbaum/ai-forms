export type {
  AssistFailure,
  AssistIntent,
  AssistMessages,
  AssistRequest,
  AssistResult,
  AssistSuccess,
  AssistTurn,
  CompleteFn,
  FieldOption,
  FieldSpec,
  FieldType,
  FormSuggestion,
  SuggestResult,
} from './types.js';

export { defineFields, assistableFields, redactExcluded, emptyValues } from './fields.js';
export type { FieldNames } from './fields.js';

export { sanitizeValues } from './sanitize.js';
export { mergeValues, valuesEqual } from './merge.js';
export {
  buildSystemPrompt,
  buildUserPrompt,
  buildSuggestSystemPrompt,
  describeFields,
  parseAssistResponse,
  parseSuggestResponse,
  MAX_SUGGESTIONS,
} from './prompt.js';
export type { ParsedAssistResponse } from './prompt.js';

export {
  runFormAssist,
  runFormSuggest,
  MIN_INSTRUCTION_LENGTH,
  DEFAULT_MESSAGES,
} from './assist.js';
export type { FormTarget } from './assist.js';
