import { fileURLToPath } from 'node:url';

const pnpm = (...args) => ['corepack', 'pnpm', ...args];
const ut = (...args) => ['ut', ...args];
const umiUtoopackE2E = fileURLToPath(
  new URL('../scripts/umi-utoopack-e2e.mjs', import.meta.url),
);
const prepareDumiExample = fileURLToPath(
  new URL('../scripts/prepare-dumi-example.mjs', import.meta.url),
);
const evjsUtoopackDevSmoke = fileURLToPath(
  new URL('../scripts/evjs-utoopack-dev-smoke.mjs', import.meta.url),
);
const utoopackDevServerSmoke = fileURLToPath(
  new URL('../scripts/utoopack-dev-server-smoke.mjs', import.meta.url),
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
    // Utoo reads the existing npm lockfile while installing the patched
    // candidate, avoiding a full cold npm resolution of this large graph.
    install: [ut('install')],
    test: [
      ['npm', 'run', 'build'],
      {
        command: [
          'node',
          utoopackDevServerSmoke,
          '--url',
          'http://127.0.0.1:9528/',
          '--',
          'npm',
          'run',
          'dev',
        ],
        env: {
          NODE_ENV: 'development',
          PORT: '9528',
        },
      },
    ],
    nonEmptyDirectories: ['dist'],
    env: {
      NODE_ENV: 'test',
      PROGRESS: 'none',
    },
  },
  'ant-design': {
    title: 'Ant Design',
    repository: 'ant-design/ant-design',
    // Keep this pinned to the public reproduction from utooland/utoo#3332.
    ref: '7793cab03924d29db45d64dadc1c81d0a8cf59e0',
    packageManager: 'npm',
    // The reproduction intentionally starts from a fresh dependency graph;
    // this commit does not contain an npm or pnpm lockfile.
    install: [ut('install')],
    test: [
      // Ant Design's documentation site enables utoopack in .dumirc.ts for
      // both production and development. npm run site is its production Dumi
      // build, while npm start is the exact dev command from issue #3332.
      ['npm', 'run', 'site'],
      {
        command: [
          'node',
          utoopackDevServerSmoke,
          '--url',
          'http://127.0.0.1:8001/',
          '--',
          'npm',
          'start',
        ],
      },
    ],
    nonEmptyDirectories: ['_site'],
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
      // Build the local Dumi source, then validate it with a minimal site based
      // on Dumi's official site template. The fixture intentionally has no
      // React demos, so the signal stays focused on Dumi + utoopack and does
      // not spend tens of minutes compiling Dumi's auxiliary SWC demo plugin.
      pnpm('exec', 'father', 'build'),
      ['node', prepareDumiExample],
      pnpm('--dir', 'examples/utoopack-ecosystem-ci', 'build'),
      {
        command: [
          'node',
          utoopackDevServerSmoke,
          '--cwd',
          'examples/utoopack-ecosystem-ci',
          '--url',
          'http://127.0.0.1:9529/',
          '--',
          'corepack',
          'pnpm',
          'dev',
        ],
        env: {
          NODE_ENV: 'development',
          PORT: '9529',
        },
      },
    ],
    nonEmptyDirectories: ['examples/utoopack-ecosystem-ci/dist'],
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
      ['node', evjsUtoopackDevSmoke],
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
