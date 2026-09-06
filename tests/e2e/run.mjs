// Builds the plain-Vite fixture, serves it, runs the core suite against
// it, and exits non-zero on any failure. `npm run test:e2e`.
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';
import { runCoreSuite } from './core.mjs';

const configFile = fileURLToPath(new URL('../fixture/vite.config.ts', import.meta.url));

const freePort = () =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

await build({ configFile, logLevel: 'warn' });
const port = await freePort();
const server = await preview({
  configFile,
  logLevel: 'warn',
  preview: { port, strictPort: true, host: '127.0.0.1', open: false },
});

let failures;
try {
  failures = await runCoreSuite(`http://127.0.0.1:${port}`);
} finally {
  await server.close();
}

if (failures.length > 0) {
  console.error(`\nE2E FAILED — ${failures.length} failure(s)`);
  process.exit(1);
}
console.log('\nE2E PASSED');
