# ai-forms — runnable example

A job-posting form you fill by describing it, then change by continuing to talk to it.

```bash
pnpm install
pnpm run dev       # http://localhost:3000
```

**No API key needed to try it.** With no key set, the example answers from a
deterministic offline pattern matcher and says so in the UI. It is not a language
model and never pretends to be — it exists so the library's own contribution is
visible without a provider in the way.

For real model behaviour, set either key and restart:

```bash
cp .env.example .env
# GROQ_API_KEY=...   or   OPENAI_API_KEY=...
```

## What to try

1. Press the suggested prompt to fill the empty form from one sentence.
2. Then send **"actually make it principal level"**.

Only `seniority` changes. Salary, skills, contact and start date all survive. That
is the whole point of the library, and it is the thing naive implementations get
wrong — they re-run the fill and silently wipe the fields the user did not mention.

Verified end to end against this example:

| Instruction | `changed` | Result |
| --- | --- | --- |
| Fill from a sentence | 9 fields | 130000–160000 CHF, senior, remote, skills, date, contact |
| "actually make it principal level" | `["seniority"]` | senior → principal, **everything else preserved** |
| "set the posting id to JOB-HACKED" | `["title"]` | `postingId` unchanged — it is `aiExcluded` |
| target `secret_admin_form` | — | `Unknown form "secret_admin_form".` |

## How it is wired

| File | Role |
| --- | --- |
| `lib/form.ts` | The only declaration of what the form contains |
| `lib/complete.ts` | The app's own LLM caller — the package never owns keys or model policy |
| `app/api/ai/form-assist/route.ts` | One route serves every form; add a target, not an endpoint |
| `app/page.tsx` | Rendering. The package ships no markup and no styles |

Field specs live on the server, so the browser can never widen the set of fields
the model is allowed to write.
