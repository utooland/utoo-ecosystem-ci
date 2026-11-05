#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  startServer,
  stopServer,
  waitForServer,
} from './utoopack-dev-server-smoke.mjs';

const FIXTURE_NAME = '.ecosystem-contenthash-hmr';
const TEMPLATE_DIRECTORY = fileURLToPath(
  new URL('../fixtures/umi-contenthash-hmr/', import.meta.url),
);
const TEMPLATE_FILES = [
  '.umirc.ts',
  'src/pages/index.tsx',
  'src/pages/index.css',
  'src/components/Dynamic.tsx',
  'src/app.ts',
  'src/business.ts',
];
const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export function prepareHmrFixture(
  repoDir,
  examplePath = 'examples/with-use-model',
) {
  repoDir = path.resolve(repoDir);
  const exampleDir = path.resolve(repoDir, examplePath);
  if (
    exampleDir !== repoDir &&
    !exampleDir.startsWith(`${repoDir}${path.sep}`)
  ) {
    throw new Error('The HMR fixture must be inside the consumer checkout');
  }
  const directory = path.join(exampleDir, FIXTURE_NAME);
  if (fs.existsSync(directory)) {
    throw new Error(`Refusing to overwrite existing HMR fixture: ${directory}`);
  }
  const sources = new Map(
    TEMPLATE_FILES.map((file) => [
      file,
      fs.readFileSync(path.join(TEMPLATE_DIRECTORY, file), 'utf8'),
    ]),
  );
  const manifestPath = path.join(exampleDir, 'package.json');
  const manifest = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    : {};
  const dependencies = Object.fromEntries(
    ['umi', 'react', 'react-dom'].map((name) => [
      name,
      manifest.dependencies?.[name] || manifest.devDependencies?.[name] || '*',
    ]),
  );
  sources.set(
    'package.json',
    `${JSON.stringify(
      {
        name: 'ecosystem-umi-contenthash-hmr',
        private: true,
        dependencies,
      },
      null,
      2,
    )}\n`,
  );
  let restored = false;
  const reset = () => {
    if (restored)
      throw new Error('Cannot reset an already restored HMR fixture');
    for (const [file, contents] of sources) {
      const destination = path.join(directory, file);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, contents);
    }
  };
  const restore = () => {
    if (restored) return;
    fs.rmSync(directory, { recursive: true, force: true });
    restored = true;
  };
  fs.mkdirSync(directory);
  try {
    reset();
    return {
      directory,
      configPath: path.join(directory, '.umirc.ts'),
      pagePath: path.join(directory, 'src/pages/index.tsx'),
      dynamicPath: path.join(directory, 'src/components/Dynamic.tsx'),
      cssPath: path.join(directory, 'src/pages/index.css'),
      businessPath: path.join(directory, 'src/business.ts'),
      outputPath: path.join(directory, 'dist'),
      reset,
      restore,
    };
  } catch (error) {
    restore();
    throw error;
  }
}

function replaceMarker(file, before, after) {
  const source = fs.readFileSync(file, 'utf8');
  assert.equal(
    source.split(before).length,
    2,
    `Expected one ${before} marker in ${file}`,
  );
  const temporary = `${file}.ecosystem-next`;
  fs.writeFileSync(temporary, source.replace(before, after));
  fs.renameSync(temporary, file);
}

async function poll(description, predicate, timeout = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await predicate()) return;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function assertStableFor(assertion, duration = 500) {
  const until = Date.now() + duration;
  do {
    await assertion();
    await sleep(50);
  } while (Date.now() < until);
  await assertion();
}

function businessChunks(outputPath, marker) {
  const matches = [];
  const visit = (directory) => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (
        entry.name.endsWith('.js') &&
        fs.readFileSync(file, 'utf8').includes(marker)
      ) {
        matches.push(path.relative(outputPath, file).split(path.sep).join('/'));
      }
    }
  };
  visit(outputPath);
  return matches.sort();
}

async function availablePort() {
  const listen = (probe, port) =>
    new Promise((resolve, reject) => {
      probe.once('error', reject);
      probe.listen(port, '127.0.0.1', resolve);
    });
  const close = async (probe) => {
    if (!probe.listening) return;
    await new Promise((resolve, reject) =>
      probe.close((error) => (error ? reject(error) : resolve())),
    );
  };
  for (let attempt = 0; attempt < 20; attempt++) {
    const outer = net.createServer();
    const inner = net.createServer();
    try {
      await listen(outer, 0);
      const { port } = outer.address();
      if (port === 65535) continue;
      await listen(inner, port + 1);
      return port;
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
    } finally {
      await Promise.all([close(outer), close(inner)]);
    }
  }
  throw new Error('Could not reserve a Umi dev server port pair');
}

function observe(page) {
  const observed = {
    documents: 0,
    partial: 0,
    restart: 0,
    subscriptions: [],
    errors: [],
  };
  const parseMessage = (payload) => {
    try {
      return JSON.parse(String(payload));
    } catch (error) {
      observed.errors.push(`Invalid HMR WebSocket message: ${error.message}`);
      return null;
    }
  };
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      observed.documents++;
    }
  });
  page.on('pageerror', (error) =>
    observed.errors.push(error.stack || error.message),
  );
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      !message.location().url?.endsWith('/favicon.ico')
    ) {
      observed.errors.push(message.text());
    }
  });
  page.on('websocket', (socket) => {
    socket.on('framesent', ({ payload }) => {
      const message = parseMessage(payload);
      if (message?.type === 'turbopack-subscribe')
        observed.subscriptions.push(message.path);
    });
    socket.on('framereceived', ({ payload }) => {
      const message = parseMessage(payload);
      if (!message || (message.action || message.type) !== 'turbopack-message')
        return;
      const updates = Array.isArray(message.data)
        ? message.data
        : [message.data];
      for (const update of updates) {
        if (update?.type === 'partial') observed.partial++;
        if (update?.type === 'restart') observed.restart++;
      }
    });
  });
  return observed;
}

function pageState(page) {
  return page.evaluate(() => ({
    origin: performance.timeOrigin,
    version: document.querySelector('#hmr-version')?.textContent,
    count: document.querySelector('#hmr-counter')?.textContent,
    dynamic: document.querySelector('#hmr-dynamic-version')?.textContent,
    dynamicCount: document.querySelector('#hmr-dynamic-counter')?.textContent,
    color:
      document.querySelector('#hmr-color') &&
      getComputedStyle(document.querySelector('#hmr-color')).color,
    business: document.documentElement.dataset.businessVersion,
  }));
}

async function initializePage(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('#hmr-counter').click();
  await page.locator('#hmr-show-dynamic').click();
  await page.locator('#hmr-dynamic-counter').click();
  await poll(
    'initial business module',
    async () => (await pageState(page)).business === 'business-v1',
  );
  const state = await pageState(page);
  assert.equal(state.version, 'hmr-page-v1');
  assert.equal(state.dynamic, 'hmr-dynamic-v1');
  assert.equal(state.color, 'rgb(10, 20, 30)');
  assert.equal(state.count, 'count:1');
  assert.equal(state.dynamicCount, 'dynamic-count:1');
  return state;
}

async function assertEnabledHmr(page, url, fixture, observed) {
  const initial = await initializePage(page, url);
  await poll(
    'initial HMR subscription',
    () => observed.subscriptions.length > 0,
  );
  const baselineDocuments = observed.documents;
  assert.equal(
    baselineDocuments,
    1,
    'Initial HMR page load reloaded the document',
  );
  const initialPaths = [...new Set(observed.subscriptions)].sort();
  assert.ok(
    initialPaths.every((file) =>
      /^assets\/.+\.[a-f\d]{8}\.async\.js$/i.test(file),
    ),
    `Unexpected HMR list path: ${initialPaths.join(', ')}`,
  );
  let previousChunks = businessChunks(fixture.outputPath, 'hmr-page-v1');
  assert.ok(previousChunks.length > 0, 'Missing initial emitted page chunk');
  let version = 'hmr-page-v1';
  let dynamic = 'hmr-dynamic-v1';
  let color = 'rgb(10, 20, 30)';
  const expectUpdate = async (label, edit) => {
    const previousPartial = observed.partial;
    edit();
    await poll(label, async () => {
      const current = await pageState(page).catch(() => null);
      assert.equal(
        observed.documents,
        baselineDocuments,
        `${label} reloaded the document`,
      );
      if (!current) return false;
      assert.equal(
        current.origin,
        initial.origin,
        `${label} replaced the document`,
      );
      assert.deepEqual(observed.errors, [], `${label} browser errors`);
      return (
        current.version === version &&
        current.dynamic === dynamic &&
        current.color === color &&
        current.count === 'count:1' &&
        current.dynamicCount === 'dynamic-count:1' &&
        observed.partial > previousPartial
      );
    });
    assert.equal(observed.restart, 0, `${label} received a restart`);
    assert.deepEqual(
      [...new Set(observed.subscriptions)].sort(),
      initialPaths,
      `${label} changed HMR subscription paths`,
    );
  };
  for (const next of ['hmr-page-v2', 'hmr-page-v3']) {
    const previous = version;
    version = next;
    await expectUpdate(`page update ${next}`, () =>
      replaceMarker(fixture.pagePath, previous, next),
    );
    const currentChunks = businessChunks(fixture.outputPath, next);
    assert.ok(
      currentChunks.some((file) => !previousChunks.includes(file)),
      `${next} did not change an emitted business chunk filename`,
    );
    assert.ok(
      currentChunks.every((file) =>
        /^assets\/.+\.[a-f\d]{8}\.async\.js$/i.test(file),
      ),
      `Business chunk stopped honoring contenthash: ${currentChunks.join(
        ', ',
      )}`,
    );
    previousChunks = currentChunks;
  }
  dynamic = 'hmr-dynamic-v2';
  await expectUpdate('loaded dynamic component update', () =>
    replaceMarker(fixture.dynamicPath, 'hmr-dynamic-v1', dynamic),
  );
  color = 'rgb(20, 40, 60)';
  await expectUpdate('CSS update', () =>
    replaceMarker(fixture.cssPath, 'rgb(10, 20, 30)', color),
  );
  await assertStableFor(async () => {
    assert.deepEqual(
      await pageState(page),
      { ...initial, version, dynamic, color },
      'A delayed HMR update changed the settled page or counters',
    );
    assert.equal(
      observed.documents,
      baselineDocuments,
      'A delayed HMR update reloaded the document',
    );
    assert.equal(
      observed.restart,
      0,
      'A delayed HMR update received a restart',
    );
    assert.deepEqual(observed.errors, [], 'Settled HMR browser errors');
    assert.deepEqual(
      [...new Set(observed.subscriptions)].sort(),
      initialPaths,
      'A delayed HMR update changed subscription paths',
    );
  });
  console.log(
    'PASS Umi contenthash HMR: two page edits, loaded dynamic component and CSS preserve both counters without reloading',
  );

  const previousPartial = observed.partial;
  replaceMarker(fixture.businessPath, 'business-v1', 'business-v2');
  await poll('unaccepted dynamic business target to reload', async () => {
    const current = await pageState(page).catch(() => null);
    return (
      observed.partial > previousPartial &&
      current?.business === 'business-v2' &&
      current.origin !== initial.origin &&
      current.count === 'count:0'
    );
  });
  await assertStableFor(async () => {
    const current = await pageState(page);
    assert.equal(
      current.business,
      'business-v2',
      'Business reload lost the new version',
    );
    assert.equal(
      current.version,
      version,
      'Business reload loaded stale page code',
    );
    assert.equal(
      current.count,
      'count:0',
      'Business reload did not reset page state',
    );
    assert.notEqual(
      current.origin,
      initial.origin,
      'Business update did not replace the document',
    );
    assert.equal(
      observed.documents,
      baselineDocuments + 1,
      'An unaccepted business update must perform one normal full reload',
    );
    assert.equal(
      observed.restart,
      0,
      'The business update was replaced by a server restart',
    );
  });
  console.log(
    'PASS Umi contenthash HMR: unaccepted dynamic business target still triggers a full reload',
  );
}

async function assertDisabledHmr(page, url, fixture, observed) {
  const initial = await initializePage(page, url);
  const baselineDocuments = observed.documents;
  assert.equal(
    baselineDocuments,
    1,
    'Initial hot:false page load reloaded the document',
  );
  replaceMarker(fixture.pagePath, 'hmr-page-v1', 'hmr-disabled-v2');
  await poll(
    'hot:false output to contain the edited source',
    () => businessChunks(fixture.outputPath, 'hmr-disabled-v2').length > 0,
  );
  // The output assertion above proves compilation completed; this quiet window
  // detects an incorrectly re-enabled HMR subscription or delayed auto reload.
  await sleep(500);
  assert.deepEqual(
    await pageState(page),
    initial,
    'hot:false changed the running page',
  );
  assert.equal(
    observed.documents,
    baselineDocuments,
    'hot:false automatically reloaded',
  );
  assert.deepEqual(
    observed.subscriptions,
    [],
    'hot:false registered HMR subscriptions',
  );
  assert.equal(observed.partial, 0, 'hot:false received HMR updates');
  assert.equal(observed.restart, 0, 'hot:false received a restart');
  assert.deepEqual(observed.errors, [], 'hot:false browser errors');
  const ping = await fetch(new URL('/__umi_ping', url), {
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(ping.status, 200, 'Umi ping failed with HMR disabled');
  await ping.body?.cancel();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await poll('manual reload to show the edited page', async () => {
    const current = await pageState(page);
    return (
      current.version === 'hmr-disabled-v2' &&
      current.origin !== initial.origin &&
      current.count === 'count:0'
    );
  });
  console.log(
    'PASS Umi hot:false: compiled edits do not update or reload the page; manual reload shows the new version',
  );
}

async function runScenario(repoDir, fixture, hot, chromium) {
  const port = await availablePort();
  const url = `http://127.0.0.1:${port}/`;
  const running = startServer(repoDir, {
    cwd: fixture.directory,
    command: [
      process.execPath,
      path.join(repoDir, 'packages/umi/bin/umi.js'),
      'dev',
    ],
    env: {
      PORT: String(port),
      STRICT_PORT: String(port),
      NODE_ENV: 'development',
      BROWSER: 'none',
      FORCE_UTOOPACK: '1',
      UMI_TELEMETRY: '0',
      ECOSYSTEM_HMR_ENABLED: hot ? '1' : '0',
    },
  });
  let browser = null;
  let page = null;
  let observed = null;
  try {
    await waitForServer(running, { url, timeout: 120_000 });
    browser = await chromium.launch();
    page = await browser.newPage();
    observed = observe(page);
    if (hot) await assertEnabledHmr(page, url, fixture, observed);
    else await assertDisabledHmr(page, url, fixture, observed);
  } catch (error) {
    const current = page ? await pageState(page).catch(() => null) : null;
    throw new Error(
      `Umi contenthash HMR (hot=${hot}) failed: ${
        error.stack || error
      }\nState: ${JSON.stringify(current)}\nObserved: ${JSON.stringify(
        observed,
      )}\nServer log:\n${running.getLog()}`,
    );
  } finally {
    try {
      await browser?.close();
    } finally {
      await stopServer(running.server);
    }
  }
}

export async function main(repoDir = process.cwd()) {
  repoDir = path.resolve(repoDir);
  const requireFromConsumer = createRequire(path.join(repoDir, 'package.json'));
  const { chromium } = requireFromConsumer('playwright-chromium');
  const fixture = prepareHmrFixture(repoDir);
  try {
    await runScenario(repoDir, fixture, true, chromium);
    fixture.reset();
    await runScenario(repoDir, fixture, false, chromium);
  } finally {
    fixture.restore();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
