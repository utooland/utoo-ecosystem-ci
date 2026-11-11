import assert from 'node:assert/strict';
import test from 'node:test';
import { waitForServer } from '../scripts/evjs-utoopack-dev-smoke.mjs';

test('EVJS dev smoke requires both servers and a successful page response', async () => {
  const server = { exitCode: null, signalCode: null };
  let log = '';
  const requested = [];

  setTimeout(() => {
    log = [
      'API server listening at:',
      '  Local: http://localhost:3001',
      'App listening at:',
      '  Local: http://localhost:3000',
    ].join('\n');
  }, 10);

  await waitForServer(
    {
      server,
      getLog: () => log,
      getSpawnError: () => null,
    },
    {
      timeout: 1_000,
      pollInterval: 5,
      fetchImpl: async (url) => {
        requested.push(url);
        return { ok: true };
      },
    },
  );

  assert.deepEqual(requested, ['http://127.0.0.1:3000/']);
});

test('EVJS dev smoke rejects a signal exit before readiness', async () => {
  const server = { exitCode: null, signalCode: null };
  setTimeout(() => {
    server.signalCode = 'SIGABRT';
  }, 10);

  await assert.rejects(
    waitForServer(
      {
        server,
        getLog: () => 'fatal runtime error: aborting',
        getSpawnError: () => null,
      },
      {
        timeout: 1_000,
        pollInterval: 5,
        fetchImpl: async () => {
          throw new Error('not ready');
        },
      },
    ),
    /signal SIGABRT[\s\S]*fatal runtime error: aborting/,
  );
});

test('EVJS dev smoke fails on effect conflicts even when both servers start', async () => {
  const log = [
    'conflicting effects for the same key (key length: 89 bytes)',
    'API server listening at:',
    'App listening at:\n  Local: http://localhost:3000',
  ].join('\n');
  await assert.rejects(
    waitForServer({
      server: { exitCode: null, signalCode: null },
      getLog: () => log,
      getSpawnError: () => null,
    }, {
      failurePattern: /conflicting effects for the same key/i,
      fetchImpl: async () => {
        assert.fail('A readiness response must not hide a build failure');
      },
    }),
    /conflicting effects for the same key/,
  );
});

test('EVJS dev smoke polls additional rebuild readiness after HTTP becomes ready', async () => {
  let checks = 0;
  const url = await waitForServer({
    server: { exitCode: null, signalCode: null },
    getLog: () => 'API server listening at:\nApp listening at:\n  Local: http://localhost:3000',
    getSpawnError: () => null,
  }, {
    timeout: 1_000,
    pollInterval: 1,
    fetchImpl: async () => ({ ok: true }),
    isReady: async () => ++checks >= 3,
  });
  assert.equal(url, 'http://127.0.0.1:3000/');
  assert.equal(checks, 3);
});
