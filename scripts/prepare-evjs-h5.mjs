import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const consumerRoot = process.cwd();
const consumerPackage = JSON.parse(
  fs.readFileSync(path.join(consumerRoot, 'package.json'), 'utf8'),
);

if (consumerPackage.name !== 'ev-react-framework') {
  throw new Error(`Expected an EVJS checkout, received ${consumerPackage.name}`);
}

const fixture = fileURLToPath(new URL('../fixtures/evjs-h5/', import.meta.url));
const example = path.join(consumerRoot, 'examples', 'ecosystem-h5');
const cases = path.join(consumerRoot, 'e2e', 'cases');

// The consumer already includes examples/* in its npm workspaces. Copy before
// installation so marked is installed normally, without overriding SWC helpers.
fs.rmSync(example, { recursive: true, force: true });
fs.cpSync(path.join(fixture, 'app'), example, { recursive: true });
fs.mkdirSync(cases, { recursive: true });
fs.copyFileSync(
  path.join(fixture, 'ecosystem-h5.ts'),
  path.join(cases, 'ecosystem-h5.ts'),
);

console.log(`Prepared EVJS H5 example at ${example}`);
