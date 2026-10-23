import fs from 'node:fs';
import path from 'node:path';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function normalizeDependencySpec(input, cwd = process.cwd()) {
  if (!input) {
    throw new Error('The @utoo/pack dependency spec must not be empty');
  }

  let spec = input;
  if (spec.startsWith('@utoo/pack@')) {
    spec = spec.slice('@utoo/pack@'.length);
  } else if (spec.startsWith('@utoo/pack-shared@')) {
    spec = spec.slice('@utoo/pack-shared@'.length);
  } else if (spec.startsWith('@utoo/pack-cli@')) {
    spec = spec.slice('@utoo/pack-cli@'.length);
  }

  if (spec.startsWith('file:')) {
    const file = spec.slice('file:'.length);
    const absolute = path.resolve(cwd, file);
    if (!fs.existsSync(absolute)) {
      throw new Error(`Local package does not exist: ${absolute}`);
    }
    return `file:${absolute}`;
  }

  const isPath =
    path.isAbsolute(spec) ||
    spec.startsWith('./') ||
    spec.startsWith('../') ||
    spec.endsWith('.tgz');
  if (isPath) {
    const absolute = path.resolve(cwd, spec);
    if (!fs.existsSync(absolute)) {
      throw new Error(`Local package does not exist: ${absolute}`);
    }
    return `file:${absolute}`;
  }

  return spec;
}

export function patchConsumerManifest({
  repoDir,
  suite,
  packSpec,
  packSharedSpec,
  packCliSpec,
}) {
  const rootManifest = path.join(repoDir, 'package.json');
  const pkg = readJson(rootManifest);
  const candidates = {
    '@utoo/pack': packSpec,
    '@utoo/pack-shared': packSharedSpec,
    ...(packCliSpec ? { '@utoo/pack-cli': packCliSpec } : {}),
  };

  pkg.devDependencies = {
    ...pkg.devDependencies,
    ...candidates,
  };

  if (suite.packageManager === 'pnpm') {
    pkg.pnpm = pkg.pnpm ?? {};
    pkg.pnpm.overrides = {
      ...pkg.pnpm.overrides,
      ...candidates,
    };
  } else if (suite.packageManager === 'npm') {
    pkg.overrides = {
      ...pkg.overrides,
      ...candidates,
    };
  } else {
    throw new Error(`Unsupported package manager: ${suite.packageManager}`);
  }

  writeJson(rootManifest, pkg);

  if (suite.directManifest) {
    const directManifest = path.join(repoDir, suite.directManifest);
    const directPkg = readJson(directManifest);
    directPkg.dependencies = {
      ...directPkg.dependencies,
      '@utoo/pack': packSpec,
    };
    writeJson(directManifest, directPkg);
  }
}
