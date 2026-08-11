import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync('.github/workflows/ecosystem-ci.yml', 'utf8');

for (const suite of ['umi', 'ant-design-pro', 'father', 'dumi']) {
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
console.log('Workflow policy checks passed');
