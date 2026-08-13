import { defineConfig, globalIgnores } from '@utoo/lint/config';

export default defineConfig(
  globalIgnores(['candidate-artifacts', 'node_modules', 'workspace']),
  {
    files: [
      'utlint.config.ts',
      'src/**/*.{js,jsx,ts,tsx,mjs,cjs}',
      'scripts/**/*.{js,jsx,ts,tsx,mjs,cjs}',
      'test/**/*.{js,jsx,ts,tsx,mjs,cjs}',
      'fixtures/**/*.{js,jsx,ts,tsx,mjs,cjs}',
    ],
    rules: {
      'no-debugger': 'error',
      'no-unused-vars': 'error',
      'prefer-const': 'error',
      eqeqeq: 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
      'no-constant-condition': 'error',
      'no-dupe-keys': 'error',
      'no-duplicate-imports': 'error',
    },
  },
);
