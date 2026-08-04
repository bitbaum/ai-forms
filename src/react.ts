import { useCallback, useMemo, useRef, useState } from 'react';
import { emptyValues } from './fields.js';
import type { AssistIntent, AssistResult, AssistTurn, FieldSpec } from './types.js';

export const DEFAULT_ENDPOINT = '/api/ai/form-assist';

export interface UseAiFormOptions {
  /** Form key registered on the server. */
  target: string;
  /** Field specs — the same list the server registered, used here for empty state and labels. */
  fields: readonly FieldSpec[];
  endpoint?: string;
  initialValues?: Record<string, unknown>;
  /** Supply what the user can see, for page-aware chat entry points. */
  pageContext?: () => string | undefined;
  onApplied?: (values: Record<string, unknown>, changed: readonly string[]) => void;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

export interface UseAiForm {
  /** The single store both the user and the assistant write to. */
  values: Record<string, unknown>;
  setValue: (name: string, value: unknown) => void;
  setValues: (next: Record<string, unknown>) => void;
  /** Convenience for `value={String(form.text('title'))}` on text inputs. */
  text: (name: string) => string;
  reset: () => void;

  /**
   * Send an instruction. The intent is inferred: an untouched form is filled,
   * a form with content is refined — so the user never picks a mode.
   */
  ask: (instruction: string) => Promise<AssistResult>;
  fill: (instruction: string) => Promise<AssistResult>;
  refine: (instruction: string) => Promise<AssistResult>;

  busy: boolean;
  error: string | null;
  /** Every turn so far, so a form can render the exchange inline. */
  transcript: readonly AssistTurn[];
  /** Fields the assistant changed on the last turn. */
  changed: readonly string[];
  /** True when the assistant wrote this field at any point this session. */
  isAiTouched: (name: string) => boolean;

  undo: () => void;
  canUndo: boolean;
  /** Whether any field currently holds a value. */
  isEmpty: boolean;
}

export function useAiForm(options: UseAiFormOptions): UseAiForm {
  const { target, fields, endpoint = DEFAULT_ENDPOINT, onApplied } = options;
  const doFetch = options.fetchImpl ?? globalThis.fetch;

  const blank = useMemo(
    () => ({ ...emptyValues(fields), ...(options.initialValues ?? {}) }),
    // Field specs and initial values are module-level config in practice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [values, setValuesState] = useState<Record<string, unknown>>(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<AssistTurn[]>([]);
  const [changed, setChanged] = useState<readonly string[]>([]);
  const [touched, setTouched] = useState<readonly string[]>([]);
  const history = useRef<Record<string, unknown>[]>([]);
  const [canUndo, setCanUndo] = useState(false);

  const isEmpty = useMemo(() => !Object.values(values).some(hasContent), [values]);

  const setValue = useCallback((name: string, value: unknown) => {
    setValuesState(current => ({ ...current, [name]: value }));
  }, []);

  const setValues = useCallback((next: Record<string, unknown>) => {
    setValuesState(current => ({ ...current, ...next }));
  }, []);

  const text = useCallback(
    (name: string) => {
      const value = values[name];
      return value === null || value === undefined ? '' : String(value);
    },
    [values]
  );

  const reset = useCallback(() => {
    setValuesState(blank);
    setTranscript([]);
    setChanged([]);
    setTouched([]);
    setError(null);
    history.current = [];
    setCanUndo(false);
  }, [blank]);

  const undo = useCallback(() => {
    const previous = history.current.pop();
    if (!previous) {
      return;
    }
    setValuesState(previous);
    setChanged([]);
    setCanUndo(history.current.length > 0);
  }, []);

  const run = useCallback(
    async (instruction: string, intent: AssistIntent): Promise<AssistResult> => {
      const trimmed = instruction.trim();
      if (trimmed === '') {
        const failure: AssistResult = { ok: false, error: 'Type what you want first.' };
        setError(failure.ok ? null : failure.error);
        return failure;
      }

      setBusy(true);
      setError(null);
      const priorTranscript = transcript;
      setTranscript(current => [...current, { role: 'user', text: trimmed }]);

      try {
        const response = await doFetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            target,
            intent,
            instruction: trimmed,
            values,
            history: priorTranscript,
            pageContext: options.pageContext?.(),
          }),
        });

        const result = (await response.json()) as AssistResult;

        if (!result.ok) {
          setError(result.error);
          setTranscript(current => [...current, { role: 'assistant', text: result.error }]);
          return result;
        }

        history.current.push(values);
        setCanUndo(true);
        setValuesState(result.values);
        setChanged(result.changed);
        setTouched(current => Array.from(new Set([...current, ...result.changed])));
        setTranscript(current => [...current, { role: 'assistant', text: result.message }]);
        onApplied?.(result.values, result.changed);
        return result;
      } catch (caught) {
        const message =
          caught instanceof Error ? caught.message : 'Could not reach the assistant.';
        setError(message);
        setTranscript(current => [...current, { role: 'assistant', text: message }]);
        return { ok: false, error: message };
      } finally {
        setBusy(false);
      }
    },
    [doFetch, endpoint, onApplied, options, target, transcript, values]
  );

  const fill = useCallback((instruction: string) => run(instruction, 'fill'), [run]);
  const refine = useCallback((instruction: string) => run(instruction, 'refine'), [run]);
  const ask = useCallback(
    (instruction: string) => run(instruction, isEmpty ? 'fill' : 'refine'),
    [isEmpty, run]
  );

  const isAiTouched = useCallback((name: string) => touched.includes(name), [touched]);

  return {
    values,
    setValue,
    setValues,
    text,
    reset,
    ask,
    fill,
    refine,
    busy,
    error,
    transcript,
    changed,
    isAiTouched,
    undo,
    canUndo,
    isEmpty,
  };
}

function hasContent(value: unknown): boolean {
  if (value === '' || value === null || value === undefined || value === false) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return true;
}

/**
 * What the user can actually see, for page-aware chat. Reads rendered text
 * rather than route metadata so the assistant cannot claim to see something
 * that is not on screen.
 */
export function readPageContext(selector = 'main', maxChars = 1800): string | undefined {
  if (typeof document === 'undefined') {
    return undefined;
  }
  const root = document.querySelector(selector) ?? document.body;
  const text = (root as HTMLElement).innerText?.replace(/\s+\n/g, '\n').trim();
  return text ? text.slice(0, maxChars) : undefined;
}
