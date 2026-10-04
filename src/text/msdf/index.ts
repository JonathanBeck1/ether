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
  /** Reject if troika has not built the glyph atlas this many ms after
   *  the font preflight passes. `Infinity` waits indefinitely. Default 10000. */
  timeoutMs?: number;
}

export interface MSDFText {
  /** The troika mesh — change properties later and call `mesh.sync()`. */
  mesh: Text;
  dispose(): void;
}

// Troika only logs a font it cannot parse and never calls back, so the
// magic bytes are checked here. A single `bytes=0-3` range is CORS-safelisted
// (no OPTIONS round-trip); from a server that ignores it, the stream is
// cancelled once four bytes have arrived.
const FONT_MAGIC = ['\0\x01\0\0', 'OTTO', 'true', 'ttcf', 'wOFF'];

async function preflight(url: string): Promise<void> {
  const response = await fetch(url, { headers: { Range: 'bytes=0-3' } });
  if (!response.ok) {
    throw new Error(`msdfText: font not reachable (${response.status}) at ${url}`);
  }
  const reader = response.body!.getReader();
  const head: number[] = [];
  while (head.length < 4) {
    const { value, done } = await reader.read();
    if (done) break;
    head.push(...value.subarray(0, 4 - head.length));
  }
  void reader.cancel();
  const magic = String.fromCharCode(...head);
  if (magic === 'wOF2') {
    throw new Error(
      `msdfText: ${url} is woff2, which troika does not support; use .ttf, .otf or .woff`,
    );
  }
  if (!FONT_MAGIC.includes(magic)) {
    const type = response.headers.get('content-type') ?? 'no content-type';
    throw new Error(`msdfText: ${url} is not a font (${type})`);
  }
}

/**
 * Crisp, resolution-independent type: an MSDF `Text` mesh, resolved
 * once its glyph atlas is ready so the first frame it renders is
 * complete. Extruded type (`extrudedWord`) is form; this is legible text
 * in the scene — captions, chapter heads, UI in the world.
 *
 * The font URL is preflighted, because troika's loader only logs a failed
 * fetch or parse and never calls back: an unreachable URL, a woff2, or an
 * HTML page served in the font's place rejects up front. Characters `font`
 * does not cover still route to unicode-font-resolver, whose data comes
 * from jsDelivr unless you set `unicodeFontsURL`; when that fetch fails
 * troika never calls back either, so the call rejects after `timeoutMs`.
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
  const timeoutMs = options.timeoutMs ?? 10_000;
  return new Promise((resolve, reject) => {
    // setTimeout fires at once for delays past 2^31 - 1, Infinity included.
    const timer = timeoutMs <= 2 ** 31 - 1
      ? setTimeout(() => {
          mesh.dispose();
          reject(
            new Error(
              `msdfText: ${options.font} not ready after ${timeoutMs}ms. Characters the font ` +
                `lacks are fetched by troika's unicode fallback from cdn.jsdelivr.net unless ` +
                `unicodeFontsURL points elsewhere; check that it is reachable.`,
            ),
          );
        }, timeoutMs)
      : undefined;
    mesh.sync(() => {
      clearTimeout(timer);
      resolve({ mesh, dispose: () => mesh.dispose() });
    });
  });
}
