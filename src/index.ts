export type {
  AssistFailure,
  AssistIntent,
  AssistRequest,
  AssistResult,
  AssistSuccess,
  AssistTurn,
  CompleteFn,
  FieldOption,
  FieldSpec,
  FieldType,
} from './types.js';

export { defineFields, assistableFields, redactExcluded, emptyValues } from './fields.js';
export type { FieldNames } from './fields.js';

export { sanitizeValues } from './sanitize.js';
export { mergeValues, valuesEqual } from './merge.js';
export {
  buildSystemPrompt,
  buildUserPrompt,
  describeFields,
  parseAssistResponse,
} from './prompt.js';
export type { ParsedAssistResponse } from './prompt.js';

export { runFormAssist, MIN_INSTRUCTION_LENGTH } from './assist.js';
export type { FormTarget } from './assist.js';
