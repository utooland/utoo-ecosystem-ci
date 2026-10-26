#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { runCommand } from '../src/process.mjs';
import { AFTER_MIDDLEWARE_CASES } from '../fixtures/umi-routing/plugin.js';

const SERVER_URL = 'http://127.0.0.1:9527/';
const READY_PATTERN = /utoo pack v.* ready/;
const EXPECTED_TEXTS = ['todos', 'foo', 'bar', 'count', '123', 'postcss-runtime'];
const MAX_LOG_LENGTH = 200_000;
export const NESTED_ROUTE = '/ecosystem-regression/nested';
export const NESTED_TEXT = 'umi-nested-routing-regression';
export const FALLBACK_SHELL =
  '<!doctype html><title>unexpected-pack-fallback-shell</title>';
const ROUTING_OUTPUT = '.ecosystem-routing-dist';

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

export function prepareRoutingFixture(
  repoDir,
  examplePath = 'examples/with-use-model',
) {
  const exampleDir = path.join(repoDir, examplePath);
  const configPath = path.join(exampleDir, '.umirc.ts');
  const pluginPath = path.join(exampleDir, '.ecosystem-routing-plugin.ts');
  const pagePath = path.join(
    exampleDir,
    'pages',
    `${NESTED_ROUTE.slice(1)}.tsx`,
  );
  const outputPath = path.join(exampleDir, ROUTING_OUTPUT);
  const files = new Map(
    [configPath, pluginPath, pagePath].map((file) => [
      file,
      fs.existsSync(file) ? fs.readFileSync(file) : undefined,
    ]),
  );
  if (fs.existsSync(outputPath)) {
    throw new Error(
      `Refusing to replace existing routing fixture output: ${outputPath}`,
    );
  }
  const pageDirectoryExisted = fs.existsSync(path.dirname(pagePath));
  const restore = () => {
    for (const [file, contents] of files) {
      if (contents === undefined) fs.rmSync(file, { force: true });
      else fs.writeFileSync(file, contents);
    }
    if (!pageDirectoryExisted && fs.existsSync(path.dirname(pagePath))) {
      fs.rmdirSync(path.dirname(pagePath));
    }
    fs.rmSync(outputPath, { recursive: true, force: true });
  };

  try {
    enableUtoopack(configPath);
    const config = fs.readFileSync(configPath, 'utf8');
    const wrapped = config.replace(
      /export\s+default\s+/,
      'const ecosystemOriginalConfig = ',
    );
    if (wrapped === config)
      throw new Error(`Could not wrap Umi config: ${configPath}`);
    fs.writeFileSync(
      configPath,
      `${wrapped}\nexport default {\n  ...ecosystemOriginalConfig,\n  outputPath: '${ROUTING_OUTPUT}',\n  plugins: [...(ecosystemOriginalConfig.plugins || []), './.ecosystem-routing-plugin.ts'],\n};\n`,
    );
    fs.copyFileSync(
      new URL('../fixtures/umi-routing/plugin.js', import.meta.url),
      pluginPath,
    );
    fs.mkdirSync(path.dirname(pagePath), { recursive: true });
    fs.copyFileSync(
      new URL('../fixtures/umi-routing/nested.tsx', import.meta.url),
      pagePath,
    );
    return { exampleDir, outputPath, restore };
  } catch (error) {
    restore();
    throw error;
  }
}

export async function assertAfterMiddlewares(
  baseUrl,
  fetchImpl = globalThis.fetch,
) {
  for (const expected of AFTER_MIDDLEWARE_CASES) {
    const response = await fetchImpl(new URL(expected.pathname, baseUrl), {
      headers: { accept: '*/*' },
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(
      response.status,
      expected.status,
      `${expected.pathname} must reach Umi's after middleware`,
    );
    assert.match(
      response.headers.get('content-type') || '',
      /application\/json/i,
    );
    assert.deepEqual(await response.json(), expected.body);
  }
}

function startServer(repoDir, plugin, markers) {
  // Control the actual parent CLI, rather than a package-manager wrapper.
  const server = spawn(
    process.execPath,
    [path.join(repoDir, 'packages/umi/bin/umi.js'), 'dev'],
    {
      cwd: path.join(repoDir, 'examples/with-use-model'),
      shell: false,
      detached: process.platform !== 'win32',
      env: {
        ...process.env,
        FORCE_UTOOPACK: '1',
        PORT: '9527',
        STRICT_PORT: '9527',
        UMI_PLUGINS: [process.env.UMI_PLUGINS, plugin]
          .filter(Boolean)
          .join(','),
        UMI_SHUTDOWN_MARKERS: markers,
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
    markers,
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
      const response = await fetch(SERVER_URL);
      httpReady = response.ok;
      await response.body?.cancel();
    } catch {
      httpReady = false;
    }

    if (httpReady && READY_PATTERN.test(getLog())) return;
    await sleep(1_000);
  }

  throw new Error(`Timed out waiting for the utoopack dev server.\n${getLog()}`);
}

async function assertBrowserRuntime(repoDir, routingFixture) {
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

    await page.goto(SERVER_URL, { waitUntil: 'domcontentloaded' });
    const started = Date.now();
    let body = '';

    while (Date.now() - started < 60_000) {
      body = await page
        .locator('body')
        .innerText()
        .catch(() => '');
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
            `Expected utoopack PostCSS marker color rgb(1, 2, 3), got ${
              markerColor || '(empty)'
            }`,
          );
        }
        break;
      }

      if (body.includes('Bundling...')) {
        await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
      }
      await page.waitForTimeout(1_000);
    }

    assert.ok(
      EXPECTED_TEXTS.every((expected) => body.includes(expected)),
      `Timed out waiting for page text.\nExpected: ${EXPECTED_TEXTS.join(
        ', ',
      )}\nLast body:\n${body}`,
    );

    // Umi normally renders HTML in its outer server. A real index.html must
    // exist in the internal output to make accidental SPA fallback observable.
    fs.mkdirSync(routingFixture.outputPath, { recursive: true });
    fs.writeFileSync(
      path.join(routingFixture.outputPath, 'index.html'),
      FALLBACK_SHELL,
    );
    const shell = await fetch(SERVER_URL, {
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(shell.status, 200);
    assert.equal(
      await shell.text(),
      FALLBACK_SHELL,
      'The fallback sentinel must be served from Utoopack output',
    );

    await assertAfterMiddlewares(SERVER_URL);
    const nestedUrl = new URL(NESTED_ROUTE, SERVER_URL).href;
    const direct = await page.goto(nestedUrl, {
      waitUntil: 'domcontentloaded',
    });
    assert.equal(direct.status(), 200);
    await page.getByText(NESTED_TEXT, { exact: true }).waitFor();
    const refreshed = await page.reload({ waitUntil: 'domcontentloaded' });
    assert.equal(refreshed.status(), 200);
    await page.getByText(NESTED_TEXT, { exact: true }).waitFor();
    assert.deepEqual(
      errors,
      [],
      `Browser runtime errors:\n${errors.join('\n')}`,
    );
    console.log(
      'PASS Umi routing: after-middlewares, nested navigation and refresh',
    );
  } finally {
    await browser.close();
  }
}

function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

function portIsFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
}

async function assertShutdown({ server, markers, getLog }, signal) {
  const worker = Number(fs.readFileSync(path.join(markers, 'worker'), 'utf8'));
  const innerPort = Number(fs.readFileSync(path.join(markers, 'port'), 'utf8'));
  const expectedSignal = signal === 'SIGINT' ? 'SIGINT' : 'SIGTERM';
  // On Windows, libuv's Job Object kills non-detached workers with their parent.
  // A forced stop cannot guarantee that the worker runs JavaScript cleanup hooks.
  const requiredCleanupMarkers =
    process.platform === 'win32' && signal === 'SIGKILL'
      ? []
      : ['close', 'onExit', expectedSignal];
  // Target only the parent PID; let IPC disconnect or the Windows Job stop its worker.
  server.kill(signal);
  const started = Date.now();
  while (Date.now() - started < 10_000) {
    if (
      !isAlive(worker) &&
      !isAlive(server.pid) &&
      requiredCleanupMarkers.every((name) =>
        fs.existsSync(path.join(markers, name)),
      ) &&
      (await Promise.all([9527, innerPort].map(portIsFree))).every(Boolean)
    ) {
      if (signal === 'SIGINT' && server.exitCode !== 0) {
        throw new Error(
          `Umi graceful stop failed with exit code ${
            server.exitCode
          }.\n${getLog()}`,
        );
      }
      console.log(
        `Verified Umi ${signal}: worker exited${
          requiredCleanupMarkers.length > 0 ? ', async cleanup completed' : ''
        }, both ports released.`,
      );
      return;
    }
    await sleep(100);
  }
  const state = {
    worker: { pid: worker, alive: isAlive(worker) },
    parent: {
      pid: server.pid,
      alive: isAlive(server.pid),
      exitCode: server.exitCode,
      signalCode: server.signalCode,
    },
    requiredCleanupMarkers,
    markers: fs.readdirSync(markers),
    ports: await Promise.all([9527, innerPort].map(async (port) => ({
      port,
      free: await portIsFree(port),
    }))),
  };
  throw new Error(
    `Umi ${signal} left a worker, unfinished cleanup, or an occupied port.\n${JSON.stringify(state, null, 2)}\n${getLog()}`,
  );
}

async function stopServer({ server, markers }) {
  const workerPath = path.join(markers, 'worker');
  const worker = fs.existsSync(workerPath)
    ? Number(fs.readFileSync(workerPath, 'utf8'))
    : undefined;
  if (!server.pid) return;

  if (process.platform === 'win32') {
    for (const pid of [worker, server.pid]) {
      if (!isAlive(pid)) continue;
      try {
        await runCommand(['taskkill.exe', '/PID', String(pid), '/T', '/F'], {
          capture: true,
        });
      } catch (error) {
        if (isAlive(pid)) throw error;
      }
    }
    return;
  }

  // This is failure cleanup, after all lifecycle assertions have run.
  try {
    process.kill(-server.pid, 'SIGKILL');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

export async function main(repoDir = process.cwd()) {
  repoDir = path.resolve(repoDir);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'umi-shutdown-'));
  try {
    const routingFixture = prepareRoutingFixture(repoDir);
    try {
      const plugin = path.join(directory, 'plugin.cjs');
      fs.writeFileSync(
        plugin,
        `
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const mark = (name, value = 'done') => fs.writeFileSync(path.join(process.env.UMI_SHUTDOWN_MARKERS, name), String(value));
const delay = () => new Promise(resolve => setTimeout(resolve, 200));
module.exports = api => {
  mark('worker', process.pid);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, async () => { await delay(); mark(signal); });
  }
  api.register({ key: 'onExit', async fn() { await delay(); mark('onExit'); } });
  const pack = createRequire(${JSON.stringify(
    path.join(repoDir, 'packages/bundler-utoopack/package.json'),
  )})('@utoo/pack');
  const serve = pack.serve;
  Object.defineProperty(pack, 'serve', { value: async (config, cwd, root, options) => {
    const handle = await serve(config, cwd, root, {
      ...options,
      onReady(context) { mark('port', context.port); options.onReady?.(context); },
    });
    const close = handle.close.bind(handle);
    handle.close = async () => { await close(); await delay(); mark('close'); };
    return handle;
  }});
};
`,
      );
      const signals =
        process.platform === 'win32' ? ['SIGKILL'] : ['SIGINT', 'SIGKILL'];
      for (const [index, signal] of signals.entries()) {
        const markers = path.join(directory, signal);
        fs.mkdirSync(markers);
        const runningServer = startServer(repoDir, plugin, markers);
        try {
          await waitForServer(runningServer);
          if (index === 0) await assertBrowserRuntime(repoDir, routingFixture);
          await assertShutdown(runningServer, signal);
        } finally {
          await stopServer(runningServer);
        }
      }
    } finally {
      routingFixture.restore();
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
