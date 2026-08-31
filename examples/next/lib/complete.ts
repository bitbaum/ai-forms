import type { CompleteFn } from 'ai-forms';

/**
 * The example never bundles a key. Set one and you get a real model; set none
 * and you get the offline matcher below, which is honest about what it is.
 */
export function resolveComplete(): {
  complete: CompleteFn;
  mode: 'live' | 'offline';
  model: string;
} {
  const groq = process.env.GROQ_API_KEY;
  const openai = process.env.OPENAI_API_KEY;

  if (groq) {
    return {
      mode: 'live',
      model: process.env.AI_FORMS_MODEL ?? 'llama-3.3-70b-versatile',
      complete: openAiCompatible(
        'https://api.groq.com/openai/v1/chat/completions',
        groq,
        process.env.AI_FORMS_MODEL ?? 'llama-3.3-70b-versatile',
      ),
    };
  }
  if (openai) {
    return {
      mode: 'live',
      model: process.env.AI_FORMS_MODEL ?? 'gpt-4o-mini',
      complete: openAiCompatible(
        'https://api.openai.com/v1/chat/completions',
        openai,
        process.env.AI_FORMS_MODEL ?? 'gpt-4o-mini',
      ),
    };
  }
  return { mode: 'offline', model: 'offline pattern matcher', complete: offlineComplete };
}

/** Any OpenAI-shaped chat endpoint. Kept in the app, never in the package. */
function openAiCompatible(url: string, key: string, model: string): CompleteFn {
  return async ({ system, prompt, maxTokens, temperature }) => {
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
    });
    if (!res.ok) {
      throw new Error(`Provider returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const json = await res.json();
    return json.choices?.[0]?.message?.content ?? '';
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
