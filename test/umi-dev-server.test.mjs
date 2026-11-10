import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';
import {
  availablePortPair,
  startUmiServer,
} from '../scripts/umi-dev-server.mjs';

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
}

function close(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test('Umi port pairs stay below the dynamic range and release both probes', async () => {
  const port = await availablePortPair();
  assert.ok(port >= 10_000 && port + 1 <= 30_000);
  const outer = net.createServer();
  const inner = net.createServer();
  try {
    await listen(outer, port);
    await listen(inner, port + 1);
  } finally {
    await Promise.all([close(outer), close(inner)]);
  }
});

test('Umi port selection rejects a pair with an occupied inner port', async () => {
  const port = await availablePortPair();
  const inner = net.createServer();
  const outer = net.createServer();
  try {
    await listen(inner, port + 1);
    await assert.rejects(
      availablePortPair({ minPort: port, maxPort: port + 1, attempts: 2 }),
      /port pair/i,
    );
    // Failed probes must also release the outer port.
    await listen(outer, port);
  } finally {
    await Promise.all([close(outer), close(inner)]);
  }
});

function startupDependencies({ failures = [], cleanupError } = {}) {
  const events = [];
  const starts = [];
  let selections = 0;
  const dependencies = {
    async availablePort() {
      const port = 20_000 + selections++ * 2;
      events.push(`select:${port}`);
      return port;
    },
    startServer(repoDir, options) {
      const running = { server: { id: starts.length }, getLog: () => '' };
      starts.push({ repoDir, options, running });
      events.push(`start:${running.server.id}`);
      return running;
    },
    async waitForServer(running) {
      events.push(`wait:${running.server.id}`);
      const failure = failures[running.server.id];
      if (failure) throw failure;
    },
    async diagnosePort(port) {
      events.push(`diagnose:${port}`);
    },
    async stopServer(server) {
      events.push(`stop:${server.id}`);
      if (cleanupError) throw cleanupError;
    },
    warn() {},
  };
  return { dependencies, events, starts };
}

function addressInUse() {
  return Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' });
}

test('Umi startup diagnoses and cleans a port conflict before selecting another pair', async () => {
  const { dependencies, events, starts } = startupDependencies({
    failures: [addressInUse()],
  });
  const result = await startUmiServer(
    '/consumer',
    { cwd: '/consumer/fixture', env: { ECOSYSTEM_HMR_ENABLED: '0' } },
    dependencies,
  );

  assert.deepEqual(events, [
    'select:20000',
    'start:0',
    'wait:0',
    'diagnose:20000',
    'stop:0',
    'select:20002',
    'start:1',
    'wait:1',
  ]);
  assert.equal(result.running, starts[1].running);
  assert.equal(result.port, 20_002);
  assert.equal(result.url, 'http://127.0.0.1:20002/');
  assert.equal(starts[1].options.cwd, '/consumer/fixture');
  assert.equal(starts[1].options.env.PORT, '20002');
  assert.equal(starts[1].options.env.STRICT_PORT, '20002');
  assert.equal(starts[1].options.env.ECOSYSTEM_HMR_ENABLED, '0');
});

test('Umi startup propagates unrelated failures after cleanup without retrying', async () => {
  const failure = new Error('The build failed');
  const { dependencies, events } = startupDependencies({ failures: [failure] });

  await assert.rejects(
    startUmiServer('/consumer', { cwd: 'fixture' }, dependencies),
    (error) => error === failure,
  );
  assert.deepEqual(events, [
    'select:20000',
    'start:0',
    'wait:0',
    'stop:0',
  ]);
});

test('Umi startup stops retrying after three conflicting port pairs', async () => {
  const failures = [addressInUse(), addressInUse(), addressInUse()];
  const { dependencies, events, starts } = startupDependencies({ failures });

  await assert.rejects(
    startUmiServer('/consumer', { cwd: 'fixture' }, dependencies),
    (error) => error === failures[2],
  );
  assert.equal(starts.length, 3);
  assert.deepEqual(
    events.filter((event) => event.startsWith('stop:')),
    ['stop:0', 'stop:1', 'stop:2'],
  );
  assert.equal(events.at(-1), 'stop:2');
});

test('Umi startup never retries when conflict cleanup fails', async () => {
  const cleanupError = new Error('The worker did not exit');
  const { dependencies, events, starts } = startupDependencies({
    failures: [addressInUse()],
    cleanupError,
  });

  await assert.rejects(
    startUmiServer('/consumer', { cwd: 'fixture' }, dependencies),
    (error) => error === cleanupError,
  );
  assert.equal(starts.length, 1);
  assert.deepEqual(events, [
    'select:20000',
    'start:0',
    'wait:0',
    'diagnose:20000',
    'stop:0',
  ]);
});
