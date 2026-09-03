# ai-forms

[![npm](https://img.shields.io/npm/v/ai-forms.svg)](https://www.npmjs.com/package/ai-forms)
[![CI](https://github.com/bitbaum/ai-forms/actions/workflows/ci.yml/badge.svg)](https://github.com/bitbaum/ai-forms/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Headless AI form filling and conversational refinement.

Forms are the worst part of most software. This package makes a form answer to plain language — fill it from a description, then keep talking to it ("shorter", "move the date to next Friday", "actually call it something else") until it is right.

```
npm install ai-forms
```

No provider SDK, no markup, no styles. You pass in a function that calls whatever model you already use; the package handles prompting, parsing, sanitising, and the merge rules that decide who wins when the model and the user disagree.

Works with any model (OpenAI, Anthropic, Groq, Gemini, local — anything you can wrap in `(prompt) => Promise<string>`), any framework on the server, and React on the client. The React hook is optional; the core is framework-free.

---

## Try it

```bash
git clone https://github.com/bitbaum/ai-forms
cd ai-forms/examples/next && pnpm install && pnpm run dev
```

No API key required — the example ships a deterministic offline matcher (clearly
labelled as such in the UI) so the behaviour is visible immediately. Set
`GROQ_API_KEY` or `OPENAI_API_KEY` for a real model.

Fill the form from one sentence, then send *"actually make it principal level"* and
watch only `seniority` change while salary, skills and contact survive. See
[`examples/next`](examples/next).

## What "done" looks like

Five properties, all of which this package holds:

1. **Every form can be filled from prose.** The user types what they want in one box; the form fills in.
2. **Every filled form can be changed by talking to it.** Follow-up instructions apply to what is already there. This is the part almost everyone gets wrong — see "Why refinement silently fails" below.
3. **The user's own typing is never overwritten by a fill.** Only gaps get filled, plus fields explicitly marked as carrying a default rather than intent.
4. **Every AI edit is reversible and visible.** `undo()` restores the previous values; `isAiTouched(name)` marks which fields the assistant wrote.
5. **The page-aware chat can drive the form.** The small assistant in the corner sees what is on screen and writes into the open form, rather than telling the user which buttons to press.

## Why refinement silently fails

The usual bug is one line of merge logic. An implementation protects user input by letting existing values win on conflict — correct for filling an empty form, fatal for changing a full one. Ask it to rewrite a description that already has text and the existing value overwrites the model's output, so nothing happens. The form appears to ignore the user.

The fix is intent:

| Intent | Who wins | Why |
| --- | --- | --- |
| `fill` | the user | The model is filling gaps. Typed input is intent and must survive. |
| `refine` | the model | Changing the field *is* the request. Omitted fields keep their values. |

`useAiForm` infers the intent from whether the form is empty, so the user never picks a mode.

The same mistake has a sibling: a single minimum input length. A fill description should be a sentence, but a refine instruction is legitimately two words ("shorter"). One floor for both rejects exactly the instructions that matter. See `MIN_INSTRUCTION_LENGTH`.

---

## Adopting it — three files

### 1. Declare the form's fields (SSOT)

```ts
// src/config/ai-forms.ts
import { defineFields, type FormTarget } from 'ai-forms';

export const GOAL_FORM: FormTarget = {
  key: 'goal',
  name: 'Goal',
  fields: defineFields([
    { name: 'title', label: 'Title', type: 'text', required: true, maxLength: 120 },
    { name: 'description', label: 'Description', type: 'textarea', maxLength: 500 },
    { name: 'targetDate', label: 'Target date', type: 'date' },
    { name: 'ownerId', label: 'Owner', type: 'text', aiExcluded: true },
  ]),
  instructions: ['Target dates are calendar dates, never relative phrases.'],
};

export const AI_FORMS = [GOAL_FORM /* , ... */];
```

`aiExcluded` fields are never shown to the model and never writable by it — ids, tokens, ownership columns.

### 2. Mount one route for the whole app

```ts
// src/app/api/ai/form-assist/route.ts
import { createFormAssistHandler } from 'ai-forms/server';
import { AI_FORMS } from '@/config/ai-forms';
import { getCurrentUserId } from '@/lib/session';

export const POST = createFormAssistHandler({
  targets: AI_FORMS,
  authorize: async () => (await getCurrentUserId())
    ? { ok: true }
    : { ok: false, status: 401, error: 'Sign in to use the assistant.' },

  // Any provider. `complete` just has to return the model's text.
  complete: async ({ system, prompt, maxTokens, temperature }) => {
    const res = await fetch(`${process.env.LLM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.LLM_MODEL,
        max_tokens: maxTokens,
        temperature,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
      }),
    });
    const json = await res.json();
    return json.choices[0].message.content;
  },
});
```

The package never owns API keys, model choice, budgets, or fallback policy — the app passes its own caller. That is deliberate: you already have retry, spend caps, and a fallback chain, and a form library has no business owning any of them.

Field specs live on the server, so a client can never widen the set of fields the model may write.

### 3. Use the hook in the form

```tsx
const form = useAiForm({ target: 'goal', fields: GOAL_FORM.fields });

<input value={form.text('title')} onChange={e => form.setValue('title', e.target.value)} />
<textarea value={form.text('description')} onChange={e => form.setValue('description', e.target.value)} />

<AiBar
  busy={form.busy}
  error={form.error}
  onAsk={form.ask}          // fills an empty form, refines a filled one
  onUndo={form.undo}
  canUndo={form.canUndo}
/>
```

**The hook owns form state.** That is the point: the user and the assistant write to the same store, which is what makes "now change the date" work at all. Forms adopting this usually get *shorter*, because a `useState` per field collapses into one.

Rendering is yours. The package ships no markup and no classes — each app has its own design token SSOT, and a package that shipped styled components would fight all of them.

---

## API

### `ai-forms`

| Export | Purpose |
| --- | --- |
| `defineFields(specs)` | Identity helper that pins field names into the type |
| `runFormAssist({ target, request, complete })` | The whole pipeline: prompt → model → parse → sanitize → merge |
| `mergeValues(ai, existing, intent, fields)` | SSOT for who wins on conflict |
| `sanitizeValues(raw, fields)` | Coerce to declared types; drop invented and excluded fields |
| `parseAssistResponse(text)` | Extract JSON from fenced or prose-wrapped completions |
| `MIN_INSTRUCTION_LENGTH` | Per-intent input floors |

### `ai-forms/server`

`createFormAssistHandler(config)` → `(Request) => Promise<Response>`. Web-standard, so it drops straight into a Next.js App Router route. `authorize` runs before any model call.

### `ai-forms/react`

`useAiForm(options)` → values, `setValue`, `ask` / `fill` / `refine`, `busy`, `error`, `transcript`, `changed`, `isAiTouched`, `undo`, `canUndo`, `reset`.

`readPageContext(selector?, maxChars?)` reads rendered text from the page, so a page-aware assistant can only claim to see what is actually on screen.

---

## Guarantees the tests hold

`pnpm run verify` runs the build and the suite. The suite exists to stop specific regressions, not for coverage:

- a fill never overwrites what the user typed; an `overridable` default may be replaced
- a refine applies to existing text and keeps the fields it did not return
- a two-word refine instruction is accepted where a two-word fill is rejected
- prior turns and current values reach the model on a follow-up
- `aiExcluded` fields never appear in a prompt and can never be written
- undeclared fields, uncoercible numbers, and unknown option values are dropped rather than guessed
- calendar dates do not drift a day (local date, never `toISOString`)
- a turn that changes nothing reports that honestly instead of claiming success
- an unauthorised request never reaches the provider

## License

MIT
