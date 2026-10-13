import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { parseArgs, run, selectNpmViewVersion } from '../src/cli.mjs';

test('parses a suite invocation', () => {
  const options = parseArgs([
    '--suite',
    'father',
    '--pack',
    'latest',
    '--ref',
    'feature/test',
    '--dry-run',
  ]);
  assert.equal(options.suite, 'father');
  assert.equal(options.pack, 'latest');
  assert.equal(options.ref, 'feature/test');
  assert.equal(options.dryRun, true);
  assert.equal(options.workspace, path.resolve('workspace'));
});

test('rejects missing option values and unknown flags', () => {
  assert.throws(() => parseArgs(['--suite']), /requires a value/);
  assert.throws(() => parseArgs(['--unknown']), /Unknown argument/);
});

test('selects an exact version from npm view output', () => {
  assert.equal(selectNpmViewVersion('"1.5.3"'), '1.5.3');
  assert.equal(selectNpmViewVersion('["1.5.2", "1.5.3"]'), '1.5.3');
  assert.throws(() => selectNpmViewVersion('{}'), /Unexpected npm view output/);
});

test('CLI dry run automatically selects the Windows Umi command plan', async (context) => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  const messages = [];
  context.mock.method(console, 'log', (message) => messages.push(message));
  try {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    await run(parseArgs(['--suite', 'umi', '--pack', 'latest', '--dry-run']));
    const plan = JSON.parse(messages.at(-1));
    assert.equal(plan.commands.length, 4);
    assert(
      plan.commands.some((command) => command.includes('umi-utoopack-e2e.mjs')),
    );
    assert(!plan.commands.some((command) => command.includes('qiankun')));
  } finally {
    Object.defineProperty(process, 'platform', platform);
  }
});
