import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const workflow = fs.readFileSync('.github/workflows/ecosystem-ci.yml', 'utf8');
const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));

const pinnedUtooVersion = manifest.packageManager?.match(/^utoo@(.+)$/)?.[1];
assert.ok(pinnedUtooVersion, 'packageManager must pin an exact Utoo version');
const setupUtooVersions = [
  ...workflow.matchAll(/utoo-version:\s*([^\s#]+)/g),
].map((match) => match[1]);
assert.ok(setupUtooVersions.length > 0, 'workflow must set up Utoo');
for (const version of setupUtooVersions) {
  assert.equal(
    version,
    pinnedUtooVersion,
    'setup-utoo versions must match the project packageManager pin',
  );
}

const allSuites = [
  'umi',
  'ant-design-pro',
  'ant-design',
  'father',
  'dumi',
  'evjs',
  'evjs-shared-runtime',
];
for (const suite of allSuites) {
  assert.match(workflow, new RegExp(`- ${suite.replace('-', '\\-')}(?:\\n|$)`));
}

assert.ok(
  workflow.includes(`all) matrix='${JSON.stringify(allSuites)}' ;;`),
  `all must select exactly ${allSuites.join(', ')}`,
);
assert.doesNotMatch(workflow, /^\s+- release$/m, 'manual runs must not offer a separate release selector');

for (const line of workflow.split('\n')) {
  const match = line.match(/uses:\s+([^\s@]+)@([^\s#]+)/);
  if (!match || match[1].startsWith('./')) continue;
  assert.match(
    match[2],
    /^[a-f0-9]{40}$/,
    `External action must be pinned to a full commit SHA: ${line.trim()}`,
  );
}

assert.match(workflow, /workflow_dispatch:/);
assert.match(workflow, /workflow_call:/);
assert.match(workflow, /schedule:/);
assert.match(workflow, /repository_dispatch:/);
assert.doesNotMatch(
  workflow,
  /candidate\/utoo\/package-lock\.json/,
  'The utoo source checkout does not contain a root package-lock.json',
);
assert.match(workflow, /- name: Enable Corepack\n\s+run: corepack enable/);
checkWindowsCoverage(workflow);
console.log('Workflow policy checks passed');

// Read only the repository's job and step blocks; shell behavior is checked
// directly below, without adding a YAML dependency to the harness.
function blocks(source, pattern) {
  const matches = [...source.matchAll(pattern)];
  return matches.map((match, index) => ({
    name: match[1],
    source: source.slice(match.index, matches[index + 1]?.index),
  }));
}

function scalar(source, indent, key) {
  const value = source.match(
    new RegExp('^ {' + indent + '}' + key + ':\\s*([^\\n]+)', 'm'),
  )?.[1].trim();
  return value?.replace(/^(['"])(.*)\1$/, '$2');
}

function steps(job) {
  return blocks(job, /^ {6}- (?:name|uses):\s*(.+)$/gm);
}

function actionStep(job, action) {
  const step = steps(job).find(({ source }) =>
    new RegExp('^(?: {6}- | {8})uses: ' + action + '@', 'm').test(source),
  );
  assert.ok(step, 'Missing workflow action: ' + action);
  return step.source;
}

function runScript(step) {
  const match = step.match(/^ {8}run: \|\n((?: {10}[^\n]*\n|\n)+)/m);
  assert.ok(match, 'Policy checks require an explicit Bash run block');
  return match[1].replace(/^ {10}/gm, '');
}

function runBash(script, env) {
  const result = spawnSync('bash', ['--noprofile', '--norc', '-c', script], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, 'Workflow policy script must finish normally');
  return result;
}

function checkWindowsCoverage(source) {
  const jobsStart = source.match(/^jobs:\s*$/m)?.index;
  assert.notEqual(jobsStart, undefined, 'The workflow must define jobs');
  const jobs = new Map(
    blocks(source.slice(jobsStart), /^ {2}([\w-]+):\s*$/gm).map((job) => [
      job.name,
      job.source,
    ]),
  );
  const requiredJob = (name) => {
    const job = jobs.get(name);
    assert.ok(job, 'Missing required workflow job: ' + name);
    return job;
  };
  const config = requiredJob('config');
  const linuxPreparation = requiredJob('prepare_candidate');
  const windowsPreparation = requiredJob('prepare_windows_candidate');
  const windows = requiredJob('windows_umi');
  const aggregate = requiredJob('ecosystem_ci_success');

  assert.match(
    scalar(windows, 4, 'runs-on') ?? '',
    /^windows-/,
    'Windows Umi must execute on a real Windows runner',
  );
  const linuxArtifact = scalar(
    actionStep(linuxPreparation, 'actions/upload-artifact'),
    10,
    'name',
  );
  const windowsArtifact = scalar(
    actionStep(windowsPreparation, 'actions/upload-artifact'),
    10,
    'name',
  );
  assert.ok(windowsArtifact, 'Windows preparation must name its artifact');
  assert.notEqual(
    windowsArtifact,
    linuxArtifact,
    'Windows and Linux native candidates must have distinct artifacts',
  );
  assert.equal(
    scalar(actionStep(windows, 'actions/download-artifact'), 10, 'name'),
    windowsArtifact,
    'Windows Umi must consume the Windows candidate artifact',
  );

  const dependencies = scalar(aggregate, 4, 'needs')
    ?.replace(/^\[|\]$/g, '')
    .split(',')
    .map((dependency) => dependency.trim());
  for (const dependency of ['config', 'prepare_windows_candidate', 'windows_umi']) {
    assert.ok(
      dependencies?.includes(dependency),
      'The final gate must depend on ' + dependency,
    );
  }
  const aggregateStep = steps(aggregate).find(({ source }) =>
    /^ {8}run: \|$/m.test(source),
  );
  assert.ok(aggregateStep, 'The final gate must check job results');
  const expectedEnvironment = {
    WINDOWS_SELECTED: '${{ needs.config.outputs.windows_umi }}',
    WINDOWS_PREPARE_RESULT: '${{ needs.prepare_windows_candidate.result }}',
    WINDOWS_UMI_RESULT: '${{ needs.windows_umi.result }}',
    CANDIDATE_MODE: '${{ needs.config.outputs.candidate_mode }}',
  };
  for (const [name, expected] of Object.entries(expectedEnvironment)) {
    assert.equal(
      scalar(aggregateStep.source, 10, name),
      expected,
      'The final gate must read the actual ' + name + ' result',
    );
  }

  checkWindowsSelection(config);
  checkWindowsResults(runScript(aggregateStep.source));
}

function checkWindowsSelection(config) {
  assert.equal(
    scalar(config, 6, 'windows_umi'),
    '${{ steps.resolve.outputs.windows_umi }}',
    'Windows selection must be exported from the resolved configuration',
  );
  const resolve = steps(config).find(({ source }) =>
    /^ {8}id: resolve$/m.test(source),
  );
  assert.ok(resolve, 'The workflow must resolve suite configuration');
  const script = runScript(resolve.source);
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ecosystem-workflow-policy-'),
  );
  const output = path.join(directory, 'outputs');
  try {
    for (const suite of ['all', ...allSuites]) {
      fs.writeFileSync(output, '');
      const result = runBash(script, {
        INPUT_SUITE: suite,
        INPUT_CANDIDATE_MODE: 'source',
        INPUT_PACK_SPEC: 'latest',
        INPUT_UTOO_REPOSITORY: 'utooland/utoo',
        INPUT_UTOO_REF: 'next',
        INPUT_CONSUMER_REF: '',
        INPUT_HARNESS_REPOSITORY: 'utooland/utoo-ecosystem-ci',
        INPUT_HARNESS_REF: 'main',
        PAYLOAD_CONSUMER_REF: '',
        GITHUB_OUTPUT: output,
      });
      assert.equal(
        result.status,
        0,
        'Suite configuration failed: ' + suite + '\n' + result.stderr,
      );
      const selected = fs.readFileSync(output, 'utf8')
        .match(/^windows_umi=(.*)$/m)?.[1];
      assert.equal(
        selected,
        suite === 'all' || suite === 'umi' ? 'true' : 'false',
        'Windows coverage selection is wrong for suite ' + suite,
      );
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function checkWindowsResults(script) {
  const scenarios = [
    ['source', 'true', 'success', 'success', true],
    ['npm', 'true', 'skipped', 'success', true],
    ['source', 'false', 'skipped', 'skipped', true],
    ['source', 'true', 'failure', 'success', false],
    ['source', 'true', 'skipped', 'success', false],
    ['npm', 'true', 'success', 'success', false],
    ['source', 'false', 'skipped', 'success', false],
  ];
  for (const status of ['failure', 'cancelled', 'skipped']) {
    scenarios.push(['source', 'true', 'success', status, false]);
    scenarios.push(['npm', 'true', 'skipped', status, false]);
  }
  for (const [mode, selected, preparation, windows, expectedSuccess] of scenarios) {
    const result = runBash(script, {
      CONFIG_RESULT: 'success',
      PREPARE_RESULT: mode === 'source' ? 'success' : 'skipped',
      HARNESS_RESULT: 'success',
      ECOSYSTEM_RESULT: 'success',
      CANDIDATE_MODE: mode,
      WINDOWS_SELECTED: selected,
      WINDOWS_PREPARE_RESULT: preparation,
      WINDOWS_UMI_RESULT: windows,
    });
    assert.equal(
      result.status === 0,
      expectedSuccess,
      'The final gate mishandles Windows results: ' +
        [mode, selected, preparation, windows].join('/') + '\n' + result.stderr,
    );
  }
}
