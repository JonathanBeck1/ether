import * as THREE from 'three';
import * as opentype from 'opentype.js';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';

/**
 * Per-letter extrusion result — geometry plus the canonical "rest" pose
 * the word would sit in if mounted as-is. The caller wraps each
 * geometry with whatever material it wants.
 */
export interface ExtrudedLetter {
  char: string;
  geometry: THREE.ExtrudeGeometry;
  /** Local position in the parent group when the word is assembled + centered. */
  assembledPosition: THREE.Vector3;
  /** Uniform scale to apply to the mesh. */
  assembledScale: number;
}

/** Subset of `THREE.ExtrudeGeometryOptions` we expose for tuning. */
export interface ExtrudeProfile {
  depth?: number;
  bevelEnabled?: boolean;
  bevelThickness?: number;
  bevelSize?: number;
  bevelOffset?: number;
  bevelSegments?: number;
  curveSegments?: number;
}

export interface ExtrudedWordOptions {
  /** opentype.js path-coord font size. Default 100. */
  fontSize?: number;
  /**
   * Ratio of cap height to em size for the font (Staatliches ≈ 0.7).
   * Used with `targetCapHeight` to derive world scale.
   */
  capHeightRatio?: number;
  /**
   * Desired cap height in world units. If set, `worldScale` is
   * computed = `targetCapHeight / (fontSize * capHeightRatio)`.
   * Ignored if `worldScale` is provided directly.
   */
  targetCapHeight?: number;
  /** Explicit world-space scale to apply to each letter mesh. */
  worldScale?: number;
  /** ExtrudeGeometry tuning. Defaults to bevel-on with gentle values. */
  extrude?: ExtrudeProfile;
}

const DEFAULT_EXTRUDE: Required<ExtrudeProfile> = {
  depth: 16,
  bevelEnabled: true,
  bevelThickness: 1.2,
  bevelSize: 0.8,
  bevelOffset: 0,
  bevelSegments: 8,
  curveSegments: 10,
};

/**
 * Build per-letter extruded geometries for a word, ready to mount into
 * a `THREE.Group`. The caller supplies the material.
 *
 * Pipeline (Inigo Quilez-style — pure data, no THREE.Mesh allocations):
 *
 *   1. Load the font via `opentype.js`.
 *   2. For each character: get its glyph path, convert to SVG path data,
 *      parse via three's `SVGLoader` into shapes, extrude.
 *   3. Sum bounding boxes to find the WORD bbox so the assembled word
 *      sits centred on the parent group's origin.
 *   4. Centre each geometry around its own origin (so `mesh.position`
 *      controls placement), flip Y (SVG / font coords are y-down,
 *      three is y-up), compute the assembled world-space position from
 *      the letter's natural centre minus the word's centre × world
 *      scale.
 *
 * The returned `assembledPosition` and `assembledScale` are the source
 * of truth for "where/what size is this letter when the word is solid."
 * Read them — don't read `mesh.position` / `mesh.scale`, which any
 * scroll-drift / scramble system will mutate.
 *
 * @param word          The word to extrude (one mesh per character).
 * @param fontSource    Either a path / URL to a `.ttf` / `.otf` / `.woff`
 *                      file, OR a pre-loaded `opentype.Font` instance
 *                      (saves a network round-trip if you're calling
 *                      this multiple times with the same font).
 * @param options       Sizing + extrusion tuning.
 *
 * @returns One `ExtrudedLetter` per character that produced geometry.
 *          Characters that produced no path (e.g. space) are skipped.
 *
 * Disposal: the caller owns each `letter.geometry` — push them onto
 * your own disposables list and call `.dispose()` in cleanup.
 */
export async function extrudedWord(
  word: string,
  fontSource: string | opentype.Font,
  options: ExtrudedWordOptions = {},
): Promise<ExtrudedLetter[]> {
  const fontSize = options.fontSize ?? 100;
  const capHeightRatio = options.capHeightRatio ?? 0.7;

  // Resolve world scale: explicit > derived from target cap height >
  // default of 1.0 (raw path units, almost certainly too big).
  const worldScale =
    options.worldScale ??
    (options.targetCapHeight !== undefined
      ? options.targetCapHeight / (fontSize * capHeightRatio)
      : 1.0);

  const extrude: Required<ExtrudeProfile> = { ...DEFAULT_EXTRUDE, ...options.extrude };

  const font =
    typeof fontSource === 'string' ? await opentype.load(fontSource) : fontSource;

  const loader = new SVGLoader();

  // Pass 1: build per-letter geometries at their natural x offset in the word.
  // We accumulate xOffset by glyph advance widths; each glyph's path is
  // generated at (xOffset, 0) so its position in path space is correct.
  interface BuiltLetter {
    char: string;
    geometry: THREE.ExtrudeGeometry;
  }
  const built: BuiltLetter[] = [];

  let xOffset = 0;
  for (const char of word) {
    const glyph = font.charToGlyph(char);
    const advance = glyph.advanceWidth * (fontSize / font.unitsPerEm);
    const path = glyph.getPath(xOffset, 0, fontSize);
    const svgPath = path.toPathData(2);

    const svgString = `<svg xmlns="http://www.w3.org/2000/svg"><path d="${svgPath}" fill="black"/></svg>`;
    const svgData = loader.parse(svgString);
    const shapes: THREE.Shape[] = [];
    for (const sp of svgData.paths) shapes.push(...sp.toShapes(true));

    if (shapes.length === 0) {
      // Glyph produced no path (e.g. space). Advance the cursor anyway
      // so subsequent letters land at the correct kerning offset.
      xOffset += advance;
      continue;
    }

    const geometry = new THREE.ExtrudeGeometry(shapes, extrude);
    geometry.computeBoundingBox();

    built.push({ char, geometry });
    xOffset += advance;
  }

  if (built.length === 0) return [];

  // Pass 2: figure out the WORD bbox by reducing all letter bboxes.
  let wordMinX = Infinity;
  let wordMaxX = -Infinity;
  let wordMinY = Infinity;
  let wordMaxY = -Infinity;
  for (const b of built) {
    const bbox = b.geometry.boundingBox!;
    if (bbox.min.x < wordMinX) wordMinX = bbox.min.x;
    if (bbox.max.x > wordMaxX) wordMaxX = bbox.max.x;
    if (bbox.min.y < wordMinY) wordMinY = bbox.min.y;
    if (bbox.max.y > wordMaxY) wordMaxY = bbox.max.y;
  }
  const wordCenterX = (wordMinX + wordMaxX) / 2;
  const wordCenterY = (wordMinY + wordMaxY) / 2;

  // Pass 3: centre each letter around its own origin (so mesh.position
  // controls placement), flip Y, compute assembled position from natural
  // centre minus word centre × world scale.
  const result: ExtrudedLetter[] = [];
  for (const b of built) {
    const geometry = b.geometry;
    const bbox = geometry.boundingBox!;
    const cx = (bbox.max.x + bbox.min.x) / 2;
    const cy = (bbox.max.y + bbox.min.y) / 2;
    const cz = (bbox.max.z + bbox.min.z) / 2;

    geometry.translate(-cx, -cy, -cz);
    geometry.scale(1, -1, 1); // SVG/font y-down → three y-up
    geometry.computeVertexNormals();

    const px = (cx - wordCenterX) * worldScale;
    const py = -(cy - wordCenterY) * worldScale;
    const pz = 0;

    result.push({
      char: b.char,
      geometry,
      assembledPosition: new THREE.Vector3(px, py, pz),
      assembledScale: worldScale,
    });
  }

  return result;
}
