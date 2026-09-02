import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseArgs,
  waitForServer,
} from '../scripts/utoopack-dev-server-smoke.mjs';

test('parses the dev server directory, URL, and command', () => {
  assert.deepEqual(
    parseArgs([
      '--cwd',
      'examples/site',
      '--url',
      'http://127.0.0.1:9528/',
      '--timeout',
      '600000',
      '--',
      'npm',
      'run',
      'dev',
    ]),
    {
      cwd: 'examples/site',
      url: 'http://127.0.0.1:9528/',
      timeout: 600000,
      command: ['npm', 'run', 'dev'],
    },
  );
});

test('rejects missing URL, command, and unknown arguments', () => {
  assert.throws(() => parseArgs(['--', 'npm', 'run', 'dev']), /--url/);
  assert.throws(() => parseArgs(['--url', 'http://localhost']), /after --/);
  assert.throws(
    () => parseArgs(['--port', '9528', '--', 'npm', 'run', 'dev']),
    /Unknown argument: --port/,
  );
  assert.throws(
    () =>
      parseArgs([
        '--url',
        'http://localhost',
        '--timeout',
        'soon',
        '--',
        'npm',
        'run',
        'dev',
      ]),
    /--timeout must be a positive integer/,
  );
});

test('requires both the utoopack banner and a successful response', async () => {
  const server = { exitCode: null, signalCode: null };
  let log = '';
  let requests = 0;

  setTimeout(() => {
    log = 'utoo pack v1.6.0 ready in 42 ms';
  }, 10);

  await waitForServer(
    {
      server,
      getLog: () => log,
      getSpawnError: () => null,
    },
    {
      url: 'http://127.0.0.1:9528/',
      timeout: 1_000,
      pollInterval: 5,
      fetchImpl: async () => {
        requests += 1;
        return { ok: requests > 1 };
      },
    },
  );

  assert.equal(requests, 2);
});

test('bounds readiness requests that never return headers', async () => {
  const server = { exitCode: null, signalCode: null };

  await assert.rejects(
    waitForServer(
      {
        server,
        getLog: () => 'utoo pack v1.6.0 ready in 42 ms',
        getSpawnError: () => null,
      },
      {
        url: 'http://127.0.0.1:9528/',
        timeout: 50,
        requestTimeout: 10,
        pollInterval: 1,
        fetchImpl: async () => new Promise(() => {}),
      },
    ),
    /Timed out waiting for the utoopack dev server/,
  );
});

test('rejects a signal exit before readiness', async () => {
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
        url: 'http://127.0.0.1:9528/',
        timeout: 1_000,
        pollInterval: 5,
        fetchImpl: async () => ({ ok: true }),
      },
    ),
    /signal SIGABRT[\s\S]*fatal runtime error: aborting/,
  );
});
