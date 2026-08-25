#!/usr/bin/env node

import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const READY_PATTERN = /utoo pack v.* ready/i;
const ANSI_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const MAX_LOG_LENGTH = 200_000;

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export function parseArgs(argv) {
  const separator = argv.indexOf('--');
  if (separator === -1 || separator === argv.length - 1) {
    throw new Error('Expected a server command after --');
  }

  const options = { cwd: '.', command: argv.slice(separator + 1) };
  const flags = argv.slice(0, separator);
  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];
    if (flag !== '--cwd' && flag !== '--url') {
      throw new Error(`Unknown argument: ${flag}`);
    }

    const value = flags[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`${flag} requires a value`);
    }
    options[flag === '--cwd' ? 'cwd' : 'url'] = value;
    index += 1;
  }

  if (!options.url) throw new Error('Missing required --url');
  return options;
}

function exitReason(server) {
  if (server.signalCode !== null) return `signal ${server.signalCode}`;
  return `exit code ${server.exitCode}`;
}

export function startServer(repoDir, { cwd, command }) {
  const [executable, ...args] = command;
  const server = spawn(executable, args, {
    cwd: path.resolve(repoDir, cwd),
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      FORCE_COLOR: '0',
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

export async function waitForServer(
  { server, getLog, getSpawnError },
  {
    url,
    timeout = 180_000,
    pollInterval = 500,
    fetchImpl = globalThis.fetch,
  } = {},
) {
  if (!url) throw new Error('Missing readiness URL');
  const started = Date.now();

  while (Date.now() - started < timeout) {
    const spawnError = getSpawnError();
    if (spawnError) throw spawnError;
    if (server.exitCode !== null || server.signalCode !== null) {
      throw new Error(
        `Utoopack dev server exited before it was ready (${exitReason(server)}).\n${getLog()}`,
      );
    }

    if (READY_PATTERN.test(getLog().replace(ANSI_PATTERN, ''))) {
      try {
        const response = await fetchImpl(url);
        if (response.ok) {
          await response.body?.cancel();
          return;
        }
      } catch {
        // The readiness banner can precede the first accepted connection.
      }
    }

    await sleep(pollInterval);
  }

  throw new Error(`Timed out waiting for the utoopack dev server.\n${getLog()}`);
}

function waitForExit(server, timeout) {
  if (server.exitCode !== null || server.signalCode !== null) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (exited) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.off('exit', onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeout);
    timer.unref();
    server.once('exit', onExit);
    if (server.exitCode !== null || server.signalCode !== null) finish(true);
  });
}

function killServer(server, signal) {
  if (process.platform === 'win32' || server.pid === undefined) {
    server.kill(signal);
    return;
  }

  try {
    process.kill(-server.pid, signal);
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

export async function stopServer(server) {
  if (server.exitCode !== null || server.signalCode !== null) return;

  killServer(server, 'SIGTERM');
  if (await waitForExit(server, 5_000)) return;

  killServer(server, 'SIGKILL');
  if (!(await waitForExit(server, 5_000))) {
    throw new Error('Utoopack dev server did not exit after SIGKILL.');
  }
}

export async function main(
  repoDir = process.cwd(),
  argv = process.argv.slice(2),
) {
  const options = parseArgs(argv);
  const runningServer = startServer(repoDir, options);

  try {
    await waitForServer(runningServer, { url: options.url });
  } finally {
    await stopServer(runningServer.server);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
