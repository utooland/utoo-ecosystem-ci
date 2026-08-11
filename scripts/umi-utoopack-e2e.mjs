#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const URL = 'http://127.0.0.1:9527/';
const READY_PATTERN = /utoo pack v.* ready/;
const EXPECTED_TEXTS = ['todos', 'foo', 'bar', 'count', '123', 'postcss-runtime'];
const MAX_LOG_LENGTH = 200_000;

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export function enableUtoopack(configPath) {
  const config = fs.readFileSync(configPath, 'utf8');
  if (config.includes('utoopack')) return;

  const updated = config.replace(/\n};\s*$/, '\n  utoopack: {},\n};\n');
  if (updated === config) {
    throw new Error(`Could not enable utoopack in ${configPath}`);
  }
  fs.writeFileSync(configPath, updated);
}

function startServer(repoDir) {
  const server = spawn(
    'corepack',
    ['pnpm', '--dir', 'examples/with-use-model', 'dev'],
    {
      cwd: repoDir,
      detached: process.platform !== 'win32',
      env: {
        ...process.env,
        FORCE_UTOOPACK: '1',
        PORT: '9527',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  let log = '';
  const state = { spawnError: null };
  const capture = (chunk, destination) => {
    destination.write(chunk);
    log = `${log}${chunk}`.slice(-MAX_LOG_LENGTH);
  };
  server.stdout.on('data', (chunk) => capture(chunk, process.stdout));
  server.stderr.on('data', (chunk) => capture(chunk, process.stderr));
  server.on('error', (error) => {
    state.spawnError = error;
  });

  return {
    server,
    getLog: () => log,
    getSpawnError: () => state.spawnError,
  };
}

async function waitForServer({ server, getLog, getSpawnError }) {
  const started = Date.now();
  const timeout = 120_000;
  let httpReady = false;

  while (Date.now() - started < timeout) {
    const spawnError = getSpawnError();
    if (spawnError) throw spawnError;
    if (server.exitCode !== null || server.signalCode !== null) {
      throw new Error(`Umi dev server exited before it was ready.\n${getLog()}`);
    }

    try {
      const response = await fetch(URL);
      httpReady = response.ok;
    } catch {
      httpReady = false;
    }

    if (httpReady && READY_PATTERN.test(getLog())) return;
    await sleep(1_000);
  }

  throw new Error(`Timed out waiting for the utoopack dev server.\n${getLog()}`);
}

async function assertBrowserRuntime(repoDir) {
  const requireFromConsumer = createRequire(path.join(repoDir, 'package.json'));
  const { chromium } = requireFromConsumer('playwright-chromium');
  const browser = await chromium.launch();

  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.stack || error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });

    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    const started = Date.now();
    let body = '';

    while (Date.now() - started < 60_000) {
      body = await page.locator('body').innerText().catch(() => '');
      if (errors.length > 0) {
        throw new Error(
          `Browser runtime errors:\n${errors.join('\n')}\n\nBody:\n${body}`,
        );
      }

      if (EXPECTED_TEXTS.every((expected) => body.includes(expected))) {
        const markerColor = await page
          .locator('.utoopack-postcss-runtime')
          .evaluate((element) => getComputedStyle(element).color)
          .catch(() => '');
        if (markerColor !== 'rgb(1, 2, 3)') {
          throw new Error(
            `Expected utoopack PostCSS marker color rgb(1, 2, 3), got ${markerColor || '(empty)'}`,
          );
        }
        return;
      }

      if (body.includes('Bundling...')) {
        await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
      }
      await page.waitForTimeout(1_000);
    }

    throw new Error(
      `Timed out waiting for page text.\nExpected: ${EXPECTED_TEXTS.join(', ')}\nLast body:\n${body}`,
    );
  } finally {
    await browser.close();
  }
}

async function stopServer(server) {
  if (server.exitCode !== null || server.signalCode !== null) return;

  const exited = new Promise((resolve) => server.once('exit', resolve));
  if (process.platform === 'win32') {
    server.kill('SIGTERM');
  } else {
    process.kill(-server.pid, 'SIGTERM');
  }

  await Promise.race([exited, sleep(5_000)]);
  if (server.exitCode === null && server.signalCode === null) {
    if (process.platform === 'win32') {
      server.kill('SIGKILL');
    } else {
      process.kill(-server.pid, 'SIGKILL');
    }
  }
}

export async function main(repoDir = process.cwd()) {
  enableUtoopack(path.join(repoDir, 'examples/with-use-model/.umirc.ts'));
  const runningServer = startServer(repoDir);

  try {
    await waitForServer(runningServer);
    await assertBrowserRuntime(repoDir);
  } finally {
    await stopServer(runningServer.server);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
