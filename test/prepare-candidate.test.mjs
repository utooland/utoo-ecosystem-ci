import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { prepareCandidate, resolvePackageDirectory } from '../scripts/prepare-candidate.mjs';

test('resolves npm pack targets as local absolute package directories', () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'utoopack-candidate-'));
  const packageDirectory = path.join(source, 'packages', 'pack');

  try {
    fs.mkdirSync(packageDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(packageDirectory, 'package.json'),
      '{"name":"@utoo/pack"}\n',
    );

    assert.equal(
      resolvePackageDirectory(source, 'packages/pack'),
      packageDirectory,
    );
    assert.throws(
      () => resolvePackageDirectory(source, 'packages/missing'),
      /Not a package directory/,
    );
  } finally {
    fs.rmSync(source, { recursive: true, force: true });
  }
});

test('source preparation builds and includes the CLI in the candidate artifacts', async (context) => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'utoo-candidate-cli-'));
  context.after(() => fs.rmSync(source, { recursive: true, force: true }));
  const out = path.join(source, 'artifacts');
  for (const name of ['pack', 'pack-shared', 'pack-cli']) {
    const directory = path.join(source, 'packages', name);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: `@utoo/${name}` }));
  }
  const commands = [];
  const metadata = await prepareCandidate({ source, out }, async (command) => {
    commands.push(command);
    if (command[0] === 'git') return { stdout: 'candidate-sha\n' };
    if (command[1] === 'pack') {
      const name = path.basename(command.at(-1));
      const filename = `${name}.tgz`;
      const destination = command[command.indexOf('--pack-destination') + 1];
      fs.writeFileSync(path.join(destination, filename), name);
      return { stdout: JSON.stringify([{ filename }]) };
    }
    return { stdout: '' };
  });
  assert.deepEqual(commands.slice(0, 2), [
    ['npm', 'run', 'build:local', '--workspace', '@utoo/pack'],
    ['npm', 'run', 'build', '--workspace', '@utoo/pack-cli'],
  ]);
  assert.equal(metadata.commit, 'candidate-sha');
  assert.deepEqual(Object.keys(metadata.packages), ['@utoo/pack', '@utoo/pack-shared', '@utoo/pack-cli']);
  assert.equal(fs.readFileSync(path.join(out, 'utoo-pack-cli.tgz'), 'utf8'), 'pack-cli');
  assert.match(metadata.packages['@utoo/pack-cli'].sha256, /^[a-f0-9]{64}$/);
  assert.equal(fs.readdirSync(out).some((file) => file.startsWith('.pack-')), false);
});
