#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { startServer, stopServer } from './utoopack-dev-server-smoke.mjs';

const ROUTE = '/home/settings?tab=profile';
const SHELL = 'ecosystem-cli-shell';
const RENDERED = `CLI route: ${ROUTE}`;
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function prepareFixture(directory) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'package.json'), '{"private":true}\n');
  fs.writeFileSync(
    path.join(directory, 'index.html'),
    `<!doctype html><html><head><title>${SHELL}</title></head><body><div id="app"></div></body></html>`,
  );
  fs.writeFileSync(
    path.join(directory, 'index.js'),
    'document.getElementById("app").textContent = "CLI route: " + location.pathname + location.search;\n',
  );
  fs.writeFileSync(path.join(directory, 'utoopack.json'), JSON.stringify({
    entry: [{ import: './index.js', name: 'main', html: { template: './index.html' } }],
    output: { path: './dist', filename: '[name].js', publicPath: '/', clean: true },
    persistentCaching: false,
  }, null, 2));
}

export function resolveCli(repoDir) {
  const consumerRequire = createRequire(path.join(repoDir, 'package.json'));
  const manifest = consumerRequire.resolve('@utoo/pack-cli/package.json');
  const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.up;
  assert.ok(bin, '@utoo/pack-cli must expose the up binary');
  const cliRequire = createRequire(manifest);
  assert.equal(
    fs.realpathSync(cliRequire.resolve('@utoo/pack/package.json')),
    fs.realpathSync(consumerRequire.resolve('@utoo/pack/package.json')),
    'The CLI must load the same @utoo/pack candidate as the consumer',
  );
  return path.resolve(path.dirname(manifest), bin);
}

async function waitForCli(runningServer, timeout = 120_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const { server, getLog, getSpawnError } = runningServer;
    if (getSpawnError()) throw getSpawnError();
    if (server.exitCode !== null || server.signalCode !== null) {
      throw new Error(`CLI exited before it was ready.\n${getLog()}`);
    }
    const log = getLog().replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
    const url = log.match(/Local:\s+(http:\/\/localhost:\d+)/)?.[1];
    if (url) {
      const response = await fetch(`${url}/`, { signal: AbortSignal.timeout(5_000) });
      assert.equal(response.status, 200, 'CLI must serve the existing index.html');
      assert.match(await response.text(), new RegExp(SHELL));
      return url;
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for CLI server URL.\n${runningServer.getLog()}`);
}

export async function getMissingRouteStatus(url) {
  const response = await fetch(`${url}/ecosystem-missing-route`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  assert.ok(
    [404, 405].includes(response.status),
    `Non-HTML missing-route baseline must return 404 or 405, received ${response.status}`,
  );
  assert.doesNotMatch(await response.text(), new RegExp(SHELL));
  return response.status;
}

export async function assertRouteResponse(url, enabled, missingStatus) {
  const response = await fetch(`${url}${ROUTE}`, {
    headers: { accept: 'text/html' },
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.text();
  assert.equal(response.status, enabled ? 200 : missingStatus, `CLI fallback enabled=${enabled}`);
  if (enabled) {
    assert.match(response.headers.get('content-type') ?? '', /text\/html/);
    assert.match(body, new RegExp(SHELL));
  } else {
    assert.doesNotMatch(body, new RegExp(SHELL));
  }
}

export async function assertMissingAssets(url, missingStatus) {
  for (const missing of ['/missing.js', '/missing.css']) {
    const response = await fetch(`${url}${missing}`, { signal: AbortSignal.timeout(10_000) });
    assert.equal(response.status, missingStatus, 'Missing assets must keep their error response');
    assert.doesNotMatch(await response.text(), new RegExp(SHELL));
  }
}

export async function main(repoDir = process.cwd()) {
  const consumerRequire = createRequire(path.join(repoDir, 'package.json'));
  const { chromium } = consumerRequire('playwright-chromium');
  const cli = resolveCli(repoDir);
  const browser = await chromium.launch();
  try {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'utoo-cli-history-'));
    try {
      for (const enabled of [true, false]) {
        prepareFixture(fixture);
        const runningServer = startServer(fixture, {
          cwd: '.',
          command: [
            process.execPath, cli, 'dev', '--project', fixture, '--root', fixture,
            ...(enabled ? [] : ['--no-history-api-fallback']),
          ],
        });
        try {
          const url = await waitForCli(runningServer);
          assert.ok(fs.existsSync(path.join(fixture, 'dist/index.html')));
          const missingStatus = await getMissingRouteStatus(url);
          await assertRouteResponse(url, enabled, missingStatus);
          if (enabled) {
            const page = await browser.newPage();
            try {
              await page.goto(`${url}${ROUTE}`, { waitUntil: 'domcontentloaded' });
              await page.waitForFunction((text) => document.getElementById('app')?.textContent === text, RENDERED);
              await page.reload({ waitUntil: 'domcontentloaded' });
              await page.waitForFunction((text) => document.getElementById('app')?.textContent === text, RENDERED);
            } finally {
              await page.close();
            }
          }
          await assertMissingAssets(url, missingStatus);
          console.log(`PASS CLI history fallback ${enabled ? 'default' : 'disabled'}`);
        } finally {
          await stopServer(runningServer.server);
        }
      }
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
