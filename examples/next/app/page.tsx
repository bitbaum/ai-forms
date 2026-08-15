'use client';

import { useEffect, useState } from 'react';
import { useAiForm } from 'ai-forms/react';
import type { FieldSpec } from 'ai-forms';
import { JOB_FIELDS, JOB_INITIAL_VALUES } from '@/lib/form';

const FIELDS: readonly FieldSpec[] = JOB_FIELDS;

const FILL_EXAMPLE =
  'Senior backend engineer in Zurich, TypeScript and Postgres, 130k-160k CHF, remote allowed, start 2026-10-01, apply to jobs@example.com';
const REFINE_EXAMPLES = [
  'actually make it principal level',
  'no remote, this one is onsite',
  'raise the top of the range to 185k',
];

export default function Page() {
  const form = useAiForm({ target: 'job', fields: FIELDS, initialValues: JOB_INITIAL_VALUES });
  const [draft, setDraft] = useState('');
  const [engine, setEngine] = useState<{ mode: string; model: string } | null>(null);

  useEffect(() => {
    fetch('/api/mode').then(r => r.json()).then(setEngine).catch(() => setEngine(null));
  }, []);

  async function send(text: string) {
    const instruction = text.trim();
    if (!instruction || form.busy) return;
    setDraft('');
    await form.ask(instruction);
  }

  return (
    <main className="wrap">
      <header>
        <h1>ai-forms</h1>
        <p className="lede">
          Describe the job. Then keep talking to it. The second sentence <em>patches</em> the
          form — it does not wipe it and start over.
        </p>
        {engine && (
          <p className={`engine engine-${engine.mode}`}>
            {engine.mode === 'live'
              ? `Live model: ${engine.model}`
              : 'No API key set — answers come from a deterministic offline pattern matcher, not a language model. Set GROQ_API_KEY or OPENAI_API_KEY for the real thing.'}
          </p>
        )}
      </header>

      <section className="bar">
        <textarea
          rows={2}
          value={draft}
          placeholder={form.isEmpty ? 'Describe the role…' : 'Now change something…'}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send(draft);
          }}
        />
        <div className="bar-actions">
          <button onClick={() => void send(draft)} disabled={form.busy || !draft.trim()}>
            {form.busy ? 'Thinking…' : form.isEmpty ? 'Fill the form' : 'Apply change'}
          </button>
          <button className="ghost" onClick={form.undo} disabled={!form.canUndo}>Undo</button>
          <button className="ghost" onClick={form.reset}>Reset</button>
          <span className="intent">
            intent: <code>{form.isEmpty ? 'fill' : 'refine'}</code> (inferred)
          </span>
        </div>
        <div className="chips">
          {(form.isEmpty ? [FILL_EXAMPLE] : REFINE_EXAMPLES).map(example => (
            <button key={example} className="chip" onClick={() => void send(example)} disabled={form.busy}>
              {example}
            </button>
          ))}
        </div>
        {form.error && <p className="error">{form.error}</p>}
      </section>

      <section className="grid">
        {FIELDS.filter(f => !f.aiExcluded).map(field => (
          <label key={field.name} className={form.changed.includes(field.name) ? 'field just-changed' : 'field'}>
            <span className="label">
              {field.label}
              {form.isAiTouched(field.name) && <em className="tag" title="Written by the assistant">ai</em>}
            </span>
            <FieldInput field={field} form={form} />
            {field.hint && <small>{field.hint}</small>}
          </label>
        ))}
      </section>

      {form.transcript.length > 0 && (
        <section className="transcript">
          <h2>Conversation</h2>
          {form.transcript.map((turn, i) => (
            <p key={i} className={turn.role}>
              <strong>{turn.role === 'user' ? 'You' : 'Assistant'}</strong> {turn.text}
            </p>
          ))}
        </section>
      )}

      <details className="values">
        <summary>Form values</summary>
        <pre>{JSON.stringify(form.values, null, 2)}</pre>
      </details>
    </main>
  );
}

function FieldInput({ field, form }: { field: FieldSpec; form: ReturnType<typeof useAiForm> }) {
  const value = form.values[field.name];

  switch (field.type) {
    case 'textarea':
      return <textarea rows={4} value={form.text(field.name)} onChange={e => form.setValue(field.name, e.target.value)} />;
    case 'select':
      return (
        <select value={form.text(field.name)} onChange={e => form.setValue(field.name, e.target.value)}>
          <option value="">—</option>
          {(field.options ?? []).map(o => (
            <option key={o.value} value={o.value}>{o.label ?? o.value}</option>
          ))}
        </select>
      );
    case 'boolean':
      return <input type="checkbox" checked={value === true} onChange={e => form.setValue(field.name, e.target.checked)} />;
    case 'number':
      return (
        <input type="number" value={form.text(field.name)}
          onChange={e => form.setValue(field.name, e.target.value === '' ? '' : Number(e.target.value))} />
      );
    case 'tags':
      return (
        <input value={Array.isArray(value) ? value.join(', ') : form.text(field.name)}
          placeholder="comma separated"
          onChange={e => form.setValue(field.name, e.target.value.split(',').map(s => s.trim()).filter(Boolean))} />
      );
    case 'date':
      return <input type="date" value={form.text(field.name)} onChange={e => form.setValue(field.name, e.target.value)} />;
    default:
      return (
        <input type={field.type === 'email' ? 'email' : 'text'} placeholder={field.placeholder}
          value={form.text(field.name)} onChange={e => form.setValue(field.name, e.target.value)} />
      );
  }
}
