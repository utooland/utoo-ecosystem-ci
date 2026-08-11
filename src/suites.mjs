const pnpm = (...args) => ['corepack', 'pnpm', ...args];

export const SUITES = Object.freeze({
  umi: {
    title: 'Umi',
    repository: 'umijs/umi',
    ref: 'master',
    packageManager: 'pnpm',
    install: [pnpm('install', '--no-frozen-lockfile')],
    test: [
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
      pnpm('--dir', 'examples/with-antd-5', 'build'),
      pnpm('--dir', 'examples/with-utoopack-emotion', 'build'),
      pnpm('--dir', 'examples/with-utoopack-externals', 'build'),
      pnpm('--dir', 'examples/with-react-19', 'build'),
    ],
    nonEmptyDirectories: [
      'examples/with-antd-5/dist',
      'examples/with-utoopack-emotion/dist',
      'examples/with-utoopack-externals/dist',
      'examples/with-react-19/dist',
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
      pnpm('build'),
      pnpm('--dir', 'examples/utoo-pack', 'build'),
    ],
    nonEmptyDirectories: ['examples/utoo-pack/dist'],
  },
  dumi: {
    title: 'Dumi',
    repository: 'umijs/dumi',
    ref: 'master',
    packageManager: 'pnpm',
    install: [
      pnpm('install', '--no-frozen-lockfile', '--ignore-scripts'),
      ['rustup', 'toolchain', 'install', 'nightly', '--profile', 'minimal'],
      ['rustup', 'target', 'add', 'wasm32-wasip1', '--toolchain', 'nightly'],
    ],
    test: [
      {
        command: pnpm('build'),
        env: { RUSTUP_TOOLCHAIN: 'nightly' },
      },
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
        '--project=utoopack-scaffold',
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
