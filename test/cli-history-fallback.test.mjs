import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import test from 'node:test';
import {
  assertMissingAssets,
  assertRouteResponse,
  getMissingRouteStatus,
  prepareFixture,
} from '../scripts/cli-history-fallback.mjs';

test('the CLI fixture generates index.html and renders the requested route', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'utoo-cli-fixture-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  prepareFixture(directory);
  const config = JSON.parse(fs.readFileSync(path.join(directory, 'utoopack.json'), 'utf8'));
  assert.equal(config.entry[0].html.template, './index.html');
  assert.equal(config.output.publicPath, '/');
  assert.match(fs.readFileSync(path.join(directory, 'index.js'), 'utf8'), /location.pathname \+ location.search/);
});

test('the HTTP assertion rejects an always-on fallback in the disabled run', async (context) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<title>ecosystem-cli-shell</title>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  await assertRouteResponse(url, true);
  await assert.rejects(getMissingRouteStatus(url), /baseline must return 404 or 405, received 200/);
  await assert.rejects(assertRouteResponse(url, false, 404), /fallback enabled=false/);
  await assert.rejects(assertMissingAssets(url, 404), /Missing assets must keep their error response/);
});

for (const missingStatus of [404, 405]) {
  test(`the HTTP assertions retain a ${missingStatus} missing-route baseline`, async (context) => {
    const server = createServer((_request, response) => {
      response.writeHead(missingStatus);
      response.end();
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    context.after(() => new Promise((resolve) => server.close(resolve)));
    const url = `http://127.0.0.1:${server.address().port}`;
    const baseline = await getMissingRouteStatus(url);
    assert.equal(baseline, missingStatus);
    await assertRouteResponse(url, false, baseline);
    await assertMissingAssets(url, baseline);
    await assert.rejects(assertRouteResponse(url, true, baseline), /fallback enabled=true/);
  });
}

test('missing-route assertions reject status changes from the non-HTML baseline', async (context) => {
  const server = createServer((request, response) => {
    response.writeHead(request.headers.accept === 'application/json' ? 404 : 405);
    response.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const baseline = await getMissingRouteStatus(url);
  await assert.rejects(assertRouteResponse(url, false, baseline), /fallback enabled=false/);
  await assert.rejects(assertMissingAssets(url, baseline), /Missing assets must keep their error response/);
});
