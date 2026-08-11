import assert from 'node:assert/strict';
import test from 'node:test';
import { SUITE_NAMES, SUITES } from '../src/suites.mjs';

test('defines the four requested suites', () => {
  assert.deepEqual(SUITE_NAMES, ['umi', 'ant-design-pro', 'father', 'dumi']);
});

test('all suites use explicit repositories, refs, commands, and output checks', () => {
  for (const suite of Object.values(SUITES)) {
    assert.match(suite.repository, /^[\w.-]+\/[\w.-]+$/);
    assert.equal(suite.ref, 'master');
    assert.ok(suite.install.length > 0);
    assert.ok(suite.test.length > 0);
    assert.ok(suite.nonEmptyDirectories.length > 0);
  }
});
