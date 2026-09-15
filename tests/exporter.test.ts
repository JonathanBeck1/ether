import { describe, expect, it } from 'vitest';
import { buildConstantsBlock, buildJson } from '../src/dev/tweaks/exporter';
import type { RegistryEntry } from '../src/dev/tweaks/Registry';
import type { ExportSection, ExportTarget } from '../src/dev/tweaks/types';

const entry = (path: string, target: ExportTarget | null, step = 0.01): RegistryEntry =>
  ({ control: { path }, export: target, step }) as unknown as RegistryEntry;

// A host's section table, in emit order — what a consumer passes through
// `TweaksConfig.exportSections`.
const SECTIONS: ExportSection[] = [
  { banner: '// ─── BRAND COLORS ───', match: (c) => c.startsWith('COLOR_') && !c.startsWith('COLOR_CAUSTICS_') },
  { banner: '// ─── INTRO ANIMATION ───', match: (c) => c === 'FINAL_DISPLACEMENT' },
  { banner: '// ─── CAMERA ───', match: (c) => c.startsWith('CAMERA_') },
  { banner: '// ─── BACKGROUND ───', match: (c) => c.startsWith('COLOR_CAUSTICS_') },
];
const PROMOTION_BANNER = '// ─── THESE CONSTANTS DO NOT EXIST YET ───';

describe('buildConstantsBlock', () => {
  it('emits only params that changed AND declare an export target', () => {
    const entries = [
      entry('bloom.intensity', { constant: 'BLOOM_INTENSITY', shape: 'number' }),
      entry('debug.wireframe', null),
      entry('camera.fov', { constant: 'CAMERA_FOV', shape: 'number' }),
    ];
    const block = buildConstantsBlock({ 'bloom.intensity': 0.24, 'debug.wireframe': true }, entries);
    expect(block).toContain('export const BLOOM_INTENSITY = 0.24;');
    expect(block).not.toContain('WIREFRAME');
    expect(block).not.toContain('CAMERA_FOV');
  });

  it('ignores diff paths no control owns, so a stale saved state emits nothing', () => {
    const entries = [entry('bloom.intensity', { constant: 'BLOOM_INTENSITY', shape: 'number' })];
    expect(buildConstantsBlock({ 'renamed.path': 3 }, entries)).toBe('');
  });

  it('writes a color as a THREE.Color literal', () => {
    const entries = [entry('rim.color', { constant: 'COLOR_RIM', shape: 'three-color' }, 0)];
    const block = buildConstantsBlock({ 'rim.color': '#6E9FFF' }, entries);
    expect(block).toContain('export const COLOR_RIM = new THREE.Color(0x6e9fff);');
  });

  it('rounds number literals to the control step instead of leaking float noise', () => {
    const entries = [entry('bloom.intensity', { constant: 'BLOOM_INTENSITY', shape: 'number' }, 0.01)];
    const block = buildConstantsBlock({ 'bloom.intensity': 0.1 + 0.2 }, entries);
    expect(block).toContain('export const BLOOM_INTENSITY = 0.3;');
  });

  it('pairs each array element with the constant at the same index', () => {
    const entries = [
      entry('camera.z', { constants: ['CAMERA_Z_START', 'CAMERA_Z_END'], shape: 'number' }, 0.1),
    ];
    const block = buildConstantsBlock({ 'camera.z': [8, 4.25] }, entries);
    expect(block).toContain('export const CAMERA_Z_START = 8;');
    expect(block).toContain('export const CAMERA_Z_END = 4.3;');
  });

  it('emits nothing for an array with no per-element constants rather than a NaN literal', () => {
    const entries = [entry('band', { constant: 'BAND', shape: 'number' })];
    expect(buildConstantsBlock({ band: [0.2, 0.8] }, entries)).toBe('');
  });

  it('files each constant under its section banner, in the order the table gives', () => {
    const entries = [
      entry('a', { constant: 'COLOR_BRAND', shape: 'three-color' }, 0),
      entry('b', { constant: 'FINAL_DISPLACEMENT', shape: 'number' }),
      entry('c', { constant: 'CAMERA_FOV', shape: 'number' }),
      entry('d', { constant: 'COLOR_CAUSTICS_TINT', shape: 'three-color' }, 0),
      entry('e', { constant: 'RIM_POWER', shape: 'number' }),
    ];
    const block = buildConstantsBlock(
      { e: 1, d: '#101418', c: 50, b: 0.4, a: '#6e9fff' },
      entries,
      SECTIONS,
    );
    const at = (needle: string) => block.indexOf(needle);
    expect(at('BRAND COLORS')).toBeLessThan(at('INTRO ANIMATION'));
    expect(at('INTRO ANIMATION')).toBeLessThan(at('─── CAMERA'));
    expect(at('─── CAMERA')).toBeLessThan(at('BACKGROUND'));
    expect(at('COLOR_CAUSTICS_TINT')).toBeGreaterThan(at('BACKGROUND'));
    expect(at('RIM_POWER')).toBeGreaterThan(at('COLOR_CAUSTICS_TINT'));
  });

  it('sorts alphabetically inside a section whatever order the panel changed them in', () => {
    const entries = [
      entry('z', { constant: 'CAMERA_ZOOM', shape: 'number' }),
      entry('a', { constant: 'CAMERA_ANGLE', shape: 'number' }),
    ];
    const block = buildConstantsBlock({ z: 2, a: 1 }, entries, SECTIONS);
    expect(block.indexOf('CAMERA_ANGLE')).toBeLessThan(block.indexOf('CAMERA_ZOOM'));
  });

  it('collects constants with no home yet under the promotion banner, last', () => {
    const entries = [
      entry('a', { constant: 'CAMERA_FOV', shape: 'number' }),
      entry('b', { constant: 'RIM_SHARPNESS', shape: 'number', needsPromotion: true }),
    ];
    const block = buildConstantsBlock({ b: 3, a: 50 }, entries, SECTIONS, PROMOTION_BANNER);
    expect(block).toContain('DO NOT EXIST YET');
    expect(block.indexOf('RIM_SHARPNESS')).toBeGreaterThan(block.indexOf('CAMERA_FOV'));
  });

  it('emits one sorted block with no banners by default', () => {
    const entries = [
      entry('rim', { constant: 'COLOR_VIOLET', shape: 'three-color' }),
      entry('field', { constant: 'COLOR_CAUSTICS_BASE', shape: 'three-color' }),
      entry('zoom', { constants: ['CAMERA_Z_START', 'CAMERA_Z_END'], shape: 'number' }, 0.1),
      entry('bloom', { constant: 'BLOOM_INTENSITY', shape: 'number' }),
      entry('fresnel', { constant: 'FRESNEL_EXP', shape: 'number', needsPromotion: true }, 0.05),
      entry('runtimeOnly', null),
    ];
    const diff = {
      zoom: [4.2, 1.8],
      bloom: 0.06,
      rim: '#e66cff',
      fresnel: 5.25,
      field: '#05060a',
      runtimeOnly: 3,
    };
    expect(buildConstantsBlock(diff, entries)).toBe(
      [
        'export const BLOOM_INTENSITY = 0.06;',
        'export const CAMERA_Z_END = 1.8;',
        'export const CAMERA_Z_START = 4.2;',
        'export const COLOR_CAUSTICS_BASE = new THREE.Color(0x05060a);',
        'export const COLOR_VIOLET = new THREE.Color(0xe66cff);',
        '',
        'export const FRESNEL_EXP = 5.25;',
      ].join('\n'),
    );
  });

  it('groups and orders by a supplied section table', () => {
    const entries = [
      entry('rim', { constant: 'COLOR_VIOLET', shape: 'three-color' }),
      entry('field', { constant: 'COLOR_CAUSTICS_BASE', shape: 'three-color' }),
      entry('zoom', { constants: ['CAMERA_Z_START', 'CAMERA_Z_END'], shape: 'number' }, 0.1),
      entry('bloom', { constant: 'BLOOM_INTENSITY', shape: 'number' }),
      entry('fresnel', { constant: 'FRESNEL_EXP', shape: 'number', needsPromotion: true }, 0.05),
    ];
    const diff = { zoom: [4.2, 1.8], bloom: 0.06, rim: '#e66cff', fresnel: 5.25, field: '#05060a' };
    const sections: ExportSection[] = [
      { banner: '// COLORS', match: (c) => c.startsWith('COLOR_') && !c.startsWith('COLOR_CAUSTICS_') },
      { banner: '// CAMERA', match: (c) => c.startsWith('CAMERA_') },
    ];
    expect(buildConstantsBlock(diff, entries, sections, '// PROMOTE')).toBe(
      [
        '// COLORS',
        'export const COLOR_VIOLET = new THREE.Color(0xe66cff);',
        '',
        '// CAMERA',
        'export const CAMERA_Z_END = 1.8;',
        'export const CAMERA_Z_START = 4.2;',
        '',
        'export const BLOOM_INTENSITY = 0.06;',
        'export const COLOR_CAUSTICS_BASE = new THREE.Color(0x05060a);',
        '',
        '// PROMOTE',
        'export const FRESNEL_EXP = 5.25;',
      ].join('\n'),
    );
  });

  it('returns an empty string when nothing has changed', () => {
    const entries = [entry('bloom.intensity', { constant: 'BLOOM_INTENSITY', shape: 'number' })];
    expect(buildConstantsBlock({}, entries)).toBe('');
  });
});

describe('buildJson', () => {
  it('emits the diff as indented JSON that parses back to the same map', () => {
    const diff = { bloom: 0.12, rim: '#2fbf71', on: true, band: [0.2, 0.8] };
    const json = buildJson(diff);
    expect(json).toContain('\n  "bloom": 0.12');
    expect(JSON.parse(json)).toEqual(diff);
  });
});
