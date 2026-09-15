import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// `ether/<module>` resolves to the kit's own sources — or, with
// ETHER_DIST=1, to the built package in dist/ — so the fixture consumes
// the same sub-path exports a site does, from either shape.
const here = fileURLToPath(new URL('.', import.meta.url));
const src = fileURLToPath(new URL('../../src/', import.meta.url));
const dist = fileURLToPath(new URL('../../dist/', import.meta.url));
const useDist = !!process.env.ETHER_DIST;
const replacement = useDist ? `${dist}$1.js` : `${src}$1/index.ts`;

export default defineConfig({
  root: here,
  resolve: {
    alias: [{ find: /^ether\/(.+)$/, replacement }],
  },
  // Which shape the alias above points at, so the dist run cannot pass by
  // quietly re-testing src.
  define: { __ETHER_BUILD__: JSON.stringify(useDist ? 'dist' : 'src') },
  // three alone is ~700 kB; the fixture is not a bundle-size test.
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
});
