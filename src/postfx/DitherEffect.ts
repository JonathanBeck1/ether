import { Effect, BlendFunction } from 'postprocessing';
import dither from '../../../shaders/dither.glsl?raw';

const ditherFragment = /* glsl */`
  ${dither}
  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    float d = dither8x8(gl_FragCoord.xy);
    outputColor = vec4(inputColor.rgb + (d - 0.5) / 64.0, inputColor.a);
  }
`;

/** Subtle 8x8 Bayer dither — breaks up gradient banding without visible texture. */
export class DitherEffect extends Effect {
  constructor() {
    super('DitherEffect', ditherFragment, { blendFunction: BlendFunction.NORMAL });
  }
}
