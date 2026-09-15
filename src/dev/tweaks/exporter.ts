// Pure, unit-testable export. Turns the changed-from-default diff into a
// paste-ready constants block (grouped under the host's section banners, when
// it supplies a table) or a flat JSON map. No DOM, no THREE — just strings.

import type { DiffMap, ExportSection, ExportTarget, TweakValue } from './types';
import type { RegistryEntry } from './Registry';
import { numberToLiteral } from './format';
import { hexNormalize } from './color';

interface Line {
  constant: string;
  text: string;
}

/** One export line per emitted constant. Arrays emit one line per element when
 *  the target carries `constants` (string[]); arrays without it emit nothing —
 *  never Number()-coerce an array into a NaN literal. */
function linesFor(target: ExportTarget, value: TweakValue, step: number): Line[] {
  if (Array.isArray(value)) {
    if (!target.constants) return [];
    return target.constants.map((c, i) => ({ constant: c, text: `export const ${c} = ${numberToLiteral(value[i], step)};` }));
  }
  const { constant } = target;
  if (!constant) return [];
  if (target.shape === 'three-color') {
    const hex = (hexNormalize(String(value)) ?? '#000000').slice(1);
    return [{ constant, text: `export const ${constant} = new THREE.Color(0x${hex});` }];
  }
  return [{ constant, text: `export const ${constant} = ${numberToLiteral(Number(value), step)};` }];
}

function sectionIndex(sections: ExportSection[], constant: string): number {
  const i = sections.findIndex((s) => s.match(constant));
  return i === -1 ? sections.length : i;
}

/** Group the changed exportable params under the host's section banners.
 *  With no sections: one sorted block. needsPromotion lines are collected into
 *  a trailing block, under `promotionBanner` when the host supplies one. */
export function buildConstantsBlock(
  diff: DiffMap,
  entries: RegistryEntry[],
  sections: ExportSection[] = [],
  promotionBanner?: string,
): string {
  const byPath = new Map(entries.map((e) => [e.control.path, e]));

  const sectioned: Line[] = [];
  const promotion: Line[] = [];
  for (const path of Object.keys(diff)) {
    const entry = byPath.get(path);
    if (!entry?.export) continue;
    const lines = linesFor(entry.export, diff[path], entry.step);
    if (entry.export.needsPromotion) promotion.push(...lines);
    else sectioned.push(...lines);
  }

  const blocks: string[] = [];

  const grouped = new Map<number, Line[]>();
  for (const line of sectioned) {
    const idx = sectionIndex(sections, line.constant);
    (grouped.get(idx) ?? grouped.set(idx, []).get(idx)!).push(line);
  }
  for (const idx of [...grouped.keys()].sort((a, b) => a - b)) {
    const lines = grouped.get(idx)!;
    lines.sort((a, b) => a.constant.localeCompare(b.constant));
    const banner = sections[idx]?.banner;
    blocks.push([banner, ...lines.map((l) => l.text)].filter(Boolean).join('\n'));
  }

  if (promotion.length) {
    promotion.sort((a, b) => a.constant.localeCompare(b.constant));
    blocks.push([promotionBanner, ...promotion.map((l) => l.text)].filter(Boolean).join('\n'));
  }

  return blocks.join('\n\n');
}

/** Flat changed map — colors '#rrggbb', numbers as numbers. Same shape as
 *  localStorage + URL-state; round-trips cleanly. */
export function buildJson(map: DiffMap): string {
  return JSON.stringify(map, null, 2);
}
