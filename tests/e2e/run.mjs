// Builds the plain-Vite fixture, serves it, runs the core, recovery and
// asset suites against it, and exits non-zero on any failure.
// `npm run test:e2e`.
//
// ETHER_DIST=1 points the fixture's `ether/*` alias at dist/ instead of src/.
// ETHER_SOFTWARE_GL=1 launches Chromium on SwiftShader, mirroring a CI
// runner with no GPU.
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';
import { runAssetsSuite } from './assets.mjs';
import { runCoreSuite } from './core.mjs';
import { runRecoverySuite } from './recovery.mjs';

const configFile = fileURLToPath(new URL('../fixture/vite.config.ts', import.meta.url));

const launchOptions = process.env.ETHER_SOFTWARE_GL
  ? { args: ['--use-gl=angle', '--use-angle=swiftshader'] }
  : {};

await build({ configFile, logLevel: 'warn' });
// Vite picks the port and retries on a clash; probing one here and binding
// it a moment later loses the race against a concurrent suite.
const server = await preview({
  configFile,
  logLevel: 'warn',
  preview: { host: '127.0.0.1', open: false },
});

let failures;
try {
  const baseUrl = new URL(server.resolvedUrls.local[0]).origin;
  failures = [
    ...(await runCoreSuite(baseUrl, launchOptions)),
    ...(await runRecoverySuite(baseUrl, launchOptions)),
    ...(await runAssetsSuite(baseUrl, launchOptions)),
  ];
} finally {
  await server.close();
}

if (failures.length > 0) {
  console.error(`\nE2E FAILED — ${failures.length} failure(s)`);
  process.exit(1);
}
console.log('\nE2E PASSED');
