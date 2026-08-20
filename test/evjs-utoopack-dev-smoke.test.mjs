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
