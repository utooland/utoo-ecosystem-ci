import assert from 'node:assert/strict';
import { once, EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  resolveCommand,
  runCommand,
  spawnCommand,
  stopProcessTree,
} from '../src/process.mjs';

test('Windows npm cmd shim resolves to Node CLI without changing arguments', () => {
  const execPath = 'C:\\Program Files\\nodejs\\node.exe';
  const entryPoint =
    'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js';
  const args = [
    'run',
    'build',
    '--',
    'value with spaces',
    '"quoted"',
    '& echo other',
    '%TEMP%',
  ];

  assert.deepEqual(
    resolveCommand(['npm.cmd', ...args], {
      platform: 'win32',
      execPath,
      env: {},
      existsSync: (filename) => filename === entryPoint,
    }),
    [execPath, entryPoint, ...args],
  );
});

test('Windows Corepack uses a Node CLI installed on PATH', () => {
  const execPath = 'C:\\node\\node.exe';
  const entryPoint = 'D:\\npm tools\\node_modules\\corepack\\dist\\corepack.js';
  assert.deepEqual(
    resolveCommand(['corepack', 'pnpm', '--dir', 'example dir', 'dev'], {
      platform: 'win32',
      execPath,
      env: { Path: 'D:\\npm tools;C:\\other' },
      existsSync: (filename) => filename === entryPoint,
    }),
    [execPath, entryPoint, 'pnpm', '--dir', 'example dir', 'dev'],
  );
});

test('Windows native commands are unchanged and unsupported cmd shims fail clearly', () => {
  const options = { platform: 'win32', existsSync: () => false };
  const nativeCommand = ['git', 'checkout', '--detach', 'branch with spaces'];
  assert.deepEqual(resolveCommand(nativeCommand, options), nativeCommand);
  assert.throws(
    () => resolveCommand(['npm', 'install'], options),
    /Node.js CLI entry point/,
  );
  assert.throws(
    () => resolveCommand(['custom.cmd', 'build'], options),
    /without a shell/,
  );
});

test('spawnCommand runs Windows Corepack through Node with shell disabled', () => {
  const execPath = 'C:\\node\\node.exe';
  const entryPoint = 'C:\\node\\node_modules\\corepack\\dist\\corepack.js';
  const child = new EventEmitter();
  const invocations = [];
  assert.equal(
    spawnCommand(['corepack', 'pnpm', 'exec', 'value & literal'], {
      platform: 'win32',
      execPath,
      existsSync: (filename) => filename === entryPoint,
      env: { ECOSYSTEM_PROCESS_TEST: 'preserved' },
      spawnImpl: (...args) => {
        invocations.push(args);
        return child;
      },
    }),
    child,
  );
  const [invocation] = invocations;
  assert.equal(invocation[0], execPath);
  assert.deepEqual(invocation[1], [
    entryPoint,
    'pnpm',
    'exec',
    'value & literal',
  ]);
  assert.equal(invocation[2].shell, false);
  assert.equal(invocation[2].env.ECOSYSTEM_PROCESS_TEST, 'preserved');
});

test('runCommand preserves literal arguments in a real child process', async (context) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ecosystem-process-'),
  );
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const script = path.join(directory, 'argument probe.mjs');
  fs.writeFileSync(
    script,
    'console.log(JSON.stringify(process.argv.slice(2)));',
  );
  const args = [
    'two words',
    '"quote"',
    '& echo should-not-run',
    '%TEMP%',
    '$HOME',
    '',
  ];
  const { stdout } = await runCommand([process.execPath, script, ...args], {
    capture: true,
  });
  assert.deepEqual(JSON.parse(stdout), args);
});

function runningChild(pid = 12345) {
  return Object.assign(new EventEmitter(), {
    pid,
    exitCode: null,
    signalCode: null,
  });
}

test('Windows cleanup targets only the owned PID and its descendants', async () => {
  const child = runningChild();
  const calls = [];
  await stopProcessTree(child, {
    platform: 'win32',
    run: async (command, options) => {
      calls.push({ command, options });
      child.exitCode = 1;
      child.emit('close', 1, null);
    },
  });
  assert.deepEqual(calls, [
    {
      command: ['taskkill.exe', '/PID', '12345', '/T', '/F'],
      options: { capture: true },
    },
  ]);
});

test('cleanup ignores an exited child or a failed spawn with no owned PID', async () => {
  const calls = [];
  const run = async (command) => calls.push(command);
  await stopProcessTree(Object.assign(runningChild(), { exitCode: 0 }), {
    platform: 'win32',
    run,
  });
  await stopProcessTree(Object.assign(runningChild(), { pid: undefined }), {
    platform: 'win32',
    run,
  });
  assert.deepEqual(calls, []);
});

test('Windows cleanup propagates taskkill failures while the child is alive', async () => {
  const failure = new Error('taskkill failed');
  await assert.rejects(
    stopProcessTree(runningChild(), {
      platform: 'win32',
      run: async () => {
        throw failure;
      },
    }),
    (error) => error === failure,
  );
});

test('stopProcessTree terminates a real owned server', async (context) => {
  const child = spawnCommand(
    [
      process.execPath,
      '-e',
      'console.log("ready"); setInterval(() => {}, 1000);',
    ],
    {
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  context.after(() => stopProcessTree(child));
  await once(child.stdout, 'data');
  await stopProcessTree(child);
  assert.notEqual(child.exitCode ?? child.signalCode, null);
});
