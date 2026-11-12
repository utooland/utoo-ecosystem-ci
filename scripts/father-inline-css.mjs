#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { runCommand } from '../src/process.mjs';

const fixture = fileURLToPath(
  new URL('../fixtures/father-inline-css', import.meta.url),
);

export function prepare(repoDir) {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoDir, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'father', 'Expected a Father source checkout');
  const destination = path.join(repoDir, 'examples', 'ecosystem-inline-css');
  if (fs.existsSync(destination)) {
    const existing = JSON.parse(
      fs.readFileSync(path.join(destination, 'package.json'), 'utf8'),
    );
    assert.equal(existing.name, 'father-inline-css-regression', 'Refusing to replace an unrelated example');
  }
  // A fresh directory is essential: a successful unminified build must not
  // hide a minified build that reports success without emitting its asset.
  fs.rmSync(destination, { recursive: true, force: true });
  fs.cpSync(fixture, destination, { recursive: true });
  return destination;
}

function verifyRuntime(source, filename) {
  const styles = [];
  const head = {
    appendChild(element) {
      styles.push(element);
      return element;
    },
  };
  const context = {
    URL,
    console,
    window: {},
    document: {
      querySelector(selector) {
        assert.equal(selector, 'head');
        return head;
      },
      createElement(tag) {
        assert.equal(tag, 'style', 'Inline CSS must create a style element');
        return {
          styleSheet: { cssText: '' },
          setAttribute() {},
          removeAttribute() {},
        };
      },
    },
  };
  vm.runInNewContext(source, context, { filename, timeout: 5000 });
  assert.equal(
    context.FatherInlineCssRegression?.greeting('ecosystem'),
    'Hello, ecosystem!',
    `${filename} must export a working UMD library`,
  );
  const css = styles.map((style) => style.styleSheet.cssText).join('\n');
  assert.match(css, /\.father-inline-css-regression\s*\{[^}]*color:\s*red/);
}

export function verify(exampleDir) {
  const output = path.join(exampleDir, 'dist', 'umd');
  for (const filename of ['index.js', 'index.min.js']) {
    const file = path.join(output, filename);
    assert.ok(fs.existsSync(file), `Missing Father UMD output: ${filename}`);
    const source = fs.readFileSync(file, 'utf8');
    assert.ok(source.length > 0, `Empty Father UMD output: ${filename}`);
    assert.doesNotMatch(source, /^\s*\/[/*][#@]\s*sourceMappingURL=/m);
    verifyRuntime(source, filename);
  }
  const files = fs.readdirSync(output, { recursive: true });
  assert.ok(
    !files.some((file) => file.endsWith('.map')),
    'Source maps are disabled',
  );
  assert.ok(!files.some((file) => file.endsWith('.css')), 'CSS must remain inline');
  console.log('Verified Father UMD inline CSS with minification and source maps disabled');
}

export async function run(repoDir) {
  const exampleDir = prepare(repoDir);
  await runCommand([process.execPath, path.join(repoDir, 'bin', 'father.js'), 'build'], {
    cwd: exampleDir,
  });
  verify(exampleDir);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run(process.cwd());
}
