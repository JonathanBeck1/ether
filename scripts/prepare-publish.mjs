// Turns dist/ (Vite ESM + tsc declarations) into the package that goes
// to npm: a package.json whose exports map points at the built files,
// plus README, LICENSE, CHANGELOG and the one hand-written .d.ts tsc does
// not copy. Publish with `npm publish ./dist --access public`.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = `${root}dist/`;
const source = JSON.parse(readFileSync(`${root}package.json`, 'utf8'));

// Sub-path exports only — the root export is deliberately empty so
// bundlers tree-shake per module. The `.glsl` wildcard is re-added below.
const modules = Object.keys(source.exports)
  .filter((key) => key !== '.' && !key.includes('*'))
  .map((key) => key.slice(2));

for (const name of modules) {
  for (const file of [`${name}.js`, `${name}/index.d.ts`]) {
    if (!existsSync(`${dist}${file}`)) throw new Error(`build is missing dist/${file}`);
  }
}

// tsc neither copies hand-written .d.ts inputs nor keeps `/// <reference>`
// directives in its declaration output, so the two ambient sources the
// types depend on are re-attached to the entries consumers load: the
// troika shim, and gsap's root types (which declare `gsap/ScrollTrigger`).
const prepend = (file, line) =>
  writeFileSync(`${dist}${file}`, `${line}\n${readFileSync(`${dist}${file}`, 'utf8')}`);
mkdirSync(`${dist}text/msdf`, { recursive: true });
copyFileSync(
  `${root}src/text/msdf/troika-three-text.d.ts`,
  `${dist}text/msdf/troika-three-text.d.ts`,
);
prepend('text/msdf/index.d.ts', '/// <reference path="./troika-three-text.d.ts" />');
prepend('scroll/index.d.ts', '/// <reference types="gsap" />');
mkdirSync(`${dist}shaders`, { recursive: true });
for (const file of readdirSync(`${root}src/shaders`).filter((f) => f.endsWith('.glsl'))) {
  copyFileSync(`${root}src/shaders/${file}`, `${dist}shaders/${file}`);
}
for (const file of ['README.md', 'LICENSE', 'CHANGELOG.md']) copyFileSync(`${root}${file}`, `${dist}${file}`);

const pkg = {
  name: '@jonathanbeck1/ether',
  version: source.version,
  description: source.description,
  license: source.license,
  author: source.author,
  repository: source.repository,
  homepage: source.homepage,
  keywords: source.keywords,
  type: 'module',
  sideEffects: false,
  engines: source.engines,
  exports: {
    ...Object.fromEntries(
      modules.map((name) => [
        `./${name}`,
        { types: `./${name}/index.d.ts`, import: `./${name}.js` },
      ]),
    ),
    './shaders/*.glsl': './shaders/*.glsl',
  },
  peerDependencies: source.peerDependencies,
  peerDependenciesMeta: source.peerDependenciesMeta,
};
writeFileSync(`${dist}package.json`, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`prepared ${pkg.name}@${pkg.version} in dist/ (${modules.length} entries)`);
