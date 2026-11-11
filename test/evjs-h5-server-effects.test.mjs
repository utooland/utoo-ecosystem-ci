import assert from 'node:assert/strict';
import test from 'node:test';
import { verifySsrPages } from '../scripts/evjs-h5-server-effects.mjs';

test('SSR regression checks both nested pages without executing browser JavaScript', async () => {
  const requested = [];
  await verifySsrPages('http://127.0.0.1:3000/', async (url) => {
    requested.push(url.pathname);
    const name = url.pathname.includes('first') ? 'first' : 'second';
    return {
      status: 200,
      text: async () => `<p>${name}: shared server content</p><p data-testid="render-origin">server</p><p data-testid="server-cookie">ecosystem=${name}</p>`,
    };
  });
  assert.deepEqual(requested, ['/effects/first.html', '/effects/second.html']);
});

test('SSR regression rejects successful client shells and failing responses', async () => {
  await assert.rejects(
    verifySsrPages('http://localhost/', async () => ({
      status: 200,
      text: async () => '<div id="app"></div><script src="/client.js"></script>',
    })),
    /shared server content/,
  );
  await assert.rejects(
    verifySsrPages('http://localhost/', async () => ({ status: 500 })),
    /must return HTTP 200/,
  );
});
