import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import * as opentype from 'opentype.js';
import { extrudedWord } from '../src/text/extrudedWord';

// SVGLoader parses through the DOM; node has no DOMParser of its own.
(globalThis as unknown as { DOMParser: typeof DOMParser }).DOMParser = DOMParser;

/** A one-glyph font whose glyph is a square with a square hole. TrueType
 *  contour order winds the outer clockwise and the hole counter-clockwise
 *  (font units, y up); CFF order is the reverse. Generated here so the
 *  repository stays self-contained — no font file to ship. */
function holedSquareFont(order: 'truetype' | 'cff' = 'truetype'): opentype.Font {
  const contours = [
    [[100, 100], [100, 700], [700, 700], [700, 100]],
    [[300, 300], [500, 300], [500, 500], [300, 500]],
  ];
  const path = new opentype.Path();
  for (const contour of contours) {
    const [[x0, y0], ...rest] = order === 'cff' ? [...contour].reverse() : contour;
    path.moveTo(x0, y0);
    for (const [x, y] of rest) path.lineTo(x, y);
    path.close();
  }
  const font = new opentype.Font({
    familyName: 'Synthetic',
    styleName: 'Regular',
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    glyphs: [
      new opentype.Glyph({ name: '.notdef', advanceWidth: 800, path: new opentype.Path() }),
      new opentype.Glyph({ name: 'A', unicode: 65, advanceWidth: 800, path }),
    ],
  });
  return opentype.parse(font.toArrayBuffer());
}

const triangles = (position: ArrayLike<number>) => {
  const out: number[][][] = [];
  for (let i = 0; i < position.length; i += 9) {
    out.push([
      [position[i], position[i + 1], position[i + 2]],
      [position[i + 3], position[i + 4], position[i + 5]],
      [position[i + 6], position[i + 7], position[i + 8]],
    ]);
  }
  return out;
};

/** Divergence-theorem volume. Positive only when every triangle winds
 *  counter-clockwise seen from outside the solid. */
const signedVolume = (tris: number[][][]) =>
  tris.reduce(
    (sum, [a, b, c]) =>
      sum +
      (a[0] * (b[1] * c[2] - b[2] * c[1]) -
        a[1] * (b[0] * c[2] - b[2] * c[0]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
        6,
    0,
  );

const coversOrigin = ([a, b, c]: number[][]) => {
  const cross = (p: number[], q: number[]) => -q[0] * (p[1] - q[1]) + (p[0] - q[0]) * q[1];
  const d = [cross(a, b), cross(b, c), cross(c, a)];
  return !(d.some((v) => v < 0) && d.some((v) => v > 0));
};

describe('extrudedWord', () => {
  it('winds outward, so front-cap normals face the viewer, and keeps glyph holes', async () => {
    const [letter] = await extrudedWord('A', holedSquareFont(), {
      fontSize: 100,
      worldScale: 1,
      extrude: { depth: 10, bevelEnabled: false, curveSegments: 1 },
    });

    const position = letter.geometry.attributes.position.array;
    const normal = letter.geometry.attributes.normal.array;
    const tris = triangles(position);

    // Outer 60x60 minus a 20x20 hole, extruded 10 deep. A y-flip by mirror
    // rather than rotation reverses every triangle and negates this.
    expect(signedVolume(tris)).toBeCloseTo((60 * 60 - 20 * 20) * 10, 3);

    let maxZ = -Infinity;
    for (let i = 2; i < position.length; i += 3) maxZ = Math.max(maxZ, position[i]);
    for (let i = 0; i < position.length; i += 3) {
      if (Math.abs(position[i + 2] - maxZ) < 1e-4 && Math.abs(normal[i + 2]) > 0.5) {
        expect(normal[i + 2]).toBeGreaterThan(0);
      }
    }

    const cap = tris.filter((t) => t.every((v) => Math.abs(v[2] - maxZ) < 1e-4));
    expect(cap).toHaveLength(8); // a square annulus, not a filled square
    expect(cap.filter(coversOrigin)).toHaveLength(0); // the hole is still a hole
  });

  it('extrudes CFF contour order the same as TrueType order', async () => {
    const build = async (order: 'truetype' | 'cff') => {
      const [letter] = await extrudedWord('A', holedSquareFont(order), {
        fontSize: 100,
        worldScale: 1,
        extrude: { depth: 10, bevelEnabled: false, curveSegments: 1 },
      });
      return triangles(letter.geometry.attributes.position.array);
    };
    const tris = await build('cff');

    expect(signedVolume(tris)).toBeCloseTo((60 * 60 - 20 * 20) * 10, 3);
    expect(signedVolume(tris)).toBeCloseTo(signedVolume(await build('truetype')), 3);

    const maxZ = Math.max(...tris.flat().map((v) => v[2]));
    const capArea = tris
      .filter((t) => t.every((v) => Math.abs(v[2] - maxZ) < 1e-4))
      .reduce(
        (sum, [a, b, c]) =>
          sum + Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2,
        0,
      );
    expect(capArea).toBeCloseTo(60 * 60 - 20 * 20, 3); // the hole is open, the outer is solid
  });
});
