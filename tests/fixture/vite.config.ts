import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// `ether/<module>` resolves to the kit's own sources — or, with
// ETHER_DIST=1, to the built package in dist/ — so the fixture consumes
// the same sub-path exports a site does, from either shape.
const here = fileURLToPath(new URL('.', import.meta.url));
const src = fileURLToPath(new URL('../../src/', import.meta.url));
const dist = fileURLToPath(new URL('../../dist/', import.meta.url));
const replacement = process.env.ETHER_DIST ? `${dist}$1.js` : `${src}$1/index.ts`;

export default defineConfig({
  root: here,
  resolve: {
    alias: [{ find: /^ether\/(.+)$/, replacement }],
  },
  // three alone is ~700 kB; the fixture is not a bundle-size test.
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
});
