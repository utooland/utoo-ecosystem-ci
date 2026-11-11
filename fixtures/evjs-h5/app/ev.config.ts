import assert from 'node:assert/strict';
import { utoopack } from '@evjs/bundler-utoopack';
import { defineConfig } from '@evjs/ev';
import { definePlugin } from '@evjs/ev/plugin';

const serverEntriesRegression = definePlugin({
  id: 'ecosystem-server-entries',
  setup() {
    return {
      configureBundler: utoopack((config) => {
        const entries = config.server?.entry;
        assert.ok(Array.isArray(entries), 'SSR pages must produce named server entries');
        assert.deepEqual(entries.map((entry) => entry.name).sort(), [
          'page-server-effects__first',
          'page-server-effects__second',
          'server',
        ]);
        if (config.mode === 'development') {
          assert.equal(config.sourceMaps, true, 'The dev regression requires source maps');
          assert.ok(config.server?.function?.clientProxy, 'The fixture must enable server functions');
          console.log('ECOSYSTEM_SSR_ENTRIES_READY:3:sourceMaps=true');
        }
      }),
    };
  },
});

export default defineConfig({
  routing: { mode: 'mpa' },
  target: { android: 5, ios: 8 },
  plugins: [serverEntriesRegression()],
});
