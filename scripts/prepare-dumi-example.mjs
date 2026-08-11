import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const consumerRoot = process.cwd();
const consumerPackage = JSON.parse(
  fs.readFileSync(path.join(consumerRoot, 'package.json'), 'utf8'),
);

if (consumerPackage.name !== 'dumi') {
  throw new Error(`Expected a Dumi checkout, received ${consumerPackage.name}`);
}

const fixture = fileURLToPath(
  new URL('../fixtures/dumi-site', import.meta.url),
);
const destination = path.join(
  consumerRoot,
  'examples',
  'utoopack-ecosystem-ci',
);

fs.rmSync(destination, { recursive: true, force: true });
fs.cpSync(fixture, destination, { recursive: true });

console.log(`Prepared Dumi utoopack example at ${destination}`);
