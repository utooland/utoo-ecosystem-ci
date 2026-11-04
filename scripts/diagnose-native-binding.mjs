import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import util from 'node:util';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

function inspect(value) {
  console.log(util.inspect(value, { depth: null, colors: false, maxArrayLength: null }));
}

function reportError(label, error) {
  console.log(`[native-diagnostic] ${label} failed`);
  inspect(error);
  const seen = new Set();
  for (let cause = error, index = 0; cause && !seen.has(cause); cause = cause.cause, index++) {
    seen.add(cause);
    console.log(`[native-diagnostic] cause ${index}`);
    inspect({ message: cause.message, code: cause.code, stack: cause.stack });
  }
}

console.log('[native-diagnostic] process');
inspect({
  version: process.version,
  execPath: process.execPath,
  platform: process.platform,
  arch: process.arch,
  config: process.config,
  napiEnv: Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('NAPI_'))),
});

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utoo-native-diagnostic-'));
const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
for (const version of ['1.5.37', '1.5.38-alpha.0']) {
  const directory = path.join(root, version);
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, 'package.json'), '{"private":true}\n');
  console.log(`[native-diagnostic] install ${version} in ${directory}`);
  const install = spawnSync(process.execPath, [
    npmCli, 'install', '--ignore-scripts', '--no-audit', '--no-fund', `@utoo/pack@${version}`,
  ], { cwd: directory, stdio: 'inherit' });
  inspect({ installStatus: install.status, installSignal: install.signal, installError: install.error });
  try {
    const fromProject = createRequire(path.join(directory, 'package.json'));
    const manifest = fromProject.resolve('@utoo/pack/package.json');
    console.log(`[native-diagnostic] pack manifest ${manifest}`);
    const fromPack = createRequire(manifest);
    try {
      const native = fromPack.resolve('@utoo/pack-win32-x64-msvc');
      console.log(`[native-diagnostic] native path ${native}`);
      const binding = fromPack(native);
      console.log(`[native-diagnostic] direct native PASS ${version}`);
      inspect(Object.keys(binding));
    } catch (error) {
      reportError(`direct native ${version}`, error);
    }
    try {
      const binding = fromPack(path.join(path.dirname(manifest), 'cjs', 'binding.js'));
      console.log(`[native-diagnostic] generated loader PASS ${version}`);
      inspect(Object.keys(binding));
    } catch (error) {
      reportError(`generated loader ${version}`, error);
    }
  } catch (error) {
    reportError(`package resolve ${version}`, error);
  }
}
console.log('[native-diagnostic] complete; continuing original consumer suite');
