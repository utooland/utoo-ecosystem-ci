import { execFileSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import {
  startServer,
  stopServer,
  waitForServer,
} from './utoopack-dev-server-smoke.mjs';

export async function availablePortPair({
  minPort = 10_000,
  maxPort = 30_000,
  attempts = 20,
} = {}) {
  if (
    !Number.isInteger(minPort) ||
    !Number.isInteger(maxPort) ||
    minPort < 1 ||
    maxPort > 65535 ||
    minPort >= maxPort ||
    !Number.isInteger(attempts) ||
    attempts < 1
  ) {
    throw new Error('Invalid Umi dev server port range or attempt count');
  }
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

  // Keep the public and internal ports below the default dynamic port ranges.
  // Probes are released before startup, so a bind race still needs a retry.
  const pairs = Math.floor((maxPort - minPort + 1) / 2);
  const first = randomInt(pairs);
  for (let attempt = 0; attempt < Math.min(attempts, pairs); attempt++) {
    const port = minPort + 2 * ((first + attempt) % pairs);
    const outer = net.createServer();
    const inner = net.createServer();
    try {
      await listen(outer, port);
      await listen(inner, port + 1);
      return port;
    } catch (error) {
      if (error.code !== 'EADDRINUSE' && error.code !== 'EACCES') throw error;
    } finally {
      await Promise.all([close(outer), close(inner)]);
    }
  }
  throw new Error('Could not find an available Umi dev server port pair');
}

function reportPortOwners(port) {
  try {
    if (process.platform === 'win32') {
      return execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Get-NetTCPConnection -LocalPort ${port},${port + 1} -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,State,OwningProcess | Format-Table -AutoSize | Out-String -Width 200`,
        ],
        { encoding: 'utf8', timeout: 5_000, windowsHide: true },
      ).trim() || 'No TCP port owners found.';
    }
    return execFileSync(
      'lsof',
      ['-nP', `-iTCP:${port}`, `-iTCP:${port + 1}`],
      { encoding: 'utf8', timeout: 5_000 },
    ).trim() || 'No TCP port owners found.';
  } catch (error) {
    return `Could not inspect TCP port owners: ${error.message}`;
  }
}

export async function startUmiServer(
  repoDir,
  { cwd, env = {}, timeout = 120_000, maxAttempts = 3 },
  {
    availablePort = availablePortPair,
    startServer: start = startServer,
    waitForServer: wait = waitForServer,
    stopServer: stop = stopServer,
    diagnosePort = reportPortOwners,
    warn = console.warn,
  } = {},
) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const port = await availablePort();
    const url = `http://127.0.0.1:${port}/`;
    const running = start(repoDir, {
      cwd,
      command: [
        process.execPath,
        path.join(repoDir, 'packages/umi/bin/umi.js'),
        'dev',
      ],
      env: {
        ...env,
        PORT: String(port),
        STRICT_PORT: String(port),
        NODE_ENV: 'development',
        BROWSER: 'none',
        FORCE_UTOOPACK: '1',
        UMI_TELEMETRY: '0',
      },
    });
    try {
      await wait(running, { url, timeout });
      return { running, url, port };
    } catch (error) {
      if (error.code === 'EADDRINUSE') {
        warn(`Umi startup attempt ${attempt}/${maxAttempts}: ports ${port}/${port + 1} conflicted.\n${running.getLog()}`);
        // Collect evidence before cleanup removes the process holding a port.
        warn(await diagnosePort(port));
      }
      await stop(running.server);
      if (error.code !== 'EADDRINUSE' || attempt === maxAttempts) throw error;
    }
  }
  throw new Error('Umi dev server startup requires at least one attempt');
}
