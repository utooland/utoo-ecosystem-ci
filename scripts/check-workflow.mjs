import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync('.github/workflows/ecosystem-ci.yml', 'utf8');
const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));

const pinnedUtooVersion = manifest.packageManager?.match(/^utoo@(.+)$/)?.[1];
assert.ok(pinnedUtooVersion, 'packageManager must pin an exact Utoo version');
assert.deepEqual(
  [...workflow.matchAll(/utoo-version:\s*([^\s#]+)/g)].map((match) => match[1]),
  [pinnedUtooVersion, pinnedUtooVersion],
  'setup-utoo versions must match the project packageManager pin',
);

for (const suite of ['umi', 'ant-design-pro', 'father', 'dumi', 'evjs']) {
  assert.match(workflow, new RegExp(`- ${suite.replace('-', '\\-')}(?:\\n|$)`));
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
