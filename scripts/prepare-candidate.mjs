#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runCommand } from '../src/process.mjs';

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!['--source', '--out', '--binding'].includes(flag) || !value) {
      throw new Error('Usage: prepare-candidate.mjs --source <utoo> --out <dir> [--binding <pack.win32-x64-msvc.node>]');
    }
    result[flag.slice(2)] = path.resolve(value);
  }
  if (!result.source || !result.out) {
    throw new Error('Both --source and --out are required');
  }
  return result;
}

async function capture(command, cwd, run = runCommand) {
  const { stdout } = await run(command, { cwd, capture: true });
  return stdout.trim();
}

function checksum(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function resolvePackageDirectory(source, packagePath) {
  const packageDirectory = path.resolve(source, packagePath);
  if (!fs.existsSync(path.join(packageDirectory, 'package.json'))) {
    throw new Error(`Not a package directory: ${packageDirectory}`);
  }
  return packageDirectory;
}

async function pack(source, temporary, packagePath, targetName, run) {
  const packageDirectory = resolvePackageDirectory(source, packagePath);
  const stdout = await capture(
    [
      'npm',
      'pack',
      '--ignore-scripts',
      '--json',
      '--pack-destination',
      temporary,
      packageDirectory,
    ],
    source,
    run,
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

export async function prepareCandidate({ source, out, binding }, run = runCommand) {
  if (!fs.existsSync(path.join(source, 'packages/pack/package.json'))) {
    throw new Error(`Not an utoo source checkout: ${source}`);
  }

  fs.mkdirSync(out, { recursive: true });
  const temporary = fs.mkdtempSync(path.join(out, '.pack-'));
  try {
    const builds = binding
      ? [['build', '@utoo/pack-shared'], ['build:js', '@utoo/pack']]
      : [['build:local', '@utoo/pack']];
    for (const [script, workspace] of builds) {
      await run(['npm', 'run', script, '--workspace', workspace], { cwd: source });
    }
    await run(['npm', 'run', 'build', '--workspace', '@utoo/pack-cli'], {
      cwd: source,
    });
    if (binding) {
      for (const directory of ['cjs', 'esm']) {
        fs.copyFileSync(
          binding,
          path.join(source, 'packages/pack', directory, 'pack.win32-x64-msvc.node'),
        );
      }
    }
    const packShared = await pack(
      source,
      temporary,
      'packages/pack-shared',
      'utoo-pack-shared.tgz',
      run,
    );
    const packPackage = await pack(
      source,
      temporary,
      'packages/pack',
      'utoo-pack.tgz',
      run,
    );
    const packCli = await pack(
      source,
      temporary,
      'packages/pack-cli',
      'utoo-pack-cli.tgz',
      run,
    );
    const commit = await capture(['git', 'rev-parse', 'HEAD'], source, run);
    const metadata = {
      commit,
      createdAt: new Date().toISOString(),
      packages: {
        '@utoo/pack': packPackage,
        '@utoo/pack-shared': packShared,
        '@utoo/pack-cli': packCli,
      },
    };
    fs.writeFileSync(
      path.join(out, 'metadata.json'),
      `${JSON.stringify(metadata, null, 2)}\n`,
    );
    console.log(JSON.stringify(metadata, null, 2));
    return metadata;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await prepareCandidate(parseArgs(process.argv.slice(2)));
}
