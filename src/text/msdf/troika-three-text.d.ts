// The troika-three-text surface `msdfText` uses. troika ships .d.ts files
// under dist/types but does not point package.json at them, so TypeScript
// cannot resolve the module on its own. Referenced from msdf.ts so any
// program that includes it sees these.
declare module 'troika-three-text' {
  import type { ColorRepresentation, Mesh } from 'three';

  export interface TextRenderInfo {
    /** [minX, minY, maxX, maxY] per glyph, four entries each. */
    glyphBounds: Float32Array;
    glyphAtlasIndices: Float32Array;
    /** [minX, minY, maxX, maxY] of the whole block. */
    blockBounds: number[];
    /** The same rect, tight to the visible glyph paths. */
    visibleBounds: number[];
  }

  export class Text extends Mesh {
    text: string;
    font: string | null;
    fontSize: number;
    sdfGlyphSize: number | null;
    anchorX: number | string;
    anchorY: number | string;
    color: ColorRepresentation | null;
    maxWidth: number;
    letterSpacing: number;
    lineHeight: number | string;
    textAlign: string;
    outlineWidth: number | string;
    depthOffset: number;
    /** Null until the first `sync()` completes. */
    readonly textRenderInfo: TextRenderInfo | null;
    /** Re-typeset after property changes; `callback` fires once the atlas is ready. */
    sync(callback?: () => void): void;
    dispose(): void;
  }

  export function preloadFont(
    options: { font?: string; characters?: string | string[]; sdfGlyphSize?: number },
    callback: () => void,
  ): void;

  export function configureTextBuilder(config: {
    useWorker?: boolean;
    defaultFontURL?: string | null;
    sdfGlyphSize?: number;
  }): void;
}
