import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(
  new URL('../scripts/prepare-dumi-example.mjs', import.meta.url),
);

test('prepares the minimal Dumi site fixture in a consumer checkout', (t) => {
  const checkout = fs.mkdtempSync(
    path.join(os.tmpdir(), 'utoopack-ecosystem-dumi-'),
  );
  t.after(() => fs.rmSync(checkout, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(checkout, 'package.json'),
    JSON.stringify({ name: 'dumi' }),
  );

  const result = spawnSync(process.execPath, [script], {
    cwd: checkout,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);

  const example = path.join(checkout, 'examples', 'utoopack-ecosystem-ci');
  assert.match(
    fs.readFileSync(path.join(example, '.dumirc.ts'), 'utf8'),
    /utoopack:\s*\{\}/,
  );
  assert.match(
    fs.readFileSync(path.join(example, 'docs', 'index.md'), 'utf8'),
    /Utoopack Ecosystem CI/,
  );
});
