import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolvePackageDirectory } from '../scripts/prepare-candidate.mjs';

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
