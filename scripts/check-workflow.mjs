import assert from 'node:assert/strict';
import fs from 'node:fs';

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

const dailySuites = [
  'umi',
  'ant-design-pro',
  'ant-design',
  'father',
  'dumi',
  'evjs',
];
for (const suite of [...dailySuites, 'evjs-shared-runtime']) {
  assert.match(workflow, new RegExp(`- ${suite.replace('-', '\\-')}(?:\\n|$)`));
}

assert.match(workflow, /^\s+- release$/m, 'manual runs must offer release');
for (const [suite, members] of [
  ['all', dailySuites],
  ['release', [...dailySuites, 'evjs-shared-runtime']],
]) {
  assert.ok(
    workflow.includes(`${suite}) matrix='${JSON.stringify(members)}' ;;`),
    `${suite} must select exactly ${members.join(', ')}`,
  );
}

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
console.log('Workflow policy checks passed');
