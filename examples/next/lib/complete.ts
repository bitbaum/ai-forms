import type { CompleteFn } from 'ai-forms';

/**
 * The example never bundles a key. Set one and you get a real model; set none
 * and you get the offline matcher below, which is honest about what it is.
 *
 * ── This file is REFERENCE CODE, so it has to get the boring parts right ─────
 * `CompleteFn` is deliberately bring-your-own-provider: the package does not
 * choose a vendor for you. That makes this file the thing people copy, and a
 * copied mistake is the most expensive kind. Three of them were here:
 *
 *   A PINNED MODEL ID ROTS. The default was `llama-3.3-70b-versatile`, which
 *   Groq retired along with the rest of the llama-3 family — verified live on
 *   2026-09-07, it answers 404 `model_not_found`. Anyone who followed the
 *   README with a Groq key got a broken example and no idea why. A LIST, tried
 *   in order, is the only shape that survives a vendor's release notes.
 *
 *   AN EMPTY HTTP 200 IS NOT AN ANSWER. `content ?? ''` returned the empty
 *   string as though the model had spoken. Some models return exactly that
 *   after spending their whole token budget on hidden reasoning, and an empty
 *   completion here becomes "the assistant filled in nothing" with no error to
 *   explain it.
 *
 *   A REQUEST WITH NO DEADLINE never falls back. A provider that accepts the
 *   connection and then goes quiet holds the form open forever, and the next
 *   model in the list is never reached.
 *
 * If you would rather not hand-roll any of this: `@bitbaum/ai-kit` ships a
 * `complete()` that owns the walk, the deadline, the empty-200 rule and the
 * three different meanings of HTTP 429. This example stays dependency-free on
 * purpose — it exists to show what `CompleteFn` is — but "dependency-free" is
 * not a licence to demonstrate the wrong thing.
 */
export function resolveComplete(): {
  complete: CompleteFn;
  mode: 'live' | 'offline';
  model: string;
} {
  const groq = process.env.GROQ_API_KEY;
  const openai = process.env.OPENAI_API_KEY;

  // A list, not a name. `AI_FORMS_MODEL` still wins when set, and may itself be
  // a comma-separated list.
  const configured = (process.env.AI_FORMS_MODEL ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);

  if (groq) {
    const models = configured.length ? configured : ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'];
    return {
      mode: 'live',
      model: models.join(' → '),
      complete: openAiCompatible('https://api.groq.com/openai/v1/chat/completions', groq, models),
    };
  }
  if (openai) {
    const models = configured.length ? configured : ['gpt-4o-mini'];
    return {
      mode: 'live',
      model: models.join(' → '),
      complete: openAiCompatible('https://api.openai.com/v1/chat/completions', openai, models),
    };
  }
  return { mode: 'offline', model: 'offline pattern matcher', complete: offlineComplete };
}

/** How long ONE model may take before the next one is tried. */
const TIMEOUT_MS = 30_000;

/**
 * Any OpenAI-shaped chat endpoint. Kept in the app, never in the package.
 *
 * Walks `models` in order and returns the first REAL answer — where "real"
 * excludes a 200 carrying nothing. Each attempt gets its own deadline, because
 * a shared one would be spent by the first model and leave the rest with an
 * already-expired signal, which is worse than no deadline at all.
 */
function openAiCompatible(url: string, key: string, models: string[]): CompleteFn {
  return async ({ system, prompt, maxTokens, temperature }) => {
    const failures: string[] = [];

    for (const model of models) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            temperature,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: prompt },
            ],
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        if (!res.ok) {
          // The BODY, not just the status. "429" alone cannot tell a momentary
          // burst from a spent daily quota, and those want opposite reactions.
          failures.push(`${model}: ${res.status} ${(await res.text()).slice(0, 200)}`);
          continue;
        }

        const json = await res.json();
        const content = json.choices?.[0]?.message?.content ?? '';
        if (content.trim() === '') {
          failures.push(`${model}: 200 with empty content — the model produced no output`);
          continue;
        }
        return content;
      } catch (error) {
        failures.push(`${model}: ${(error as Error).message}`);
      }
    }

    // Name every attempt. A message about only the last one makes "the key is
    // dead" and "one model id rotted" read identically.
    throw new Error(`No model answered. Tried ${models.length}: ${failures.join(' | ')}`);
  };
}

/**
 * NOT a language model. A deterministic pattern matcher so the example runs with
 * zero setup, and so the library's own contribution — merge intent, sanitizing,
 * field discipline — is visible without a provider in the way. Labelled as such
 * in the UI; anything it cannot parse it declines instead of inventing.
 */
export const offlineComplete: CompleteFn = async ({ prompt }) => {
  const refine = prompt.includes('The user asks you to change the form:');
  const said = prompt.match(/(?:change the form|from this description): "([\s\S]*)"\s*$/);
  const text = (said?.[1] ?? '').toLowerCase();
  const values: Record<string, unknown> = {};

  const seniority = ['principal', 'staff', 'senior', 'junior', 'intern', 'mid'].find((level) =>
    text.includes(level),
  );
  if (seniority) values['seniority'] = seniority;

  if (/\bremote\b/.test(text))
    values['remote'] = !/\b(no|not|non|onsite|on-site)[- ]?remote\b/.test(text);
  if (/\b(onsite|on-site|in office|in-office)\b/.test(text)) values['remote'] = false;

  // "120k-150k", "120000 to 150000", "up to 150k". Dates are stripped first so a
  // year like 2026-10-01 cannot be read as a salary, and a bare number has to
  // clear an annual-salary floor to count.
  const moneyText = text.replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ');
  const money = [...moneyText.matchAll(/(\d[\d'.,]*)\s*(k\b)?/g)]
    .map((m) => Math.round(parseFloat(m[1].replace(/['.,]/g, '')) * (m[2] ? 1000 : 1)))
    .filter((n) => n >= 10_000 && n <= 10_000_000);
  if (money.length >= 2) {
    values['salaryMin'] = Math.min(...money);
    values['salaryMax'] = Math.max(...money);
  } else if (money.length === 1)
    values[/\bup to|max|below\b/.test(text) ? 'salaryMax' : 'salaryMin'] = money[0];

  for (const [code, re] of [
    ['EUR', /\beur|euro|€/],
    ['USD', /\busd|dollar|\$/],
    ['CHF', /\bchf|franc/],
  ] as const) {
    if (re.test(text)) {
      values['currency'] = code;
      break;
    }
  }

  const KNOWN = [
    'typescript',
    'javascript',
    'react',
    'next.js',
    'nextjs',
    'node',
    'python',
    'go',
    'rust',
    'postgres',
    'postgresql',
    'kubernetes',
    'docker',
    'aws',
    'graphql',
    'tailwind',
    'prisma',
    'sql',
  ];
  const skills = KNOWN.filter((s) => text.includes(s));
  if (skills.length) values['skills'] = skills;

  const iso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) values['startDate'] = iso[1];

  const email = text.match(/\b([\w.+-]+@[\w-]+\.[\w.]+)\b/);
  if (email) values['contact'] = email[1];

  // On a fill pass the form is empty, so give it a title and summary to show.
  if (!refine) {
    const title = said?.[1]?.split(/[.,;]/)[0]?.trim();
    if (title) values['title'] = title.slice(0, 80);
    if (said?.[1]) values['summary'] = said[1].trim().slice(0, 600);
  } else if (/\btitle\b/.test(text)) {
    values['title'] = (said?.[1] ?? '').replace(/.*title (?:to|=)?\s*/i, '').slice(0, 80);
  }

  if (Object.keys(values).length === 0) {
    return JSON.stringify({
      values: {},
      message:
        'The offline matcher did not recognise that. Add GROQ_API_KEY or OPENAI_API_KEY for a real model.',
    });
  }

  return JSON.stringify({
    values,
    message: `Offline matcher set ${Object.keys(values).join(', ')}.`,
  });
};
