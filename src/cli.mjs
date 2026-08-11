#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { normalizeDependencySpec, patchConsumerManifest } from './manifest.mjs';
import { formatCommand, runCommand } from './process.mjs';
import { getSuite, SUITE_NAMES, SUITES } from './suites.mjs';

export function parseArgs(argv) {
  const options = {
    dryRun: false,
    keep: false,
    list: false,
    workspace: path.resolve('workspace'),
  };

  const valueOptions = new Map([
    ['--suite', 'suite'],
    ['--pack', 'pack'],
    ['--pack-shared', 'packShared'],
    ['--ref', 'ref'],
    ['--repo', 'repo'],
    ['--workspace', 'workspace'],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--keep') {
      options.keep = true;
    } else if (arg === '--list') {
      options.list = true;
    } else if (valueOptions.has(arg)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${arg} requires a value`);
      }
      options[valueOptions.get(arg)] = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  options.workspace = path.resolve(options.workspace);
  return options;
}

function repositoryUrl(repository) {
  return repository.includes('://') || repository.includes(':')
    ? repository
    : `https://github.com/${repository}.git`;
}

async function cloneAtRef(repository, ref, destination) {
  await runCommand([
    'git',
    'clone',
    '--filter=blob:none',
    '--no-checkout',
    repositoryUrl(repository),
    destination,
  ]);
  await runCommand(
    ['git', 'fetch', '--depth=1', '--no-tags', 'origin', ref],
    { cwd: destination },
  );
  await runCommand(['git', 'checkout', '--detach', 'FETCH_HEAD'], {
    cwd: destination,
  });
}

function commandShape(item) {
  return Array.isArray(item) ? { command: item, env: {} } : item;
}

function assertNonEmptyDirectories(repoDir, directories) {
  for (const relative of directories) {
    const directory = path.join(repoDir, relative);
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
      throw new Error(`Expected output directory was not created: ${relative}`);
    }
    if (fs.readdirSync(directory).length === 0) {
      throw new Error(`Expected output directory is empty: ${relative}`);
    }
    console.log(`Verified output: ${relative}`);
  }
}

function getInstalledPack(repoDir) {
  const requireFromConsumer = createRequire(path.join(repoDir, 'package.json'));
  const manifest = requireFromConsumer.resolve('@utoo/pack/package.json');
  const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  return { manifest, version: pkg.version };
}

export function selectNpmViewVersion(stdout) {
  const value = JSON.parse(stdout);
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value.at(-1) === 'string') {
    return value.at(-1);
  }
  throw new Error(`Unexpected npm view output: ${stdout}`);
}

async function resolveRegistrySpec(name, spec) {
  if (spec.startsWith('file:')) return spec;
  const { stdout } = await runCommand(
    ['npm', 'view', `${name}@${spec}`, 'version', '--json'],
    { capture: true },
  );
  const version = selectNpmViewVersion(stdout);
  console.log(`Resolved ${name}@${spec} to ${version}`);
  return version;
}

async function getCommit(repoDir) {
  const { stdout } = await runCommand(['git', 'rev-parse', 'HEAD'], {
    cwd: repoDir,
    capture: true,
  });
  return stdout.trim();
}

function appendSummary({ name, suite, repository, ref, commit, pack }) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  const body = [
    `## ${suite.title} utoopack ecosystem CI`,
    '',
    `- Suite: \`${name}\``,
    `- Consumer: \`${repository}@${ref}\``,
    `- Consumer commit: \`${commit}\``,
    `- @utoo/pack: \`${pack.version}\``,
    `- Resolved from: \`${pack.manifest}\``,
    '',
  ].join('\n');
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, body);
}

export async function run(options) {
  if (options.list) {
    for (const name of SUITE_NAMES) {
      const suite = SUITES[name];
      console.log(`${name}\t${suite.repository}@${suite.ref}`);
    }
    return;
  }

  if (!options.suite) throw new Error('Missing required --suite');
  if (!options.pack) throw new Error('Missing required --pack');

  const suite = getSuite(options.suite);
  const repository = options.repo ?? suite.repository;
  const ref = options.ref ?? suite.ref;
  let packSpec = normalizeDependencySpec(options.pack);
  let packSharedSpec = normalizeDependencySpec(
    options.packShared ?? options.pack,
  );
  const repoDir = path.join(options.workspace, options.suite);

  if (options.dryRun) {
    console.log(
      JSON.stringify(
        {
          suite: options.suite,
          repository,
          ref,
          repoDir,
          packSpec,
          packSharedSpec,
          commands: [...suite.install, ...suite.test].map(
            (item) => formatCommand(commandShape(item).command),
          ),
        },
        null,
        2,
      ),
    );
    return;
  }

  packSpec = await resolveRegistrySpec('@utoo/pack', packSpec);
  packSharedSpec = await resolveRegistrySpec(
    '@utoo/pack-shared',
    packSharedSpec,
  );

  fs.mkdirSync(options.workspace, { recursive: true });
  if (!options.keep) {
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
  if (!fs.existsSync(repoDir)) {
    await cloneAtRef(repository, ref, repoDir);
  }

  patchConsumerManifest({ repoDir, suite, packSpec, packSharedSpec });

  const commonEnv = {
    CI: 'true',
    ECOSYSTEM_CI: 'true',
    HUSKY: '0',
    NODE_OPTIONS: '--max-old-space-size=6144',
    ...suite.env,
  };

  for (const item of suite.install) {
    const step = commandShape(item);
    await runCommand(step.command, {
      cwd: repoDir,
      env: { ...commonEnv, ...step.env },
    });
  }

  const pack = getInstalledPack(repoDir);
  console.log(`Using @utoo/pack@${pack.version} from ${pack.manifest}`);
  if (!packSpec.startsWith('file:') && pack.version !== packSpec) {
    throw new Error(
      `Candidate mismatch: requested @utoo/pack@${packSpec}, but installed ${pack.version}`,
    );
  }

  for (const item of suite.test) {
    const step = commandShape(item);
    await runCommand(step.command, {
      cwd: repoDir,
      env: { ...commonEnv, ...step.env },
    });
  }

  assertNonEmptyDirectories(repoDir, suite.nonEmptyDirectories);
  const commit = await getCommit(repoDir);
  appendSummary({
    name: options.suite,
    suite,
    repository,
    ref,
    commit,
    pack,
  });
  console.log(
    `\nPASS ${options.suite}: ${repository}@${commit.slice(0, 12)} with @utoo/pack@${pack.version}`,
  );
}

export async function main(argv = process.argv.slice(2)) {
  try {
    await run(parseArgs(argv));
  } catch (error) {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
