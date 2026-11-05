import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { prepareHmrFixture } from '../scripts/umi-contenthash-hmr.mjs';

function createConsumer(context) {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'umi-contenthash-hmr-'));
  context.after(() => fs.rmSync(repoDir, { recursive: true, force: true }));
  const exampleDir = path.join(repoDir, 'examples/with-use-model');
  fs.mkdirSync(exampleDir, { recursive: true });
  const originalConfig = 'export default { model: {} };\n';
  const originalManifest = '{"private":true,"name":"existing-example"}\n';
  fs.writeFileSync(path.join(exampleDir, '.umirc.ts'), originalConfig);
  fs.writeFileSync(path.join(exampleDir, 'package.json'), originalManifest);
  return { repoDir, exampleDir, originalConfig, originalManifest };
}

test('HMR fixture isolates edited sources and restores the consumer unchanged', (context) => {
  const { repoDir, exampleDir, originalConfig, originalManifest } =
    createConsumer(context);
  const fixture = prepareHmrFixture(repoDir);
  context.after(() => fixture.restore());
  assert.equal(
    fixture.directory,
    path.join(exampleDir, '.ecosystem-contenthash-hmr'),
  );
  for (const file of [
    fixture.configPath,
    fixture.pagePath,
    fixture.dynamicPath,
    fixture.cssPath,
    fixture.businessPath,
  ]) {
    assert.ok(fs.existsSync(file), `Missing fixture source: ${file}`);
    assert.equal(path.relative(fixture.directory, file).startsWith('..'), false);
  }
  fs.writeFileSync(fixture.pagePath, 'an interrupted test edit');
  fs.mkdirSync(path.join(fixture.directory, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(fixture.directory, 'dist/generated.js'), 'output');

  fixture.restore();
  fixture.restore();

  assert.equal(fs.existsSync(fixture.directory), false);
  assert.equal(
    fs.readFileSync(path.join(exampleDir, '.umirc.ts'), 'utf8'),
    originalConfig,
  );
  assert.equal(
    fs.readFileSync(path.join(exampleDir, 'package.json'), 'utf8'),
    originalManifest,
  );
});

test('HMR fixture refuses an existing directory and preserves its contents', (context) => {
  const { repoDir, exampleDir } = createConsumer(context);
  const existing = path.join(exampleDir, '.ecosystem-contenthash-hmr');
  fs.mkdirSync(existing);
  const marker = path.join(existing, 'keep.txt');
  fs.writeFileSync(marker, 'existing user files');

  assert.throws(() => prepareHmrFixture(repoDir), /existing|replace|overwrite/i);

  assert.equal(fs.readFileSync(marker, 'utf8'), 'existing user files');
});
