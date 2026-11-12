import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { prepare, verify } from '../scripts/father-inline-css.mjs';

test('Father check rejects missing minified output and verifies inline CSS runtime', (t) => {
  const checkout = fs.mkdtempSync(path.join(os.tmpdir(), 'father-inline-css-'));
  t.after(() => fs.rmSync(checkout, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(checkout, 'package.json'),
    JSON.stringify({ name: 'father' }),
  );
  const example = prepare(checkout);
  const output = path.join(example, 'dist', 'umd');
  fs.mkdirSync(output, { recursive: true });
  const bundle = `
globalThis.FatherInlineCssRegression = { greeting: name => 'Hello, ' + name + '!' };
const style = document.createElement('style');
style.styleSheet.cssText = '.father-inline-css-regression { color: red; }';
document.querySelector('head').appendChild(style);
`;
  fs.writeFileSync(path.join(output, 'index.js'), bundle);
  assert.throws(() => verify(example), /Missing Father UMD output: index.min.js/);
  fs.writeFileSync(path.join(output, 'index.min.js'), bundle);
  verify(example);

  fs.writeFileSync(
    path.join(output, 'index.min.js'),
    'globalThis.FatherInlineCssRegression = { greeting: () => "broken" };',
  );
  assert.throws(() => verify(example), /must export a working UMD library/);
  fs.writeFileSync(
    path.join(output, 'index.min.js'),
    bundle.replace('color: red', 'color: blue'),
  );
  assert.throws(() => verify(example), /did not match/);
  fs.writeFileSync(
    path.join(output, 'index.min.js'),
    `${bundle}\n/*# sourceMappingURL=data:application/json;base64,e30= */`,
  );
  assert.throws(() => verify(example), /was expected to not match/);
  fs.writeFileSync(path.join(output, 'index.min.js'), bundle);
  fs.writeFileSync(path.join(output, 'index.min.js.map'), '{}');
  assert.throws(() => verify(example), /Source maps are disabled/);

  prepare(checkout);
  assert.ok(!fs.existsSync(output), 'Preparation must remove stale generated output');

  const manifest = path.join(example, 'package.json');
  fs.writeFileSync(manifest, JSON.stringify({ name: 'unrelated-example' }));
  assert.throws(() => prepare(checkout), /Refusing to replace an unrelated example/);
  assert.equal(JSON.parse(fs.readFileSync(manifest, 'utf8')).name, 'unrelated-example');
});
