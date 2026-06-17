// Pure, unit-testable export. Turns the changed-from-default diff into a
// paste-ready constants.ts block (grouped under the file's section banners) or
// a flat JSON map. No DOM, no THREE — just strings.

import type { DiffMap, ExportTarget, TweakValue } from './types';
import type { RegistryEntry } from './Registry';
import { numberToLiteral } from './format';
import { hexNormalize } from './color';

// Section banners as they read in constants.ts, keyed by constant prefix so the
// AD can paste section-by-section. Order here is the emit order.
const SECTIONS: Array<{ banner: string; match: (constant: string) => boolean }> = [
  { banner: '// ─── BRAND COLORS ────────────────────────────────────────────────────', match: (c) => c.startsWith('COLOR_') && !c.startsWith('COLOR_CAUSTICS_') },
  { banner: '// ─── INTRO ANIMATION ─────────────────────────────────────────────────', match: (c) => c === 'FINAL_DISPLACEMENT' },
  { banner: '// ─── CAMERA ──────────────────────────────────────────────────────────', match: (c) => c.startsWith('CAMERA_') },
  { banner: '// ─── BACKGROUND (caustics — current, monochrome) ────────────────────', match: (c) => c.startsWith('CAUSTICS_') || c.startsWith('COLOR_CAUSTICS_') },
];

const PROMOTION_BANNER = [
  '// ─── THESE CONSTANTS DO NOT EXIST YET ────────────────────────────────',
  '// Add to constants.ts and wire the source import before the line takes',
  '// effect — see the panel\'s promotion list for each inline-literal home.',
].join('\n');

interface Line {
  constant: string;
  text: string;
}

function lineFor(target: ExportTarget, value: TweakValue, step: number): string {
  if (target.shape === 'three-color') {
    const hex = (hexNormalize(String(value)) ?? '#000000').slice(1);
    return `export const ${target.constant} = new THREE.Color(0x${hex});`;
  }
  return `export const ${target.constant} = ${numberToLiteral(Number(value), step)};`;
}

function sectionIndex(constant: string): number {
  const i = SECTIONS.findIndex((s) => s.match(constant));
  return i === -1 ? SECTIONS.length : i;
}

/** Group the changed exportable params into the constants.ts section banners.
 *  needsPromotion lines are collected under a separate leading banner. */
export function buildConstantsBlock(diff: DiffMap, entries: RegistryEntry[]): string {
  const byPath = new Map(entries.map((e) => [e.control.path, e]));

  const sectioned: Line[] = [];
  const promotion: Line[] = [];
  for (const path of Object.keys(diff)) {
    const entry = byPath.get(path);
    if (!entry?.export) continue;
    const line: Line = { constant: entry.export.constant, text: lineFor(entry.export, diff[path], entry.step) };
    if (entry.export.needsPromotion) promotion.push(line);
    else sectioned.push(line);
  }

  const blocks: string[] = [];

  const grouped = new Map<number, Line[]>();
  for (const line of sectioned) {
    const idx = sectionIndex(line.constant);
    (grouped.get(idx) ?? grouped.set(idx, []).get(idx)!).push(line);
  }
  for (const idx of [...grouped.keys()].sort((a, b) => a - b)) {
    const lines = grouped.get(idx)!;
    lines.sort((a, b) => a.constant.localeCompare(b.constant));
    const banner = SECTIONS[idx]?.banner;
    blocks.push([banner, ...lines.map((l) => l.text)].filter(Boolean).join('\n'));
  }

  if (promotion.length) {
    promotion.sort((a, b) => a.constant.localeCompare(b.constant));
    blocks.push([PROMOTION_BANNER, ...promotion.map((l) => l.text)].join('\n'));
  }

  return blocks.join('\n\n');
}

/** Flat changed map — colors '#rrggbb', numbers as numbers. Same shape as
 *  localStorage + URL-state; round-trips cleanly. */
export function buildJson(map: DiffMap): string {
  return JSON.stringify(map, null, 2);
}
