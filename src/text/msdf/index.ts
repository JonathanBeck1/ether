/// <reference path="./troika-three-text.d.ts" />
import type * as THREE from 'three';
import { Text } from 'troika-three-text';

export interface MSDFTextOptions {
  text: string;
  /** URL of a `.ttf` / `.otf` / `.woff` (troika's parser does not read
   *  woff2). Serve your own — troika falls back to fetching a Google
   *  font when this is omitted, and a premium site does not ship CDN
   *  type. */
  font: string;
  /** Where troika's unicode-font-resolver looks for fallback font data,
   *  for characters `font` does not cover. Defaults to jsDelivr — point
   *  it at your own copy to keep the page off a CDN. */
  unicodeFontsURL?: string;
  /** Em size in world units. Default 1. */
  fontSize?: number;
  /** SDF resolution per glyph. 64 holds up at body sizes; use 128 when
   *  the camera ranges close enough to read the edge. Default 64. */
  sdfGlyphSize?: number;
  anchorX?: number | 'left' | 'center' | 'right' | `${number}%`;
  anchorY?:
    | number
    | 'top'
    | 'top-baseline'
    | 'top-cap'
    | 'top-ex'
    | 'middle'
    | 'bottom-baseline'
    | 'bottom'
    | `${number}%`;
  /** Fill color. Ignored when you supply `material`. */
  color?: THREE.ColorRepresentation;
  /** Your own material — troika derives an MSDF-aware variant of it, so
   *  a custom `ShaderMaterial` keeps its identity. */
  material?: THREE.Material;
  maxWidth?: number;
  letterSpacing?: number;
  lineHeight?: number | 'normal';
  textAlign?: 'left' | 'right' | 'center' | 'justify';
}

export interface MSDFText {
  /** The troika mesh — change properties later and call `mesh.sync()`. */
  mesh: Text;
  dispose(): void;
}

// Some static hosts reject HEAD; fall back to a one-byte ranged GET.
async function preflight(url: string): Promise<void> {
  let response = await fetch(url, { method: 'HEAD' });
  if (response.status === 405 || response.status === 501) {
    response = await fetch(url, { headers: { Range: 'bytes=0-0' } });
  }
  if (!response.ok) {
    throw new Error(`msdfText: font not reachable (${response.status}) at ${url}`);
  }
}

/**
 * Crisp, resolution-independent type: an MSDF `Text` mesh, resolved
 * once its glyph atlas is ready so the first frame it renders is
 * complete. Extruded type (`extrudedWord`) is form; this is legible text
 * in the scene — captions, chapter heads, UI in the world.
 *
 * The font URL is preflighted, because troika's loader only logs a failed
 * fetch and never calls back — an unreachable font would hang forever.
 * Characters `font` does not cover still route to unicode-font-resolver,
 * whose data comes from jsDelivr unless you set `unicodeFontsURL`.
 */
export async function msdfText(options: MSDFTextOptions): Promise<MSDFText> {
  await preflight(options.font);
  const mesh = new Text();
  mesh.text = options.text;
  mesh.font = options.font;
  if (options.unicodeFontsURL !== undefined) mesh.unicodeFontsURL = options.unicodeFontsURL;
  mesh.fontSize = options.fontSize ?? 1;
  mesh.sdfGlyphSize = options.sdfGlyphSize ?? 64;
  mesh.anchorX = options.anchorX ?? 'center';
  mesh.anchorY = options.anchorY ?? 'middle';
  if (options.material) mesh.material = options.material;
  else if (options.color !== undefined) mesh.color = options.color;
  if (options.maxWidth !== undefined) mesh.maxWidth = options.maxWidth;
  if (options.letterSpacing !== undefined) mesh.letterSpacing = options.letterSpacing;
  if (options.lineHeight !== undefined) mesh.lineHeight = options.lineHeight;
  if (options.textAlign) mesh.textAlign = options.textAlign;
  return new Promise((resolve) => {
    mesh.sync(() => resolve({ mesh, dispose: () => mesh.dispose() }));
  });
}
