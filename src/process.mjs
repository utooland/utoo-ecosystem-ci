import { spawn } from 'node:child_process';

export function formatCommand(command) {
  return command
    .map((part) => (/^[\w./:@=+-]+$/.test(part) ? part : JSON.stringify(part)))
    .join(' ');
}

export async function runCommand(command, options = {}) {
  const { cwd = process.cwd(), env = {}, capture = false } = options;
  const [executable, ...args] = command;
  const label = `${cwd} $ ${formatCommand(command)}`;
  console.log(`\n${label}`);

  const child = spawn(executable, args, {
    cwd,
    env: { ...process.env, ...env },
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
