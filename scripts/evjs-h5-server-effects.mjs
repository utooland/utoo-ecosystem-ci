#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { startServer, stopServer, waitForServer } from './evjs-utoopack-dev-smoke.mjs';

const BUILD_FAILURE_PATTERN = /conflicting effects for the same key|Failed to process Utoopack server rebuild|Failed to start dev server/i;
const REBUILD_MARKER = '--ecosystem-rebuild-marker';

function verifySharedServerAssets(repoDir) {
  const serverDir = path.join(repoDir, 'examples', 'ecosystem-h5', 'dist', 'server');
  const stats = JSON.parse(fs.readFileSync(path.join(serverDir, 'stats.json'), 'utf8'));
  assert.deepEqual(Object.keys(stats.entrypoints).sort(), [
    'page-server-effects__first',
    'page-server-effects__second',
    'server',
  ]);
  const references = new Map();
  for (const entry of Object.values(stats.entrypoints)) {
    for (const asset of new Set(entry.assets.map(({ name }) => name))) {
      references.set(asset, (references.get(asset) ?? 0) + 1);
    }
  }
  const shared = [...references].filter(([asset, count]) => asset.endsWith('.js') && count > 1);
  assert.ok(shared.length > 0, 'SSR server entries must share JavaScript chunks');
  for (const [asset] of shared) {
    assert.ok(fs.existsSync(path.join(serverDir, `${asset}.map`)), `${asset} must emit a source map`);
  }
  const pageStyles = new Map();
  for (const [page, color, otherColor] of [
    ['first', '#00008b', '#006400'],
    ['second', '#006400', '#00008b'],
  ]) {
    const entry = stats.entrypoints[`page-server-effects__${page}`];
    const cssAssets = entry.assets.map(({ name }) => name).filter((asset) => asset.endsWith('.css'));
    assert.ok(cssAssets.length > 0, `${page} SSR entry must reference its CSS`);
    const css = cssAssets.map((asset) => {
      assert.ok(fs.existsSync(path.join(serverDir, `${asset}.map`)), `${asset} must emit a source map`);
      return fs.readFileSync(path.join(serverDir, asset), 'utf8');
    }).join('\n');
    assert.match(css, /padding:\s*24px/, `${page} must include the shared panel CSS`);
    assert.match(css, new RegExp(`color:\\s*${color}`), `${page} must include its page CSS`);
    assert.doesNotMatch(css, new RegExp(`color:\\s*${otherColor}`), `${page} must not include its sibling's CSS`);
    pageStyles.set(page, css);
  }
  return pageStyles;
}

async function waitForStyles(running, repoDir, changed) {
  await waitForServer(running, {
    failurePattern: BUILD_FAILURE_PATTERN,
    isReady: async (url) => {
      const styles = verifySharedServerAssets(repoDir);
      if (styles.get('first').includes(REBUILD_MARKER) !== changed) return false;
      assert.ok(!styles.get('second').includes(REBUILD_MARKER), 'A CSS rebuild must not leak into its sibling');
      await verifySsrPages(url, globalThis.fetch, changed ? 'first-rebuilt' : 'first');
      return true;
    },
  });
  console.log(`Verified SSR CSS rebuild: ${changed ? 'modified' : 'restored'}`);
}

export async function verifySsrPages(baseUrl, fetchImpl = globalThis.fetch, firstName = 'first') {
  for (const name of ['first', 'second']) {
    const expectedName = name === 'first' ? firstName : name;
    const url = new URL(`/effects/${name}.html`, baseUrl);
    const response = await fetchImpl(url, {
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(response.status, 200, `${url} must return HTTP 200`);
    const html = await response.text();
    assert.match(html, new RegExp(`${expectedName}: shared server content`));
    assert.match(html, /data-testid="render-origin">server</);
    assert.match(html, new RegExp(`data-testid="server-cookie">ecosystem=${expectedName}`));
    console.log(`Verified SSR HTML: ${url}`);
  }
}

export async function main(repoDir = process.cwd()) {
  const running = startServer(repoDir, 'ecosystem-h5');
  try {
    const url = await waitForServer(running, { failurePattern: BUILD_FAILURE_PATTERN });
    assert.match(running.getLog(), /ECOSYSTEM_SSR_ENTRIES_READY:3:sourceMaps=true/);
    verifySharedServerAssets(repoDir);
    await verifySsrPages(url);
    const cssPath = path.join(repoDir, 'examples', 'ecosystem-h5', 'src', 'pages', 'effects', 'first', 'page.css');
    const original = fs.readFileSync(cssPath, 'utf8');
    const pagePath = path.join(path.dirname(cssPath), 'page.tsx');
    const originalPage = fs.readFileSync(pagePath, 'utf8');
    assert.ok(originalPage.includes("name: 'first'"), 'The rebuild fixture must identify its first page');
    try {
      fs.writeFileSync(cssPath, `${original}\n.ssr-rebuild-probe { ${REBUILD_MARKER}: changed; }\n`);
      // The server endpoint watches JavaScript changes. Change rendered text
      // too so it republishes server assets after the CSS edit.
      fs.writeFileSync(pagePath, originalPage.replace("name: 'first'", "name: 'first-rebuilt'"));
      await waitForStyles(running, repoDir, true);
    } finally {
      fs.writeFileSync(cssPath, original);
      fs.writeFileSync(pagePath, originalPage);
      await waitForStyles(running, repoDir, false);
    }
    assert.doesNotMatch(running.getLog(), BUILD_FAILURE_PATTERN);
  } finally {
    await stopServer(running.server);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
