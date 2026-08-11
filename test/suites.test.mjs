import assert from 'node:assert/strict';
import test from 'node:test';
import { SUITE_NAMES, SUITES } from '../src/suites.mjs';

test('defines the requested ecosystem suites', () => {
  assert.deepEqual(SUITE_NAMES, [
    'umi',
    'ant-design-pro',
    'father',
    'dumi',
    'evjs',
  ]);
});

test('all suites use explicit repositories, refs, commands, and output checks', () => {
  for (const suite of Object.values(SUITES)) {
    assert.match(suite.repository, /^[\w.-]+\/[\w.-]+$/);
    assert.match(suite.ref, /^[\w./-]+$/);
    assert.ok(suite.install.length > 0);
    assert.ok(suite.test.length > 0);
    assert.ok(suite.nonEmptyDirectories.length > 0);
  }
});

test('EVJS runs only its utoopack Playwright projects', () => {
  const commands = SUITES.evjs.test.map((command) => command.join(' '));
  assert.deepEqual(commands, [
    'npx turbo build --filter=./packages/*',
    'npm run test:e2e -- --project=utoopack --project=utoopack-scaffold',
  ]);
  assert.equal(
    SUITES.evjs.directManifest,
    'packages/bundler-utoopack/package.json',
  );
  assert.equal(
    SUITES.evjs.candidateResolveFrom,
    'packages/bundler-utoopack/package.json',
  );
  assert.deepEqual(SUITES.evjs.staleCandidateDirectories, [
    'packages/bundler-utoopack/node_modules/@utoo/pack',
    'packages/bundler-utoopack/node_modules/@utoo/pack-shared',
  ]);
});
