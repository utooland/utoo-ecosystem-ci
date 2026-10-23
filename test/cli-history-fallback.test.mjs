import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import test from 'node:test';
import { assertRouteResponse, prepareFixture } from '../scripts/cli-history-fallback.mjs';

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
  await assert.rejects(assertRouteResponse(url, false), /fallback enabled=false/);
});

test('the HTTP assertion rejects a missing fallback in the default run', async (context) => {
  const server = createServer((_request, response) => {
    response.writeHead(405);
    response.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  await assertRouteResponse(url, false);
  await assert.rejects(assertRouteResponse(url, true), /fallback enabled=true/);
});
