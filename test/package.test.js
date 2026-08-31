/**
 * Consume the package the way npm does, not the way the repo does.
 *
 * The rest of the suite imports `../dist/index.js` by relative path, which
 * walks straight past the two things a consumer actually depends on: the
 * `exports` map and the `files` allowlist. Either can be wrong while every
 * other test stays green — a missing subpath, a `types` path that points at
 * nothing, a build output left out of the tarball. The failure then lands on
 * whoever runs `npm install` first, which is the worst possible witness.
 *
 * So this packs the real tarball, unpacks it as `node_modules/ai-forms`, and
 * imports it by bare specifier from outside the repo.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');

/** Named exports a consumer is entitled to find, per entry point. */
const PUBLIC_API = {
  '.': [
    'defineFields',
    'assistableFields',
    'redactExcluded',
    'emptyValues',
    'sanitizeValues',
    'mergeValues',
    'valuesEqual',
    'buildSystemPrompt',
    'buildUserPrompt',
    'describeFields',
    'parseAssistResponse',
    'runFormAssist',
    'MIN_INSTRUCTION_LENGTH',
  ],
  './server': ['createFormAssistHandler'],
  './react': ['useAiForm', 'readPageContext', 'DEFAULT_ENDPOINT'],
};

let workspace;
let probe;

before(() => {
  workspace = mkdtempSync(path.join(tmpdir(), 'ai-forms-pack-'));
  const installDir = path.join(workspace, 'node_modules', 'ai-forms');
  mkdirSync(installDir, { recursive: true });

  const tarball = execFileSync('npm', ['pack', '--silent', '--pack-destination', workspace], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .pop();

  execFileSync('tar', [
    '-xzf',
    path.join(workspace, tarball),
    '-C',
    installDir,
    '--strip-components=1',
  ]);

  // Runs from the temp workspace, so `ai-forms` resolves through node_modules
  // and the exports map exactly as it would in a consumer's project.
  // Every probe records failure as a value rather than throwing. A broken
  // exports map would otherwise take down the setup and fail every assertion
  // in this file at once, burying which entry point actually broke.
  const probeFile = path.join(workspace, 'probe.mjs');
  writeFileSync(
    probeFile,
    `const SUBPATHS = ['.', './server', './react'];
const specifierFor = sub => (sub === '.' ? 'ai-forms' : 'ai-forms/' + sub.slice(2));

// React is an optional peer and may be absent here, so './react' is resolved
// but never imported — that still proves the exports map and file exist.
const resolved = {};
for (const sub of SUBPATHS) {
  try {
    resolved[sub] = import.meta.resolve(specifierFor(sub));
  } catch {
    resolved[sub] = null;
  }
}

const out = {};
for (const sub of ['.', './server']) {
  try {
    out[sub] = Object.keys(await import(specifierFor(sub))).sort();
  } catch {
    out[sub] = null;
  }
}

console.log(JSON.stringify({ out, resolved }));
`,
  );

  probe = JSON.parse(
    execFileSync('node', [probeFile], { cwd: workspace, encoding: 'utf8' }).trim(),
  );
});

after(() => {
  if (workspace) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('every declared entry point resolves from a consumer install', () => {
  for (const subpath of Object.keys(PUBLIC_API)) {
    const url = probe.resolved[subpath];
    assert.ok(url, `exports map does not resolve "${subpath}"`);
    assert.ok(
      existsSync(new URL(url)),
      `"${subpath}" resolves to ${url}, which is not in the tarball`,
    );
  }
});

test('the runtime entry points expose their whole public API', () => {
  for (const subpath of ['.', './server']) {
    assert.ok(probe.out[subpath], `importing "${subpath}" from a consumer install threw`);
    for (const name of PUBLIC_API[subpath]) {
      assert.ok(
        probe.out[subpath].includes(name),
        `"${name}" is missing from the published "${subpath}" entry point`,
      );
    }
  }
});

test('the react entry point ships the exports it declares', () => {
  // Not imported: `react` is an optional peer, so executing it here would test
  // the temp workspace's dependencies rather than this package. Reading the
  // built source is enough to catch an entry point that lost its exports.
  const url = probe.resolved['./react'];
  assert.ok(url, 'exports map does not resolve "./react"');
  const source = readFileSync(new URL(url), 'utf8');
  for (const name of PUBLIC_API['./react']) {
    assert.match(
      source,
      new RegExp(`\\b${name}\\b`),
      `"${name}" is missing from the published react entry point`,
    );
  }
});

test('every entry point ships the type declarations it advertises', () => {
  const installDir = path.join(workspace, 'node_modules', 'ai-forms');
  const manifest = JSON.parse(readFileSync(path.join(installDir, 'package.json'), 'utf8'));

  for (const [subpath, entry] of Object.entries(manifest.exports)) {
    assert.ok(entry.types, `"${subpath}" declares no types entry`);
    assert.ok(
      existsSync(path.join(installDir, entry.types)),
      `"${subpath}" advertises types at ${entry.types}, which is not in the tarball`,
    );
  }
});

test('the tarball carries the documentation npm will render', () => {
  const installDir = path.join(workspace, 'node_modules', 'ai-forms');
  for (const file of ['README.md', 'LICENSE']) {
    assert.ok(existsSync(path.join(installDir, file)), `${file} is missing from the tarball`);
  }
});
