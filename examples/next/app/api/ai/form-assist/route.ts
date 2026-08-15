import { createFormAssistHandler } from 'ai-forms/server';
import { JOB_TARGET } from '@/lib/form';
import { resolveComplete } from '@/lib/complete';

const { complete } = resolveComplete();

/**
 * One route serves every form in the app. Adding a form means adding it to
 * `targets`, not adding an endpoint.
 */
export const POST = createFormAssistHandler({
  targets: [JOB_TARGET],
  complete,
  // A real app authenticates and rate-limits here, before any model call.
  authorize: () => ({ ok: true }),
});
