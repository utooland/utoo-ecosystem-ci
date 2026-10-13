import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const NODE_CLI_PATHS = {
  npm: ['npm', 'bin', 'npm-cli.js'],
  npx: ['npm', 'bin', 'npx-cli.js'],
  corepack: ['corepack', 'dist', 'corepack.js'],
};

export function resolveCommand(
  command,
  {
    platform = process.platform,
    execPath = process.execPath,
    env = process.env,
    existsSync = fs.existsSync,
  } = {},
) {
  const [executable, ...args] = command;
  if (platform !== 'win32') return command;

  const commandName = path.win32.basename(executable).toLowerCase();
  const cliName = commandName.replace(/\.cmd$/, '');
  const cliPath = NODE_CLI_PATHS[cliName];
  if (!cliPath) {
    if (commandName.endsWith('.cmd')) {
      throw new Error(
        `Cannot run ${executable} without a shell; use its Node.js CLI entry point`,
      );
    }
    return command;
  }

  const searchPath = env.PATH ?? env.Path ?? '';
  const directories = [
    ...(path.win32.isAbsolute(executable)
      ? [path.win32.dirname(executable)]
      : []),
    path.win32.dirname(execPath),
    ...searchPath.split(';').filter(Boolean),
  ];
  for (const directory of new Set(directories)) {
    const entryPoint = path.win32.join(directory, 'node_modules', ...cliPath);
    if (existsSync(entryPoint)) return [execPath, entryPoint, ...args];
  }

  throw new Error(
    `Could not find the Node.js CLI entry point for ${executable} beside Node.js or on PATH`,
  );
}

export function spawnCommand(command, options = {}) {
  const {
    platform = process.platform,
    execPath = process.execPath,
    existsSync = fs.existsSync,
    env = {},
    spawnImpl = spawn,
    ...spawnOptions
  } = options;
  const childEnv = { ...process.env, ...env };
  const [executable, ...args] = resolveCommand(command, {
    platform,
    execPath,
    existsSync,
    env: childEnv,
  });
  return spawnImpl(executable, args, {
    ...spawnOptions,
    env: childEnv,
    shell: false,
  });
}

export function formatCommand(command) {
  return command
    .map((part) => (/^[\w./:@=+-]+$/.test(part) ? part : JSON.stringify(part)))
    .join(' ');
}

export async function runCommand(command, options = {}) {
  const {
    cwd = process.cwd(),
    env = {},
    capture = false,
    ...spawnOptions
  } = options;
  const label = `${cwd} $ ${formatCommand(command)}`;
  console.log(`\n${label}`);

  const child = spawnCommand(command, {
    ...spawnOptions,
    cwd,
    env,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });

  let stdout = '';
  let stderr = '';
  if (capture) {
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
  }

  const result = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });

  if (result.code !== 0) {
    if (capture && stderr) process.stderr.write(stderr);
    throw new Error(
      `${formatCommand(command)} failed with ${
        result.signal ? `signal ${result.signal}` : `exit code ${result.code}`
      }`,
    );
  }

  return { stdout, stderr };
}

function exited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForExit(child, timeout) {
  if (exited(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const onClose = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      child.off('close', onClose);
      resolve(false);
    }, timeout);
    child.once('close', onClose);
  });
}

export async function stopProcessTree(
  child,
  {
    platform = process.platform,
    timeout = 5_000,
    run = runCommand,
    kill = process.kill,
  } = {},
) {
  if (!Number.isSafeInteger(child.pid) || child.pid <= 0 || exited(child))
    return;

  if (platform === 'win32') {
    try {
      await run(['taskkill.exe', '/PID', String(child.pid), '/T', '/F'], {
        capture: true,
      });
    } catch (error) {
      // The server may exit between the readiness failure and taskkill.
      if (!exited(child)) throw error;
    }
    if (!(await waitForExit(child, timeout))) {
      throw new Error(`Process tree ${child.pid} did not exit after taskkill`);
    }
    return;
  }

  try {
    kill(-child.pid, 'SIGTERM');
    if (!(await waitForExit(child, timeout))) {
      kill(-child.pid, 'SIGKILL');
      await waitForExit(child, timeout);
    }
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}
