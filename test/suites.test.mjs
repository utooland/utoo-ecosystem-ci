import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { SUITE_NAMES, SUITES } from '../src/suites.mjs';

const commandOf = (step) => (Array.isArray(step) ? step : step.command);

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
    'ant-design',
    'father',
    'dumi',
    'evjs',
  ]);
});

test('Ant Design covers the issue 3332 production and dev reproduction', () => {
  const suite = SUITES['ant-design'];
  assert.equal(suite.repository, 'ant-design/ant-design');
  assert.equal(suite.ref, '7793cab03924d29db45d64dadc1c81d0a8cf59e0');
  assert.deepEqual(suite.install, [['ut', 'install']]);
  assert.equal(suite.test[0].join(' '), 'npm run site');

  const dev = suite.test[1];
  assert.equal(path.basename(dev.command[1]), 'utoopack-dev-server-smoke.mjs');
  assert.deepEqual(dev.command.slice(2), [
    '--url',
    'http://127.0.0.1:8001/',
    '--timeout',
    '600000',
    '--',
    'npm',
    'start',
  ]);
  assert.deepEqual(suite.nonEmptyDirectories, ['_site']);
});

test('Ant Design Pro covers both production build and utoopack dev', () => {
  assert.deepEqual(SUITES['ant-design-pro'].install, [['ut', 'install']]);
  assert.equal(SUITES['ant-design-pro'].test[0].join(' '), 'npm run build');
  const dev = SUITES['ant-design-pro'].test[1];
  assert.equal(path.basename(dev.command[1]), 'utoopack-dev-server-smoke.mjs');
  assert.deepEqual(dev.command.slice(2), [
    '--url',
    'http://127.0.0.1:9528/',
    '--',
    'npm',
    'run',
    'dev',
  ]);
  assert.deepEqual(dev.env, {
    NODE_ENV: 'development',
    PORT: '9528',
  });
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

test('EVJS runs its utoopack dev smoke and Playwright project', () => {
  const commands = SUITES.evjs.test.map((command) => command.join(' '));
  assert.equal(commands[0], 'npx turbo build --filter=./packages/*');
  assert.equal(
    path.basename(SUITES.evjs.test[1][1]),
    'evjs-utoopack-dev-smoke.mjs',
  );
  assert.equal(commands[2], 'npm run test:e2e -- --project=utoopack');
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

test('Dumi builds its local source with a minimal utoopack site example', () => {
  const install = SUITES.dumi.install.map((command) => command.join(' '));
  const testCommands = SUITES.dumi.test.map((step) =>
    commandOf(step).join(' '),
  );
  assert.deepEqual(install, [
    'corepack pnpm install --no-frozen-lockfile --ignore-scripts',
  ]);
  assert.equal(testCommands[0], 'corepack pnpm exec father build');
  assert.equal(path.basename(SUITES.dumi.test[1][1]), 'prepare-dumi-example.mjs');
  assert.equal(
    testCommands[2],
    'corepack pnpm --dir examples/utoopack-ecosystem-ci build',
  );
  const dev = SUITES.dumi.test[3];
  assert.equal(path.basename(dev.command[1]), 'utoopack-dev-server-smoke.mjs');
  assert.deepEqual(dev.command.slice(2), [
    '--cwd',
    'examples/utoopack-ecosystem-ci',
    '--url',
    'http://127.0.0.1:9529/',
    '--',
    'corepack',
    'pnpm',
    'dev',
  ]);
  assert.deepEqual(dev.env, {
    NODE_ENV: 'development',
    PORT: '9529',
  });
  assert.deepEqual(SUITES.dumi.nonEmptyDirectories, [
    'examples/utoopack-ecosystem-ci/dist',
  ]);
});
