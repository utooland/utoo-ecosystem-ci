import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(
  new URL('../scripts/prepare-evjs-h5.mjs', import.meta.url),
);

function checkout(t, name) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ecosystem-evjs-h5-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const manifest = JSON.stringify({
    name,
    workspaces: ['packages/*', 'examples/*'],
    overrides: { '@utoo/pack': 'file:/candidate/pack.tgz' },
  });
  fs.writeFileSync(path.join(directory, 'package.json'), manifest);
  return { directory, manifest };
}

function prepare(directory) {
  return spawnSync(process.execPath, [script], { cwd: directory, encoding: 'utf8' });
}

test('prepares an isolated H5 workspace and preserves candidate overrides on repeated runs', (t) => {
  const { directory, manifest } = checkout(t, 'ev-react-framework');
  const existingExample = path.join(directory, 'examples', 'mpa');
  fs.mkdirSync(existingExample, { recursive: true });
  fs.writeFileSync(path.join(existingExample, 'keep.txt'), 'existing example');

  const result = prepare(directory);
  assert.equal(result.status, 0, result.stderr);
  const example = path.join(directory, 'examples', 'ecosystem-h5');
  const pkg = JSON.parse(fs.readFileSync(path.join(example, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies.marked, '17.0.5');
  assert.equal(pkg.dependencies['@swc/helpers'], undefined);
  assert.equal(pkg.overrides, undefined);
  assert.ok(fs.existsSync(path.join(example, 'src', 'pages', 'page.tsx')));
  const casePath = path.join(directory, 'e2e', 'cases', 'ecosystem-h5.ts');
  assert.ok(fs.existsSync(casePath));

  fs.mkdirSync(path.join(example, 'dist'));
  fs.writeFileSync(path.join(example, 'dist', 'stale.js'), 'stale output');
  fs.writeFileSync(casePath, 'stale test');
  const repeated = prepare(directory);
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.equal(fs.existsSync(path.join(example, 'dist')), false);
  assert.notEqual(fs.readFileSync(casePath, 'utf8'), 'stale test');
  assert.equal(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'), manifest);
  assert.equal(fs.readFileSync(path.join(existingExample, 'keep.txt'), 'utf8'), 'existing example');
});

test('rejects a non-EVJS checkout before changing files', (t) => {
  const { directory, manifest } = checkout(t, 'unrelated-consumer');
  const result = prepare(directory);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Expected an EVJS checkout/);
  assert.equal(fs.existsSync(path.join(directory, 'examples')), false);
  assert.equal(fs.existsSync(path.join(directory, 'e2e')), false);
  assert.equal(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'), manifest);
});
