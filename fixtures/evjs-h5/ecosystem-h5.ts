import { createRequire } from 'node:module';
import { createCsrExampleTest, expect } from '../fixtures';

const test = createCsrExampleTest('ecosystem-h5');

test('candidate supplies the helper required by named RegExp lowering', () => {
  const adapterRequire = createRequire(
    new URL('../../packages/bundler-utoopack/package.json', import.meta.url),
  );
  const candidateRequire = createRequire(adapterRequire.resolve('@utoo/pack/package.json'));
  // Other EVJS development tools may hoist a newer helpers package and rescue
  // the build. Check the candidate's own dependency context as well.
  expect(() => candidateRequire.resolve('@swc/helpers/_/_wrap_reg_exp')).not.toThrow();
});

test('H5 production build resolves and executes SWC regexp helpers', async ({ page, baseURL }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto(baseURL);
  const markdown = page.getByTestId('markdown');
  await expect(markdown.getByRole('heading', { name: 'H5 Markdown' })).toBeVisible();
  await expect(markdown.locator('strong')).toHaveText('SWC helpers work');
  await expect(page.getByTestId('match')).toHaveText('hello-hello');
  await expect(page.getByTestId('group')).toHaveText('hello');
  await expect(page.getByTestId('replacement')).toHaveText('[hello]');

  // Chromium supports named groups natively. This guard prevents a modern
  // target from silently bypassing the transform and its runtime helper.
  const source = await page.getByTestId('native-source').innerText();
  expect(source).toContain('[a-z]+');
  expect(source).not.toContain('(?<word>');
  expect(source).not.toContain('\\k<word>');

  await page.getByRole('textbox', { name: 'RegExp input' }).fill('hello-world');
  await expect(page.getByTestId('match')).toHaveText('no match');
  await expect(page.getByTestId('group')).toHaveText('no group');
  await expect(page.getByTestId('replacement')).toHaveText('hello-world');

  await page.getByRole('textbox', { name: 'RegExp input' }).fill('world-world');
  await expect(page.getByTestId('group')).toHaveText('world');
  await expect(page.getByTestId('replacement')).toHaveText('[world]');
  expect(pageErrors).toEqual([]);
});
