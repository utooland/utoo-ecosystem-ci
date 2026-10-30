import { defineConfig } from '@evjs/ev';

export default defineConfig({
  routing: { mode: 'mpa' },
  target: { android: 5, ios: 8 },
});
