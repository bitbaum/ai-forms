import { runFormAssist, type FormTarget } from './assist.js';
import type { AssistResult, CompleteFn } from './types.js';

export type AuthorizeResult = { ok: true } | { ok: false; status: number; error: string };

export interface FormAssistHandlerConfig {
  /** Every form the assistant may touch. The client can only name these keys. */
  targets: readonly FormTarget[];
  /** The app's own LLM caller — this package never owns keys or model policy. */
  complete: CompleteFn;
  /** Auth, rate limiting, feature flags. Runs before any model call. */
  authorize?: (request: Request) => Promise<AuthorizeResult> | AuthorizeResult;
  /** Override to match a house response envelope. */
  respond?: (result: AssistResult) => Response;
}

/**
 * Build a Web-standard `Request -> Response` handler. Works as-is for a Next.js
 * App Router route (`export const POST = createFormAssistHandler({...})`).
 */
export function createFormAssistHandler(
  config: FormAssistHandlerConfig
): (request: Request) => Promise<Response> {
  const registry = new Map(config.targets.map(target => [target.key, target]));
  const respond = config.respond ?? defaultRespond;

  return async function handle(request: Request): Promise<Response> {
    if (config.authorize) {
      const auth = await config.authorize(request);
      if (!auth.ok) {
        return json({ ok: false, error: auth.error }, auth.status);
      }
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return respond({ ok: false, error: 'Expected a JSON body.' });
    }

    if (body === null || typeof body !== 'object') {
      return respond({ ok: false, error: 'Expected a JSON body.' });
    }
    const payload = body as Record<string, unknown>;

    const targetKey = typeof payload['target'] === 'string' ? payload['target'] : '';
    const target: FormTarget | undefined = registry.get(targetKey);
    if (!target) {
      return respond({ ok: false, error: `Unknown form "${targetKey}".` });
    }

    const result = await runFormAssist({
      target,
      request: {
        intent: payload['intent'] === 'refine' ? 'refine' : 'fill',
        instruction: typeof payload['instruction'] === 'string' ? payload['instruction'] : '',
        values: isRecord(payload['values']) ? payload['values'] : {},
        history: parseHistory(payload['history']),
        pageContext:
          typeof payload['pageContext'] === 'string' ? payload['pageContext'] : undefined,
      },
      complete: config.complete,
    });

    return respond(result);
  };
}

function parseHistory(raw: unknown): { role: 'user' | 'assistant'; text: string }[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const turns: { role: 'user' | 'assistant'; text: string }[] = [];
  for (const item of raw) {
    if (!isRecord(item)) {
      continue;
    }
    const text = item['text'];
    if (typeof text !== 'string' || text.trim() === '') {
      continue;
    }
    turns.push({ role: item['role'] === 'assistant' ? 'assistant' : 'user', text });
  }
  return turns;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function defaultRespond(result: AssistResult): Response {
  return json(result, result.ok ? 200 : 400);
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
