import { Effect, BlendFunction } from 'postprocessing';
import dither from '../shaders/dither.glsl?raw';

const ditherFragment = /* glsl */`
  ${dither}
  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    // per-pixel hash noise (no Bayer screen-door in flat darks), held for
    // ~1/6s per seed at ~0.7 of a quantization step: enough to decorrelate
    // banding, below the threshold where it reads as grain.
    float seed = floor(time * 6.0);
    float d = fract(sin(dot(gl_FragCoord.xy + vec2(fract(seed * 0.73) * 61.0, fract(seed * 0.91) * 83.0), vec2(12.9898, 78.233))) * 43758.5453);
    outputColor = vec4(inputColor.rgb + (d - 0.5) / 180.0, inputColor.a);
  }
`;

/** Subtle per-pixel grain dither — breaks up gradient banding without visible texture. */
export class DitherEffect extends Effect {
  constructor() {
    super('DitherEffect', ditherFragment, { blendFunction: BlendFunction.NORMAL });
  }
}
