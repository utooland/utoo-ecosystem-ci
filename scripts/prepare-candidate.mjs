#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { runCommand } from '../src/process.mjs';

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!['--source', '--out'].includes(flag) || !value) {
      throw new Error('Usage: prepare-candidate.mjs --source <utoo> --out <dir>');
    }
    result[flag.slice(2)] = path.resolve(value);
  }
  if (!result.source || !result.out) {
    throw new Error('Both --source and --out are required');
  }
  return result;
}

async function capture(command, cwd) {
  const { stdout } = await runCommand(command, { cwd, capture: true });
  return stdout.trim();
}

function checksum(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

async function pack(source, temporary, packagePath, targetName) {
  const stdout = await capture(
    [
      'npm',
      'pack',
      '--ignore-scripts',
      '--json',
      '--pack-destination',
      temporary,
      packagePath,
    ],
    source,
  );
  const result = JSON.parse(stdout);
  if (!Array.isArray(result) || !result[0]?.filename) {
    throw new Error(`Unexpected npm pack output for ${packagePath}: ${stdout}`);
  }
  const from = path.join(temporary, result[0].filename);
  const to = path.join(path.dirname(temporary), targetName);
  fs.copyFileSync(from, to);
  return { file: targetName, sha256: checksum(to), size: fs.statSync(to).size };
}

async function main() {
  const { source, out } = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(path.join(source, 'packages/pack/package.json'))) {
    throw new Error(`Not an utoo source checkout: ${source}`);
  }

  fs.mkdirSync(out, { recursive: true });
  const temporary = fs.mkdtempSync(path.join(out, '.pack-'));
  try {
    await runCommand(
      ['npm', 'run', 'build:local', '--workspace', '@utoo/pack'],
      { cwd: source },
    );
    const packShared = await pack(
      source,
      temporary,
      'packages/pack-shared',
      'utoo-pack-shared.tgz',
    );
    const packPackage = await pack(
      source,
      temporary,
      'packages/pack',
      'utoo-pack.tgz',
    );
    const commit = await capture(['git', 'rev-parse', 'HEAD'], source);
    const metadata = {
      commit,
      createdAt: new Date().toISOString(),
      packages: {
        '@utoo/pack': packPackage,
        '@utoo/pack-shared': packShared,
      },
    };
    fs.writeFileSync(
      path.join(out, 'metadata.json'),
      `${JSON.stringify(metadata, null, 2)}\n`,
    );
    console.log(JSON.stringify(metadata, null, 2));
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

await main();
