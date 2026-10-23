import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  assertAfterMiddlewares,
  enableUtoopack,
  FALLBACK_SHELL,
  NESTED_ROUTE,
  NESTED_TEXT,
  prepareRoutingFixture,
} from '../scripts/umi-utoopack-e2e.mjs';
import routingPlugin, {
  AFTER_MIDDLEWARE_CASES,
} from '../fixtures/umi-routing/plugin.js';

test('enableUtoopack adds the native Umi utoopack config once', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'umi-utoopack-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, '.umirc.ts');
  fs.writeFileSync(configPath, 'export default {\n  model: {},\n};\n');

  enableUtoopack(configPath);
  enableUtoopack(configPath);

  assert.equal(
    fs.readFileSync(configPath, 'utf8'),
    'export default {\n  model: {},\n  utoopack: {},\n};\n',
  );
});

function createExample(
  context,
  config = 'export default {\n  model: {},\n};\n',
) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'umi-routing-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const exampleDir = path.join(directory, 'app');
  fs.mkdirSync(path.join(exampleDir, 'pages'), { recursive: true });
  fs.writeFileSync(path.join(exampleDir, '.umirc.ts'), config);
  return { directory, exampleDir };
}

test('routing fixture preserves existing config and restores its generated files', (context) => {
  const config =
    "export default {\n  plugins: ['existing-plugin'],\n  model: {},\n};\n";
  const { directory, exampleDir } = createExample(context, config);
  const pluginPath = path.join(exampleDir, '.ecosystem-routing-plugin.ts');
  fs.writeFileSync(pluginPath, 'previous plugin contents');
  const fixture = prepareRoutingFixture(directory, 'app');
  const generatedConfig = fs.readFileSync(
    path.join(exampleDir, '.umirc.ts'),
    'utf8',
  );
  assert.match(generatedConfig, /plugins: \['existing-plugin'\]/);
  assert.match(
    generatedConfig,
    /plugins: \[\.\.\.\(ecosystemOriginalConfig\.plugins/,
  );
  assert.match(generatedConfig, /utoopack: \{\}/);
  assert.match(fs.readFileSync(pluginPath, 'utf8'), /api\.addMiddlewares/);
  assert.match(
    fs.readFileSync(
      path.join(exampleDir, 'pages', `${NESTED_ROUTE.slice(1)}.tsx`),
      'utf8',
    ),
    new RegExp(NESTED_TEXT),
  );
  fs.mkdirSync(fixture.outputPath);
  fs.writeFileSync(path.join(fixture.outputPath, 'index.html'), FALLBACK_SHELL);

  fixture.restore();

  assert.equal(
    fs.readFileSync(path.join(exampleDir, '.umirc.ts'), 'utf8'),
    config,
  );
  assert.equal(fs.readFileSync(pluginPath, 'utf8'), 'previous plugin contents');
  assert.equal(
    fs.existsSync(
      path.join(exampleDir, 'pages', `${NESTED_ROUTE.slice(1)}.tsx`),
    ),
    false,
  );
  assert.equal(fs.existsSync(fixture.outputPath), false);
});

test('routing fixture refuses to overwrite an existing output directory', (context) => {
  const { directory, exampleDir } = createExample(context);
  const outputPath = path.join(exampleDir, '.ecosystem-routing-dist');
  fs.mkdirSync(outputPath);
  fs.writeFileSync(path.join(outputPath, 'index.html'), 'existing output');
  assert.throws(
    () => prepareRoutingFixture(directory, 'app'),
    /Refusing to replace/,
  );
  assert.equal(
    fs.readFileSync(path.join(outputPath, 'index.html'), 'utf8'),
    'existing output',
  );
});

test('routing fixture restores config when preparing the fixture fails', (context) => {
  const config = 'module.exports = {};\n';
  const { directory, exampleDir } = createExample(context, config);
  assert.throws(
    () => prepareRoutingFixture(directory, 'app'),
    /Could not enable utoopack/,
  );
  assert.equal(
    fs.readFileSync(path.join(exampleDir, '.umirc.ts'), 'utf8'),
    config,
  );
});

test('routing plugin returns distinct JSON statuses and leaves unrelated routes alone', () => {
  let middleware;
  routingPlugin({
    addMiddlewares: (factory) => {
      [middleware] = factory();
    },
  });
  for (const expected of AFTER_MIDDLEWARE_CASES) {
    const response = {
      status(value) {
        this.statusCode = value;
        return this;
      },
      json(value) {
        this.body = value;
        return this;
      },
    };
    middleware({ url: `${expected.pathname}?probe=1` }, response, () =>
      assert.fail('should handle fixture API'),
    );
    assert.equal(response.statusCode, expected.status);
    assert.deepEqual(response.body, expected.body);
  }
  let nextCalled = false;
  middleware({ url: NESTED_ROUTE }, {}, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
});

test('after-middleware assertion sends wildcard Accept and verifies JSON failures', async () => {
  const requested = [];
  await assertAfterMiddlewares('http://fixture.test/', async (url, options) => {
    requested.push(url.pathname);
    assert.equal(options.headers.accept, '*/*');
    const expected = AFTER_MIDDLEWARE_CASES.find(
      ({ pathname }) => url.pathname === pathname,
    );
    return Response.json(expected.body, { status: expected.status });
  });
  assert.deepEqual(
    requested,
    AFTER_MIDDLEWARE_CASES.map(({ pathname }) => pathname),
  );
});

test('after-middleware assertion rejects an accidental successful SPA fallback', async () => {
  await assert.rejects(
    assertAfterMiddlewares(
      'http://fixture.test/',
      async () =>
        new Response(FALLBACK_SHELL, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
    ),
    /must reach Umi's after middleware/,
  );
});
