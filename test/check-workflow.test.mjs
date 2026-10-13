import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const checker = fileURLToPath(
  new URL('../scripts/check-workflow.mjs', import.meta.url),
);
const workflow = fs.readFileSync(
  new URL('../.github/workflows/ecosystem-ci.yml', import.meta.url),
  'utf8',
);

function check(context, source) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-check-test-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, '.github/workflows'), { recursive: true });
  fs.writeFileSync(
    path.join(directory, '.github/workflows/ecosystem-ci.yml'),
    source,
  );
  fs.writeFileSync(
    path.join(directory, 'package.json'),
    '{"packageManager":"utoo@1.1.8"}',
  );
  return spawnSync(process.execPath, [checker], {
    cwd: directory,
    encoding: 'utf8',
    timeout: 20_000,
  });
}

function rejected(context, source, message) {
  assert.notEqual(source, workflow, 'The policy fixture must change the workflow');
  const result = check(context, source);
  assert.ifError(result.error);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, message);
}

test('workflow policy accepts required Windows source and npm coverage', (context) => {
  const result = check(context, workflow);
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});

test('workflow policy rejects a Windows lane moved to Linux', (context) => {
  rejected(
    context,
    workflow.replace('runs-on: windows-2022', 'runs-on: ubuntu-latest'),
    /Windows Umi must execute on a real Windows runner/,
  );
});

test('workflow policy rejects consuming the Linux native artifact on Windows', (context) => {
  rejected(
    context,
    workflow.replace(
      /(^  windows_umi:[\s\S]*?)name: utoopack-windows-candidate/m,
      '$1name: utoopack-candidate',
    ),
    /Windows Umi must consume the Windows candidate artifact/,
  );
});

test('workflow policy rejects an aggregate that does not wait for Windows', (context) => {
  rejected(
    context,
    workflow.replace('ecosystem, windows_umi]', 'ecosystem]'),
    /The final gate must depend on windows_umi/,
  );
});

test('workflow policy rejects an aggregate that passes without Windows success', (context) => {
  rejected(
    context,
    workflow.replace(/^ {12}\[\[ "\$WINDOWS_UMI_RESULT" == success \]\].*\n/m, ''),
    /The final gate mishandles Windows results/,
  );
});

test('workflow policy rejects silently deselecting Windows for all and umi', (context) => {
  rejected(
    context,
    workflow.replace('            windows_umi=true', '            windows_umi=false'),
    /Windows coverage selection is wrong for suite all/,
  );
});
