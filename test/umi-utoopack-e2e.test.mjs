import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { enableUtoopack, startServer } from '../scripts/umi-utoopack-e2e.mjs';

test('enableUtoopack adds the native Umi utoopack config once', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'umi-utoopack-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, '.umirc.ts');
  fs.writeFileSync(configPath, 'export default {\n  model: {},\n};\n');

  enableUtoopack(configPath);
  enableUtoopack(configPath);

  assert.equal(
    fs.readFileSync(configPath, 'utf8'),
    'export default {\n  model: {},\n  utoopack: {},\n};\n',
  );
});

test('Umi dev starts through Windows Corepack Node CLI and preserves its environment', () => {
  const entryPoint = 'C:\\node\\node_modules\\corepack\\dist\\corepack.js';
  const server = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });
  const invocations = [];
  const running = startServer('D:\\consumer with spaces', {
    platform: 'win32',
    execPath: 'C:\\node\\node.exe',
    existsSync: (filename) => filename === entryPoint,
    spawnImpl: (...args) => {
      invocations.push(args);
      return server;
    },
  });
  const [invocation] = invocations;
  assert.equal(running.server, server);
  assert.deepEqual(invocation[1], [
    entryPoint,
    'pnpm',
    '--dir',
    'examples/with-use-model',
    'dev',
  ]);
  assert.equal(invocation[2].cwd, 'D:\\consumer with spaces');
  assert.equal(invocation[2].detached, false);
  assert.equal(invocation[2].shell, false);
  assert.equal(invocation[2].env.FORCE_UTOOPACK, '1');
  assert.equal(invocation[2].env.PORT, '9527');
});
