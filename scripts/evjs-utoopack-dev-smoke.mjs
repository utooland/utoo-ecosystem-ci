#!/usr/bin/env node

import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const API_READY_PATTERN = /API server listening at:/;
const APP_READY_PATTERN =
  /App listening at:\s*\r?\n\s*Local:\s*(https?:\/\/[^\s]+)/;
const ANSI_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const MAX_LOG_LENGTH = 200_000;

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function fetchableUrl(log) {
  const match = log.replace(ANSI_PATTERN, '').match(APP_READY_PATTERN);
  if (!match) return null;

  const url = new URL(match[1]);
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url.href;
}

function exitReason(server) {
  if (server.signalCode !== null) return `signal ${server.signalCode}`;
  return `exit code ${server.exitCode}`;
}

export function startServer(repoDir) {
  const exampleDir = path.join(repoDir, 'examples/basic');
  const cliPath = path.join(repoDir, 'packages/cli/bin/ev.js');
  const server = spawn(process.execPath, [cliPath, 'dev', '--no-shortcuts'], {
    cwd: exampleDir,
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
    timeout = 120_000,
    pollInterval = 250,
    fetchImpl = globalThis.fetch,
  } = {},
) {
  const started = Date.now();

  while (Date.now() - started < timeout) {
    const spawnError = getSpawnError();
    if (spawnError) throw spawnError;
    if (server.exitCode !== null || server.signalCode !== null) {
      throw new Error(
        `EVJS dev server exited before it was ready (${exitReason(server)}).\n${getLog()}`,
      );
    }

    const log = getLog();
    const url = fetchableUrl(log);
    if (url && API_READY_PATTERN.test(log.replace(ANSI_PATTERN, ''))) {
      try {
        const response = await fetchImpl(url);
        if (response.ok) return;
      } catch {
        // The readiness banner can precede the first accepted connection.
      }
    }

    await sleep(pollInterval);
  }

  throw new Error(`Timed out waiting for the EVJS dev server.\n${getLog()}`);
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
    throw new Error('EVJS dev server did not exit after SIGKILL.');
  }
}

export async function main(repoDir = process.cwd()) {
  const runningServer = startServer(repoDir);

  try {
    await waitForServer(runningServer);
  } finally {
    await stopServer(runningServer.server);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
