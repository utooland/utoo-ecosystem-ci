#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const CONFIG_START = 'export default defineConfig({';
const SCRIPT_SRC = /<script\b[^>]*\bsrc=(?:"([^"]+)"|'([^']+)')[^>]*>/g;

function examplePath(repoDir, ...parts) {
  return path.join(repoDir, 'examples', 'mpa', ...parts);
}

export function prepare(repoDir) {
  const configPath = examplePath(repoDir, 'ev.config.ts');
  const source = fs.readFileSync(configPath, 'utf8');
  assert.ok(source.includes(CONFIG_START), 'EVJS MPA config shape changed');
  assert.match(source, /routing:\s*\{\s*mode:\s*['"]mpa['"]\s*\}/);
  assert.doesNotMatch(source, /^\s*plugins\s*:/m);
  assert.doesNotMatch(source, /ecosystem-shared-runtime/);

  const plugin = `const sharedRuntimePlugin = definePlugin({
  id: "ecosystem-shared-runtime",
  setup() {
    return {
      configureBundler: utoopack((config) => {
        if (config.mode === "production") {
          config.optimization ??= {};
          config.optimization.sharedRuntime = true;
        }
      }),
    };
  },
});

`;
  const updated =
    `import { utoopack } from "@evjs/bundler-utoopack";\n` +
    `import { definePlugin } from "@evjs/ev/plugin";\n` +
    source.replace(
      CONFIG_START,
      `${plugin}${CONFIG_START}\n  plugins: [sharedRuntimePlugin()],`,
    );
  fs.writeFileSync(configPath, updated);
  console.log(`Enabled sharedRuntime in ${configPath}`);
}

function scriptAssetNames(html) {
  return [...html.matchAll(SCRIPT_SRC)].map((match) =>
    path.posix.basename(new URL(match[1] ?? match[2], 'https://example.test').pathname),
  );
}

function runtimeAsset(assets, pageId, publicDir) {
  // EVJS uses [contenthash:8].js for chunks, so the runtime has no name prefix.
  const last = assets.at(-1);
  assert.ok(last?.endsWith('.js'), `${pageId} must end with a runtime JS asset`);
  assert.notEqual(last, assets.at(-2), `${pageId} runtime must be its own asset`);
  const source = fs.readFileSync(path.join(publicDir, last), 'utf8');
  assert.ok(
    source.includes('registerChunk') && source.includes('loadChunkCached'),
    `${pageId} final JS must contain the Turbopack browser runtime`,
  );
  return last;
}

export function verify(repoDir) {
  const metadata = JSON.parse(
    fs.readFileSync(examplePath(repoDir, 'dist', 'deployment-metadata.json'), 'utf8'),
  );
  const publicDir = examplePath(repoDir, metadata.paths.publicDir);
  const runtimes = [];
  const entryAssets = [];

  for (const pageId of ['index', 'about']) {
    const document = metadata.documents.find(
      (item) => item.kind === 'page' && item.id === pageId,
    );
    assert.ok(document, `Missing ${pageId} MPA document`);
    const assets = document.assets.js;
    assert.ok(Array.isArray(assets) && assets.length > 1);
    runtimes.push(runtimeAsset(assets, pageId, publicDir));
    entryAssets.push(assets.slice(0, -1));

    const html = fs.readFileSync(path.join(publicDir, document.fileName), 'utf8');
    const expected = assets.map((asset) => path.posix.basename(asset));
    const actual = scriptAssetNames(html);
    assert.deepEqual(
      actual.slice(-expected.length),
      expected,
      `${pageId} HTML must load entry assets in metadata order`,
    );
  }

  assert.equal(runtimes[0], runtimes[1], 'MPA pages must share one runtime');
  assert.notDeepEqual(entryAssets[0], entryAssets[1], 'MPA entries must remain distinct');
  const runtimePath = path.join(publicDir, runtimes[0]);
  assert.ok(fs.statSync(runtimePath).size > 0, 'Shared runtime must be emitted');
  console.log(`Verified both EVJS MPA pages load ${runtimes[0]} last`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [action] = process.argv.slice(2);
  if (action === 'prepare') prepare(process.cwd());
  else if (action === 'verify') verify(process.cwd());
  else throw new Error('Usage: evjs-shared-runtime.mjs <prepare|verify>');
}
