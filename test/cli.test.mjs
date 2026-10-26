import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
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

test('selects the CLI candidate independently of the bundler candidate', () => {
  const options = parseArgs(['--suite', 'umi', '--pack', 'next', '--pack-cli', '1.5.30']);
  assert.equal(options.packCli, '1.5.30');
});

test('requires a CLI tarball when the Umi suite uses a local pack candidate', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'utoo-cli-spec-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const candidate = path.join(directory, 'utoo-pack.tgz');
  fs.writeFileSync(candidate, 'candidate');
  await assert.rejects(run({
    suite: 'umi', pack: candidate, packShared: candidate, dryRun: true,
  }), /requires --pack-cli/);
});

test('rejects missing option values and unknown flags', () => {
  assert.throws(() => parseArgs(['--suite']), /requires a value/);
  assert.throws(() => parseArgs(['--unknown']), /Unknown argument/);
});

test('selects an exact version from npm view output', () => {
  assert.equal(selectNpmViewVersion('"1.5.3"'), '1.5.3');
  assert.equal(
    selectNpmViewVersion('["1.5.2", "1.5.3"]'),
    '1.5.3',
  );
  assert.throws(() => selectNpmViewVersion('{}'), /Unexpected npm view output/);
});
