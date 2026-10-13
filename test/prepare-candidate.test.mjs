import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  parseArgs,
  prepareCandidate,
  resolvePackageDirectory,
  validateWindowsBinding,
} from '../scripts/prepare-candidate.mjs';

test('resolves npm pack targets as local absolute package directories', () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'utoopack-candidate-'));
  const packageDirectory = path.join(source, 'packages', 'pack');

  try {
    fs.mkdirSync(packageDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(packageDirectory, 'package.json'),
      '{"name":"@utoo/pack"}\n',
    );

    assert.equal(
      resolvePackageDirectory(source, 'packages/pack'),
      packageDirectory,
    );
    assert.throws(
      () => resolvePackageDirectory(source, 'packages/missing'),
      /Not a package directory/,
    );
  } finally {
    fs.rmSync(source, { recursive: true, force: true });
  }
});

function windowsBinding(machine = 0x8664) {
  const binary = Buffer.alloc(128);
  binary.writeUInt16LE(0x5a4d, 0);
  binary.writeUInt32LE(64, 60);
  binary.writeUInt32LE(0x4550, 64);
  binary.writeUInt16LE(machine, 68);
  return binary;
}

test('accepts only nonempty AMD64 PE files named for the Windows binding', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'utoopack-binding-'));
  const binding = path.join(directory, 'pack.win32-x64-msvc.node');
  try {
    assert.throws(
      () =>
        validateWindowsBinding(path.join(directory, 'pack.linux-x64-gnu.node')),
      /Windows binding/,
    );
    fs.writeFileSync(binding, '');
    assert.throws(() => validateWindowsBinding(binding), /Empty or invalid/);
    fs.writeFileSync(binding, Buffer.alloc(128));
    assert.throws(() => validateWindowsBinding(binding), /PE Windows binding/);
    fs.writeFileSync(binding, windowsBinding(0xaa64));
    assert.throws(() => validateWindowsBinding(binding), /AMD64/);
    const invalidOffset = windowsBinding();
    invalidOffset.writeUInt32LE(1024, 60);
    fs.writeFileSync(binding, invalidOffset);
    assert.throws(() => validateWindowsBinding(binding), /PE Windows binding/);
    fs.writeFileSync(binding, windowsBinding());
    assert.deepEqual(
      parseArgs([
        '--source',
        directory,
        '--out',
        directory,
        '--binding',
        binding,
      ]),
      {
        source: directory,
        out: directory,
        binding,
      },
    );
    assert.equal(validateWindowsBinding(binding).size, 128);
    assert.throws(
      () => parseArgs(['--source', directory, '--out', directory, '--binding']),
      /Usage/,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function createSource(directory) {
  const source = path.join(directory, 'source');
  fs.mkdirSync(source);
  fs.writeFileSync(
    path.join(source, 'package.json'),
    JSON.stringify({ private: true, workspaces: ['packages/*'] }),
  );
  for (const name of ['pack', 'pack-shared']) {
    const packageDirectory = path.join(source, 'packages', name);
    fs.mkdirSync(packageDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(packageDirectory, 'package.json'),
      JSON.stringify({
        name: `@utoo/${name}`,
        version: '0.0.1',
        files: ['cjs', 'esm'],
        scripts: {
          build: 'node ../../build.mjs shared',
          'build:js': 'node ../../build.mjs js',
          'build:local': 'node ../../build.mjs local',
          prepack:
            'node -e "throw new Error(\'npm pack must ignore scripts\')"',
        },
      }),
    );
  }
  fs.writeFileSync(
    path.join(source, 'build.mjs'),
    `
    import fs from 'node:fs';
    import path from 'node:path';
    import { fileURLToPath } from 'node:url';
    const root = path.dirname(fileURLToPath(import.meta.url));
    const mode = process.argv[2];
    fs.appendFileSync(path.join(root, 'builds.txt'), mode + '\\n');
    for (const name of mode === 'local' ? ['pack', 'pack-shared'] : [mode === 'shared' ? 'pack-shared' : 'pack']) {
      for (const output of ['cjs', 'esm']) {
        const directory = path.join(root, 'packages', name, output);
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(path.join(directory, 'index.js'), 'module.exports = {};\\n');
      }
    }
  `,
  );
  execFileSync('git', ['init', '--quiet', source]);
  execFileSync('git', [
    '-C',
    source,
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--allow-empty',
    '--quiet',
    '-m',
    'fixture',
  ]);
  return source;
}

test('packs a supplied Windows binding into both module formats without a host native build', async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'utoopack-windows-package-'),
  );
  try {
    const source = createSource(directory);
    const binding = path.join(directory, 'pack.win32-x64-msvc.node');
    fs.writeFileSync(binding, windowsBinding());
    const out = path.join(directory, 'artifacts');
    const metadata = await prepareCandidate({ source, out, binding });
    assert.equal(
      fs.readFileSync(path.join(source, 'builds.txt'), 'utf8'),
      'shared\njs\n',
    );
    assert.equal(metadata.platform, 'win32');
    assert.equal(metadata.target, 'x86_64-pc-windows-msvc');
    assert.deepEqual(metadata.nativeBinding, validateWindowsBinding(binding));
    assert.equal(
      metadata.commit,
      execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], {
        encoding: 'utf8',
      }).trim(),
    );
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(out, 'metadata.json'), 'utf8')),
      metadata,
    );
    const archive = path.join(out, 'utoo-pack.tgz');
    const files = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' });
    for (const format of ['cjs', 'esm']) {
      const file = `package/${format}/pack.win32-x64-msvc.node`;
      assert(files.includes(file));
      assert.deepEqual(
        execFileSync('tar', ['-xOf', archive, file]),
        windowsBinding(),
      );
    }
    assert(!files.includes('pack.linux') && !files.includes('pack.darwin'));
    assert(!fs.readdirSync(out).some((file) => file.startsWith('.pack-')));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('keeps the existing local build path when no binding is supplied', async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'utoopack-host-package-'),
  );
  try {
    const source = createSource(directory);
    const metadata = await prepareCandidate({
      source,
      out: path.join(directory, 'artifacts'),
    });
    assert.equal(
      fs.readFileSync(path.join(source, 'builds.txt'), 'utf8'),
      'local\n',
    );
    assert(!Object.hasOwn(metadata, 'platform'));
    assert(!Object.hasOwn(metadata, 'nativeBinding'));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
