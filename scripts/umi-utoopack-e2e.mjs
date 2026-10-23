#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { resolveCommand, runCommand } from '../src/process.mjs';
import { AFTER_MIDDLEWARE_CASES } from '../fixtures/umi-routing/plugin.js';

const SERVER_URL = 'http://127.0.0.1:9527/';
const READY_PATTERN = /utoo pack v.* ready/;
const EXPECTED_TEXTS = [
  'todos',
  'foo',
  'bar',
  'count',
  '123',
  'postcss-runtime',
];
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

function startServer(repoDir) {
  const [executable, ...args] = resolveCommand([
    'corepack',
    'pnpm',
    '--dir',
    'examples/with-use-model',
    'dev',
  ]);
  const server = spawn(executable, args, {
    cwd: repoDir,
    shell: false,
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      FORCE_UTOOPACK: '1',
      PORT: '9527',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

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
      throw new Error(
        `Umi dev server exited before it was ready.\n${getLog()}`,
      );
    }

    try {
      const response = await fetch(SERVER_URL);
      httpReady = response.ok;
    } catch {
      httpReady = false;
    }

    if (httpReady && READY_PATTERN.test(getLog())) return;
    await sleep(1_000);
  }

  throw new Error(
    `Timed out waiting for the utoopack dev server.\n${getLog()}`,
  );
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

async function stopServer(server) {
  if (!server.pid || server.exitCode !== null || server.signalCode !== null)
    return;

  if (process.platform === 'win32') {
    try {
      await runCommand(
        ['taskkill.exe', '/PID', String(server.pid), '/T', '/F'],
        {
          capture: true,
        },
      );
    } catch (error) {
      if (server.exitCode === null && server.signalCode === null) throw error;
    }
    return;
  }

  const exited = new Promise((resolve) => server.once('exit', resolve));
  process.kill(-server.pid, 'SIGTERM');
  await Promise.race([exited, sleep(5_000)]);
  if (server.exitCode === null && server.signalCode === null) {
    process.kill(-server.pid, 'SIGKILL');
  }
}

export async function main(repoDir = process.cwd()) {
  const routingFixture = prepareRoutingFixture(repoDir);
  try {
    const runningServer = startServer(repoDir);
    try {
      await waitForServer(runningServer);
      await assertBrowserRuntime(repoDir, routingFixture);
    } finally {
      await stopServer(runningServer.server);
    }
  } finally {
    routingFixture.restore();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
