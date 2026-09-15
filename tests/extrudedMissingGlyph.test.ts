import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import * as opentype from 'opentype.js';
import { extrudedWord } from '../src/text/extrudedWord';

// SVGLoader parses through the DOM; node has no DOMParser of its own.
(globalThis as unknown as { DOMParser: typeof DOMParser }).DOMParser = DOMParser;

const box = (x0: number, y0: number, x1: number, y1: number) => {
  const path = new opentype.Path();
  path.moveTo(x0, y0);
  path.lineTo(x0, y1);
  path.lineTo(x1, y1);
  path.lineTo(x1, y0);
  path.close();
  return path;
};

/** A font covering only 'A', whose `.notdef` is the usual tofu box — the
 *  shape that survives the empty-path check and renders as a blank slug. */
function tofuFont(): opentype.Font {
  const font = new opentype.Font({
    familyName: 'Synthetic',
    styleName: 'Regular',
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    glyphs: [
      new opentype.Glyph({ name: '.notdef', advanceWidth: 800, path: box(100, 0, 700, 700) }),
      new opentype.Glyph({ name: 'A', unicode: 65, advanceWidth: 800, path: box(100, 100, 700, 700) }),
    ],
  });
  return opentype.parse(font.toArrayBuffer());
}

const extrude = { depth: 10, bevelEnabled: false, curveSegments: 1 };

describe('extrudedWord with characters the font does not cover', () => {
  it('skips them instead of extruding .notdef into tofu', async () => {
    const letters = await extrudedWord('A?A', tofuFont(), {
      fontSize: 100,
      worldScale: 1,
      extrude,
    });

    expect(letters.map((l) => l.char)).toEqual(['A', 'A']);
  });

  it('keeps the missing glyph advance, so the rest of the word holds its metrics', async () => {
    const font = tofuFont();
    const gap = await extrudedWord('A?A', font, { fontSize: 100, worldScale: 1, extrude });
    const tight = await extrudedWord('AA', font, { fontSize: 100, worldScale: 1, extrude });

    const spread = (l: typeof gap) => l[1].assembledPosition.x - l[0].assembledPosition.x;
    // One 800/1000 em advance at fontSize 100.
    expect(spread(gap) - spread(tight)).toBeCloseTo(80, 6);
  });

  it('returns nothing when no character in the word has a glyph', async () => {
    expect(await extrudedWord('???', tofuFont(), { fontSize: 100, worldScale: 1, extrude })).toEqual(
      [],
    );
  });
});
