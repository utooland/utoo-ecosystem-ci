#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runCommand } from '../src/process.mjs';

export function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (
      !['--source', '--out', '--binding'].includes(flag) ||
      !value ||
      value.startsWith('--')
    ) {
      throw new Error(
        'Usage: prepare-candidate.mjs --source <utoo> --out <dir> [--binding <pack.win32-x64-msvc.node>]',
      );
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
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(file))
    .digest('hex');
}

export function resolvePackageDirectory(source, packagePath) {
  const packageDirectory = path.resolve(source, packagePath);
  if (!fs.existsSync(path.join(packageDirectory, 'package.json'))) {
    throw new Error(`Not a package directory: ${packageDirectory}`);
  }
  return packageDirectory;
}

export function validateWindowsBinding(binding) {
  if (path.basename(binding) !== 'pack.win32-x64-msvc.node') {
    throw new Error('Expected a pack.win32-x64-msvc.node Windows binding');
  }
  const stat = fs.statSync(binding);
  if (!stat.isFile() || stat.size < 64) {
    throw new Error(`Empty or invalid Windows binding: ${binding}`);
  }
  const fd = fs.openSync(binding, 'r');
  try {
    const dos = Buffer.alloc(64);
    fs.readSync(fd, dos, 0, dos.length, 0);
    const peOffset = dos.readUInt32LE(60);
    if (
      dos.readUInt16LE(0) !== 0x5a4d ||
      peOffset < 64 ||
      peOffset + 24 > stat.size
    ) {
      throw new Error(`Expected a PE Windows binding: ${binding}`);
    }
    const pe = Buffer.alloc(24);
    fs.readSync(fd, pe, 0, pe.length, peOffset);
    if (pe.readUInt32LE(0) !== 0x4550 || pe.readUInt16LE(4) !== 0x8664) {
      throw new Error(`Expected an AMD64 PE Windows binding: ${binding}`);
    }
  } finally {
    fs.closeSync(fd);
  }
  return {
    file: path.basename(binding),
    sha256: checksum(binding),
    size: stat.size,
  };
}

async function pack(source, temporary, packagePath, targetName) {
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

export async function prepareCandidate({ source, out, binding }) {
  if (!fs.existsSync(path.join(source, 'packages/pack/package.json'))) {
    throw new Error(`Not an utoo source checkout: ${source}`);
  }
  const nativeBinding = binding ? validateWindowsBinding(binding) : undefined;

  fs.mkdirSync(out, { recursive: true });
  const temporary = fs.mkdtempSync(path.join(out, '.pack-'));
  try {
    if (binding) {
      await runCommand(
        ['npm', 'run', 'build', '--workspace', '@utoo/pack-shared'],
        { cwd: source },
      );
      await runCommand(
        ['npm', 'run', 'build:js', '--workspace', '@utoo/pack'],
        { cwd: source },
      );
      for (const directory of ['cjs', 'esm']) {
        fs.copyFileSync(
          binding,
          path.join(source, 'packages/pack', directory, nativeBinding.file),
        );
      }
    } else {
      await runCommand(
        ['npm', 'run', 'build:local', '--workspace', '@utoo/pack'],
        { cwd: source },
      );
    }
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
      ...(nativeBinding
        ? { platform: 'win32', target: 'x86_64-pc-windows-msvc', nativeBinding }
        : {}),
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
