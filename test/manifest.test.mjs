import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  normalizeDependencySpec,
  patchConsumerManifest,
} from '../src/manifest.mjs';

test('normalizes package names and local tarballs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utoo-spec-'));
  const tarball = path.join(root, 'pack.tgz');
  fs.writeFileSync(tarball, 'test');
  assert.equal(normalizeDependencySpec('@utoo/pack@latest'), 'latest');
  assert.equal(normalizeDependencySpec(tarball), `file:${tarball}`);
});

test('patches pnpm root and direct manifests without dropping existing data', () => {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'utoo-pnpm-'));
  const direct = path.join(repoDir, 'packages/bundler/package.json');
  fs.mkdirSync(path.dirname(direct), { recursive: true });
  fs.writeFileSync(
    path.join(repoDir, 'package.json'),
    JSON.stringify({ devDependencies: { keep: '1' }, pnpm: { overrides: { x: '2' } } }),
  );
  fs.writeFileSync(direct, JSON.stringify({ dependencies: { keep: '1' } }));

  patchConsumerManifest({
    repoDir,
    suite: { packageManager: 'pnpm', directManifest: 'packages/bundler/package.json' },
    packSpec: '1.2.3',
    packSharedSpec: '1.2.3',
  });

  const root = JSON.parse(fs.readFileSync(path.join(repoDir, 'package.json')));
  const child = JSON.parse(fs.readFileSync(direct));
  assert.equal(root.devDependencies.keep, '1');
  assert.equal(root.pnpm.overrides.x, '2');
  assert.equal(root.pnpm.overrides['@utoo/pack'], '1.2.3');
  assert.equal(child.dependencies.keep, '1');
  assert.equal(child.dependencies['@utoo/pack'], '1.2.3');
});

test('uses npm overrides for npm consumers', () => {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'utoo-npm-'));
  fs.writeFileSync(path.join(repoDir, 'package.json'), JSON.stringify({ overrides: { x: '1' } }));
  patchConsumerManifest({
    repoDir,
    suite: { packageManager: 'npm' },
    packSpec: 'next',
    packSharedSpec: 'next',
  });
  const pkg = JSON.parse(fs.readFileSync(path.join(repoDir, 'package.json')));
  assert.equal(pkg.overrides.x, '1');
  assert.equal(pkg.overrides['@utoo/pack'], 'next');
  assert.equal(pkg.devDependencies['@utoo/pack-shared'], 'next');
});
