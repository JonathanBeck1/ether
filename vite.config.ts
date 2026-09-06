import { defineConfig } from 'vite';

// The npm build: one ESM entry per sub-path export, shared code split
// into chunks, peers left external. Declarations come from
// `tsc -p tsconfig.build.json`; scripts/prepare-publish.mjs assembles the
// package. The `file:` / git install never runs this — it ships src/.
const MODULES = [
  'core',
  'astro',
  'vanilla',
  'quality',
  'postfx',
  'scroll',
  'shaders',
  'text',
  'text/msdf',
  'primitives',
  'interactions',
  'loaders',
  'dev',
];

export default defineConfig({
  build: {
    lib: {
      entry: Object.fromEntries(MODULES.map((name) => [name, `src/${name}/index.ts`])),
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    target: 'es2022',
    minify: false,
    sourcemap: true,
    emptyOutDir: true,
    copyPublicDir: false,
    rolldownOptions: {
      external: [
        /^three(\/|$)/,
        /^postprocessing$/,
        /^gsap(\/|$)/,
        /^lenis(\/|$)/,
        /^detect-gpu$/,
        /^opentype\.js$/,
        /^troika-three-text$/,
      ],
      output: { chunkFileNames: 'chunks/[name]-[hash].js' },
    },
  },
});
