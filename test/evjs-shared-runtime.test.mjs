import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { prepare, verify } from '../scripts/evjs-shared-runtime.mjs';

test('EVJS MPA shared runtime check accepts a hashed runtime loaded last', (t) => {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evjs-shared-runtime-'));
  t.after(() => fs.rmSync(repoDir, { recursive: true, force: true }));
  const exampleDir = path.join(repoDir, 'examples', 'mpa');
  const publicDir = path.join(exampleDir, 'dist', 'client');
  fs.mkdirSync(publicDir, { recursive: true });

  const configPath = path.join(exampleDir, 'ev.config.ts');
  fs.writeFileSync(
    configPath,
    'import { defineConfig } from "@evjs/ev";\nexport default defineConfig({\n  routing: { mode: "mpa" },\n});\n',
  );
  prepare(repoDir);
  assert.match(fs.readFileSync(configPath, 'utf8'), /sharedRuntime = true/);

  const runtime = 'a1b2c3d4.js';
  const documents = ['index', 'about'].map((id) => ({
    kind: 'page',
    id,
    fileName: `${id}.html`,
    assets: { js: [`${id}.js`, 'common.js', runtime] },
  }));
  fs.writeFileSync(
    path.join(exampleDir, 'dist', 'deployment-metadata.json'),
    JSON.stringify({ paths: { publicDir: 'dist/client' }, documents }),
  );
  fs.writeFileSync(path.join(publicDir, runtime), 'runtime');
  for (const document of documents) {
    fs.writeFileSync(
      path.join(publicDir, document.fileName),
      document.assets.js
        .map((asset) => `<script defer src="/${asset}"></script>`)
        .join(''),
    );
  }
  verify(repoDir);

  fs.writeFileSync(
    path.join(publicDir, 'about.html'),
    `<script src="/${runtime}"></script><script src="/about.js"></script><script src="/common.js"></script>`,
  );
  assert.throws(() => verify(repoDir), /about HTML must load entry assets/);
});
