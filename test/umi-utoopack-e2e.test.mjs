import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { enableUtoopack } from '../scripts/umi-utoopack-e2e.mjs';

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
