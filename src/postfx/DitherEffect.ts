import { Effect, BlendFunction } from 'postprocessing';
import dither from '../shaders/dither.glsl?raw';

const ditherFragment = /* glsl */`
  ${dither}
  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    // per-pixel hash, re-seeded per frame: in large flat darks an ordered
    // Bayer matrix quantizes into a visible screen-door weave — even
    // animated, every still frame shows the grid. White-noise grain doesn't.
    float d = fract(sin(dot(gl_FragCoord.xy + vec2(fract(time * 0.73) * 61.0, fract(time * 0.91) * 83.0), vec2(12.9898, 78.233))) * 43758.5453);
    outputColor = vec4(inputColor.rgb + (d - 0.5) / 64.0, inputColor.a);
  }
`;

/** Subtle per-pixel grain dither — breaks up gradient banding without visible texture. */
export class DitherEffect extends Effect {
  constructor() {
    super('DitherEffect', ditherFragment, { blendFunction: BlendFunction.NORMAL });
  }
}
