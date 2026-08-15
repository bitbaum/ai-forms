import { defineFields } from 'ai-forms';

/**
 * One declaration of what this form contains. The server resolves fields by
 * target key, so the browser can never widen the set the model may write.
 */
export const JOB_FIELDS = defineFields([
  { name: 'title', label: 'Role title', type: 'text', required: true, maxLength: 80,
    placeholder: 'Senior Backend Engineer' },
  { name: 'summary', label: 'Summary', type: 'textarea', maxLength: 600,
    hint: 'Two or three sentences a candidate would actually read.' },
  { name: 'seniority', label: 'Seniority', type: 'select',
    options: [
      { value: 'intern', label: 'Intern' },
      { value: 'junior', label: 'Junior' },
      { value: 'mid', label: 'Mid' },
      { value: 'senior', label: 'Senior' },
      { value: 'staff', label: 'Staff' },
      { value: 'principal', label: 'Principal' },
    ] },
  { name: 'skills', label: 'Skills', type: 'tags',
    hint: 'Technologies the role actually requires.' },
  { name: 'salaryMin', label: 'Salary from', type: 'number', min: 0 },
  { name: 'salaryMax', label: 'Salary to', type: 'number', min: 0 },
  { name: 'currency', label: 'Currency', type: 'select', overridable: true,
    options: [{ value: 'CHF' }, { value: 'EUR' }, { value: 'USD' }],
    hint: 'Defaults to CHF; a fill pass may replace it because it is a template default.' },
  { name: 'remote', label: 'Remote allowed', type: 'boolean' },
  { name: 'startDate', label: 'Start date', type: 'date' },
  { name: 'contact', label: 'Contact email', type: 'email' },
  // Never shown to the model and never written by it.
  { name: 'postingId', label: 'Posting ID', type: 'text', aiExcluded: true },
]);

export const JOB_TARGET = {
  key: 'job',
  name: 'Job posting',
  fields: JOB_FIELDS,
  instructions: [
    'Salary figures are annual gross, in the form currency.',
    'The summary is addressed to the candidate, never to the recruiter.',
  ],
} as const;

export const JOB_INITIAL_VALUES = { currency: 'CHF', postingId: 'JOB-2043' };
