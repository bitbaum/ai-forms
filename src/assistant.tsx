'use client';

/**
 * The one AI assistant control, shared by every app that uses this package.
 *
 * Each adopter used to render its own bar around `useAiForm` — AOZ and evig
 * had near line-for-line copies — so an improvement to the experience (the
 * suggestions below, clearing a stale "1 field updated") had to be made once
 * per app and usually was made once in total. The behaviour lives here now;
 * an app supplies only words (`labels`) and its design tokens (`classNames`).
 *
 * It ships no styling of its own on purpose: a package cannot know an app's
 * tokens, and a default look would be the one thing every app overrides.
 */

import { useState, type ReactNode } from 'react';
import type { UseAiForm } from './react.js';

export interface AiFormAssistantLabels {
  fillTitle: string;
  refineTitle: string;
  fillHint: string;
  refineHint: string;
  fillPlaceholder: string;
  refinePlaceholder: string;
  fillSubmit: string;
  refineSubmit: string;
  working: string;
  undo: string;
  changed: (count: number) => string;
  suggest: string;
  suggesting: string;
  suggestionsTitle: string;
}

export const DEFAULT_ASSISTANT_LABELS: AiFormAssistantLabels = {
  fillTitle: 'Fill with AI',
  refineTitle: 'Change with AI',
  fillHint: 'Describe it in your own words, or paste a text — the fields fill themselves.',
  refineHint: 'Say what should be different, paste more details, or ask for suggestions.',
  fillPlaceholder: 'Describe it or paste a text…',
  refinePlaceholder: 'e.g. "write the description", "shorter", or paste more details',
  fillSubmit: 'Fill in',
  refineSubmit: 'Apply',
  working: 'Working…',
  undo: 'Undo',
  changed: (count) => (count === 1 ? '1 field updated' : `${count} fields updated`),
  suggest: 'Suggest improvements',
  suggesting: 'Looking…',
  suggestionsTitle: 'Suggestions',
};

/** Slots an app fills with its own token classes. Every slot is optional. */
export interface AiFormAssistantClassNames {
  root: string;
  header: string;
  title: string;
  hint: string;
  textarea: string;
  actions: string;
  submit: string;
  secondary: string;
  status: string;
  error: string;
  suggestions: string;
  suggestionsTitle: string;
  suggestion: string;
}

export interface AiFormAssistantProps {
  form: UseAiForm;
  labels?: Partial<AiFormAssistantLabels>;
  classNames?: Partial<AiFormAssistantClassNames>;
  /** Rendered before the title, e.g. a sparkle icon from the app's icon set. */
  icon?: ReactNode;
  /**
   * Ask for suggestions automatically after a successful fill, so a user who
   * just pasted a description sees what could be better without asking.
   * Costs one extra model call per fill — off by default for rationed tiers.
   */
  suggestAfterFill?: boolean;
  /** Stable id for the textarea, when a page renders more than one assistant. */
  id?: string;
}

export function AiFormAssistant({
  form,
  labels,
  classNames,
  icon,
  suggestAfterFill = false,
  id = 'ai-form-instruction',
}: AiFormAssistantProps) {
  const [instruction, setInstruction] = useState('');
  const l = { ...DEFAULT_ASSISTANT_LABELS, ...labels };
  const c = classNames ?? {};
  const isFill = form.isEmpty;
  const idle = !form.busy && !form.suggesting;

  async function run() {
    if (!idle || instruction.trim() === '') return;
    const wasFill = isFill;
    const result = await form.ask(instruction);
    // Only clear on success — a failed instruction is the one the user most
    // wants to edit and retry, not retype from memory.
    if (result.ok) {
      setInstruction('');
      if (wasFill && suggestAfterFill) void form.suggest();
    }
  }

  return (
    <div className={c.root}>
      <div className={c.header}>
        <h2 className={c.title}>
          {icon}
          {isFill ? l.fillTitle : l.refineTitle}
        </h2>
        {form.canUndo ? (
          // type="button" throughout: this sits inside the app's <form>, and
          // the default submit type would post the form instead.
          <button type="button" onClick={form.undo} disabled={!idle} className={c.secondary}>
            {l.undo}
          </button>
        ) : null}
      </div>
      <p className={c.hint}>{isFill ? l.fillHint : l.refineHint}</p>

      <label
        htmlFor={id}
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          overflow: 'hidden',
          clip: 'rect(0 0 0 0)',
        }}
      >
        {isFill ? l.fillTitle : l.refineTitle}
      </label>
      <textarea
        id={id}
        rows={3}
        value={instruction}
        onChange={(event) => setInstruction(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            void run();
          }
        }}
        placeholder={isFill ? l.fillPlaceholder : l.refinePlaceholder}
        disabled={!idle}
        className={c.textarea}
      />

      <div className={c.actions}>
        <button
          type="button"
          onClick={() => void run()}
          disabled={!idle || instruction.trim() === ''}
          className={c.submit}
        >
          {form.busy ? l.working : isFill ? l.fillSubmit : l.refineSubmit}
        </button>

        {!isFill ? (
          <button
            type="button"
            onClick={() => void form.suggest()}
            disabled={!idle}
            className={c.secondary}
          >
            {form.suggesting ? l.suggesting : l.suggest}
          </button>
        ) : null}

        {form.changed.length > 0 && idle ? (
          <span className={c.status} role="status">
            {l.changed(form.changed.length)}
          </span>
        ) : null}
      </div>

      {form.suggestions.length > 0 ? (
        <div className={c.suggestions}>
          <p className={c.suggestionsTitle}>{l.suggestionsTitle}</p>
          {form.suggestions.map((suggestion) => (
            <button
              key={suggestion.instruction}
              type="button"
              title={suggestion.instruction}
              onClick={() => void form.applySuggestion(suggestion)}
              disabled={!idle}
              className={c.suggestion}
            >
              {suggestion.label}
            </button>
          ))}
        </div>
      ) : null}

      {form.error ? (
        <p role="alert" className={c.error}>
          {form.error}
        </p>
      ) : null}
    </div>
  );
}
