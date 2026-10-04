// Imports every built entry in plain Node, the way a server render (Astro
// frontmatter, SvelteKit SSR) loads them. Nothing runs until a page attaches,
// but the import itself must not throw.
import { readFileSync } from 'node:fs';

const dist = new URL('../dist/', import.meta.url);
const { exports } = JSON.parse(readFileSync(new URL('package.json', dist), 'utf8'));

const entries = Object.entries(exports).filter(([, target]) => target.import);
const failures = [];
for (const [name, target] of entries) {
  try {
    await import(new URL(target.import, dist).href);
  } catch (err) {
    failures.push(`${name}: ${err.message}`);
  }
}

if (failures.length) {
  console.error(`ssr-smoke: ${failures.length} of ${entries.length} entries throw on a plain Node import`);
  for (const line of failures) console.error(`  ${line}`);
  process.exit(1);
}
console.log(`ssr-smoke: all ${entries.length} entries import in plain Node`);
