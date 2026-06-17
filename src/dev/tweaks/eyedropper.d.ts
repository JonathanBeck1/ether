// lib.dom.d.ts has no EyeDropper global; the ColorControl feature-detects it
// at runtime, but the call site still needs the type to compile.

interface EyeDropper {
  open(options?: { signal?: AbortSignal }): Promise<{ sRGBHex: string }>;
}

interface EyeDropperConstructor {
  new (): EyeDropper;
}

interface Window {
  EyeDropper?: EyeDropperConstructor;
}
