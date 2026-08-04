import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  defineFields,
  mergeValues,
  sanitizeValues,
  parseAssistResponse,
  runFormAssist,
  MIN_INSTRUCTION_LENGTH,
} from '../dist/index.js';
import { createFormAssistHandler } from '../dist/server.js';

const FIELDS = defineFields([
  { name: 'title', label: 'Title', type: 'text', required: true },
  { name: 'description', label: 'Description', type: 'textarea', maxLength: 40 },
  { name: 'status', label: 'Status', type: 'select', options: [{ value: 'active', label: 'Active' }, { value: 'paused' }] },
  { name: 'effort', label: 'Effort', type: 'number', min: 1, max: 5 },
  { name: 'due', label: 'Due', type: 'date' },
  { name: 'tags', label: 'Tags', type: 'tags' },
  { name: 'currency', label: 'Currency', type: 'text', overridable: true },
  { name: 'ownerId', label: 'Owner', type: 'text', aiExcluded: true },
]);

const TARGET = { key: 'demo', name: 'Demo', fields: FIELDS };

/** A stub provider that returns whatever the test scripted. */
function completeWith(payload) {
  return async () => (typeof payload === 'string' ? payload : JSON.stringify(payload));
}

test('fill protects what the user already typed', () => {
  const { values, changed } = mergeValues(
    { title: 'AI title', description: 'AI description' },
    { title: 'My title', description: '' },
    'fill',
    FIELDS
  );
  assert.equal(values.title, 'My title', 'user input must survive a fill');
  assert.equal(values.description, 'AI description');
  assert.deepEqual(changed, ['description']);
});

test('fill may replace a field marked overridable', () => {
  const { values, changed } = mergeValues(
    { currency: 'EUR' },
    { currency: 'CHF' },
    'fill',
    FIELDS
  );
  assert.equal(values.currency, 'EUR');
  assert.deepEqual(changed, ['currency']);
});

test('refine lets the model win, and keeps fields it did not return', () => {
  const { values, changed } = mergeValues(
    { description: 'Shorter.' },
    { title: 'Keep me', description: 'A very long original description' },
    'refine',
    FIELDS
  );
  assert.equal(values.description, 'Shorter.');
  assert.equal(values.title, 'Keep me', 'omitted fields keep their value');
  assert.deepEqual(changed, ['description']);
});

test('refine reports no change when the model returns identical values', () => {
  const { changed } = mergeValues({ title: 'Same' }, { title: 'Same' }, 'refine', FIELDS);
  assert.deepEqual(changed, []);
});

test('sanitize coerces to the declared types and drops the rest', () => {
  const clean = sanitizeValues(
    {
      title: '  Trimmed  ',
      description: 'x'.repeat(80),
      status: 'Active',
      effort: '9',
      due: 'March 3, 2026',
      tags: 'one, two ,three',
      invented: 'nope',
      ownerId: 'attacker-supplied',
    },
    FIELDS
  );

  assert.equal(clean.title, 'Trimmed');
  assert.equal(clean.description.length, 40, 'maxLength is enforced');
  assert.equal(clean.status, 'active', 'a label resolves to its option value');
  assert.equal(clean.effort, 5, 'numbers clamp to the declared max');
  assert.equal(clean.due, '2026-03-03', 'dates normalise to ISO');
  assert.deepEqual(clean.tags, ['one', 'two', 'three']);
  assert.ok(!('invented' in clean), 'undeclared fields are dropped');
  assert.ok(!('ownerId' in clean), 'aiExcluded fields are never writable by the model');
});

test('sanitize drops values that cannot be coerced rather than guessing', () => {
  const clean = sanitizeValues({ effort: 'lots', status: 'nonsense', due: 'someday' }, FIELDS);
  assert.deepEqual(clean, {});
});

test('parse survives fences and surrounding prose', () => {
  const fenced = parseAssistResponse('Sure!\n```json\n{"values":{"title":"A"},"message":"Set it."}\n```');
  assert.deepEqual(fenced.values, { title: 'A' });
  assert.equal(fenced.message, 'Set it.');

  const bare = parseAssistResponse('{"title":"B"}');
  assert.deepEqual(bare.values, { title: 'B' }, 'a bare value object is tolerated');

  assert.equal(parseAssistResponse('no json at all'), null);
});

test('a short refine instruction is accepted where a short fill is not', async () => {
  assert.ok(MIN_INSTRUCTION_LENGTH.refine < MIN_INSTRUCTION_LENGTH.fill);

  const refined = await runFormAssist({
    target: TARGET,
    request: { intent: 'refine', instruction: 'shorter', values: { description: 'A long one' } },
    complete: completeWith({ values: { description: 'Short' }, message: 'Shortened it.' }),
  });
  assert.equal(refined.ok, true);
  assert.equal(refined.values.description, 'Short');
  assert.deepEqual(refined.changed, ['description']);
  assert.equal(refined.message, 'Shortened it.');

  const filled = await runFormAssist({
    target: TARGET,
    request: { intent: 'fill', instruction: 'short', values: {} },
    complete: completeWith({ values: { title: 'X' } }),
  });
  assert.equal(filled.ok, false);
});

test('history and prior values reach the model on a follow-up turn', async () => {
  let seenPrompt = '';
  await runFormAssist({
    target: TARGET,
    request: {
      intent: 'refine',
      instruction: 'now make it formal',
      values: { description: 'hey there' },
      history: [
        { role: 'user', text: 'make it shorter' },
        { role: 'assistant', text: 'Shortened it.' },
      ],
    },
    complete: async ({ prompt }) => {
      seenPrompt = prompt;
      return JSON.stringify({ values: { description: 'Good day.' }, message: 'Formalised.' });
    },
  });

  assert.match(seenPrompt, /make it shorter/, 'the earlier turn is in the prompt');
  assert.match(seenPrompt, /hey there/, 'the current value is in the prompt');
  assert.doesNotMatch(seenPrompt, /ownerId/, 'excluded fields never reach the model');
});

test('a turn that changes nothing reports honestly instead of claiming success', async () => {
  const result = await runFormAssist({
    target: TARGET,
    request: { intent: 'refine', instruction: 'change it', values: { title: 'Same' } },
    complete: completeWith({ values: { title: 'Same' }, message: 'Done!' }),
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /Nothing changed/);
});

test('a missing message falls back to naming the fields that changed', async () => {
  const result = await runFormAssist({
    target: TARGET,
    request: { intent: 'fill', instruction: 'a demo item about bikes', values: {} },
    complete: completeWith({ values: { title: 'Bikes', effort: 2 } }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.message, 'Updated Title and Effort.');
});

test('a provider failure surfaces as an error, not a crash', async () => {
  const result = await runFormAssist({
    target: TARGET,
    request: { intent: 'fill', instruction: 'something reasonable here', values: {} },
    complete: async () => { throw new Error('groq 429'); },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'groq 429');
});

test('the handler refuses forms it does not know', async () => {
  const handler = createFormAssistHandler({
    targets: [TARGET],
    complete: completeWith({ values: { title: 'X' }, message: 'ok' }),
  });

  const response = await handler(
    new Request('http://localhost/api/ai/form-assist', {
      method: 'POST',
      body: JSON.stringify({ target: 'not-a-form', intent: 'fill', instruction: 'anything at all' }),
    })
  );
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.error, /Unknown form/);
});

test('the handler runs authorize before touching the model', async () => {
  let called = false;
  const handler = createFormAssistHandler({
    targets: [TARGET],
    authorize: () => ({ ok: false, status: 401, error: 'Sign in first.' }),
    complete: async () => { called = true; return '{}'; },
  });

  const response = await handler(
    new Request('http://localhost/api/ai/form-assist', {
      method: 'POST',
      body: JSON.stringify({ target: 'demo', intent: 'fill', instruction: 'anything at all' }),
    })
  );
  assert.equal(response.status, 401);
  assert.equal(called, false, 'an unauthorised request must not reach the provider');
});
