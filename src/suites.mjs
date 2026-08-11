import { fileURLToPath } from 'node:url';

const pnpm = (...args) => ['corepack', 'pnpm', ...args];
const umiUtoopackE2E = fileURLToPath(
  new URL('../scripts/umi-utoopack-e2e.mjs', import.meta.url),
);

export const SUITES = Object.freeze({
  umi: {
    title: 'Umi',
    repository: 'umijs/umi',
    ref: 'master',
    packageManager: 'pnpm',
    install: [pnpm('install', '--no-frozen-lockfile')],
    test: [
      // Mirror Umi's native utoopack E2E workflow: build the local framework
      // packages, launch with-use-model under utoopack, then assert its runtime.
      pnpm(
        'umi-scripts',
        'turbo',
        'build',
        '--filter',
        './packages/umi/...',
        '--filter',
        './packages/plugins/...',
        '--filter',
        './packages/bundler-utoopack/...',
      ),
      pnpm('exec', 'playwright', 'install', 'chromium'),
      ['node', umiUtoopackE2E],
      // Mirror Umi's qiankun E2E workflow, including both its baseline and
      // utoopack-powered qiankun applications.
      pnpm('umi-scripts', 'turbo', 'build', '--filter', './examples/max...'),
      pnpm('--dir', 'examples/qiankun-slave', 'e2e:ci'),
      pnpm('--dir', 'examples/with-utoopack-qiankun-master', 'e2e:ci'),
    ],
    nonEmptyDirectories: [
      'packages/bundler-utoopack/dist',
      'examples/with-utoopack-qiankun-master/dist',
      'examples/with-utoopack-qiankun-slave/dist',
    ],
    directManifest: 'packages/bundler-utoopack/package.json',
  },
  'ant-design-pro': {
    title: 'Ant Design Pro',
    repository: 'ant-design/ant-design-pro',
    ref: 'master',
    packageManager: 'npm',
    // The checkout is disposable, so npm may update its lockfile for the
    // candidate override. Reading the existing lockfile avoids a full cold
    // resolution of Ant Design Pro's large dependency graph.
    install: [['npm', 'install']],
    test: [['npm', 'run', 'build']],
    nonEmptyDirectories: ['dist'],
    env: {
      NODE_ENV: 'test',
      PROGRESS: 'none',
    },
  },
  father: {
    title: 'Father',
    repository: 'umijs/father',
    ref: 'master',
    packageManager: 'pnpm',
    install: [pnpm('install', '--no-frozen-lockfile')],
    test: [
      // Bootstrap the local father binary used by the example. The ecosystem
      // signal itself is the utoopack UMD example build below.
      pnpm('tsc'),
      pnpm('--dir', 'examples/utoo-pack', 'build'),
    ],
    nonEmptyDirectories: ['examples/utoo-pack/dist'],
  },
  dumi: {
    title: 'Dumi',
    repository: 'umijs/dumi',
    ref: 'master',
    packageManager: 'pnpm',
    install: [pnpm('install', '--no-frozen-lockfile', '--ignore-scripts')],
    test: [
      // Build dumi's JavaScript output without its unrelated SWC demo crate.
      pnpm('exec', 'father', 'build'),
      pnpm('--dir', 'examples/normal-utoopack', 'build'),
    ],
    nonEmptyDirectories: ['examples/normal-utoopack/dist'],
  },
  evjs: {
    title: 'EVJS',
    repository: 'afx-team/evjs',
    ref: 'main',
    packageManager: 'npm',
    install: [
      ['npm', 'install'],
      ['npx', 'playwright', 'install', '--with-deps', 'chromium'],
    ],
    test: [
      ['npx', 'turbo', 'build', '--filter=./packages/*'],
      [
        'npm',
        'run',
        'test:e2e',
        '--',
        '--project=utoopack',
      ],
    ],
    nonEmptyDirectories: [
      'examples/basic/dist',
      'examples/plugin-authoring/dist',
    ],
    directManifest: 'packages/bundler-utoopack/package.json',
    candidateResolveFrom: 'packages/bundler-utoopack/package.json',
    // The upstream lockfile contains an old workspace-local @utoo/pack copy.
    // npm keeps that invalid nested install even after the direct manifest is
    // patched, so remove only those generated copies and resolve the candidate
    // from the root override installed above.
    staleCandidateDirectories: [
      'packages/bundler-utoopack/node_modules/@utoo/pack',
      'packages/bundler-utoopack/node_modules/@utoo/pack-shared',
    ],
  },
});

export const SUITE_NAMES = Object.freeze(Object.keys(SUITES));

export function getSuite(name) {
  const suite = SUITES[name];
  if (!suite) {
    throw new Error(
      `Unknown suite "${name}". Available suites: ${SUITE_NAMES.join(', ')}`,
    );
  }
  return suite;
}
