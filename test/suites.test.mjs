import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { SUITE_NAMES, SUITES } from '../src/suites.mjs';

test('Umi runs its native utoopack and qiankun E2E coverage', () => {
  const commands = SUITES.umi.test.map((command) => command.join(' '));
  assert.equal(
    commands[0],
    'corepack pnpm umi-scripts turbo build --filter ./packages/umi/... --filter ./packages/plugins/... --filter ./packages/bundler-utoopack/...',
  );
  assert.equal(commands[1], 'corepack pnpm exec playwright install chromium');
  assert.equal(path.basename(SUITES.umi.test[2][1]), 'umi-utoopack-e2e.mjs');
  assert.deepEqual(commands.slice(3), [
    'corepack pnpm umi-scripts turbo build --filter ./examples/max...',
    'corepack pnpm --dir examples/qiankun-slave e2e:ci',
    'corepack pnpm --dir examples/with-utoopack-qiankun-master e2e:ci',
  ]);
});

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
    'npm run test:e2e -- --project=utoopack',
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

test('Father validates only its utoopack UMD example', () => {
  const commands = SUITES.father.test.map((command) => command.join(' '));
  assert.deepEqual(commands, [
    'corepack pnpm tsc',
    'corepack pnpm --dir examples/utoo-pack build',
  ]);
});

test('Dumi skips its unrelated Rust crates and builds the utoopack example', () => {
  const install = SUITES.dumi.install.map((command) => command.join(' '));
  const testCommands = SUITES.dumi.test.map((command) => command.join(' '));
  assert.deepEqual(install, [
    'corepack pnpm install --no-frozen-lockfile --ignore-scripts',
  ]);
  assert.deepEqual(testCommands, [
    'corepack pnpm exec father build',
    'corepack pnpm --dir examples/normal-utoopack build',
  ]);
});
