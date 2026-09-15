import { Effect, BlendFunction } from 'postprocessing';

const ditherFragment = /* glsl */`
  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    // Effects run in linear light and the pass encodes to sRGB afterwards, so the
    // noise goes in through the encoded domain: one output step peak to peak at
    // every luminance, where the same amount in linear was several steps in the darks.
    float seed = floor(time * 6.0);
    float d = fract(sin(dot(gl_FragCoord.xy + vec2(fract(seed * 0.73) * 61.0, fract(seed * 0.91) * 83.0), vec2(12.9898, 78.233))) * 43758.5453);
    vec3 encoded = sRGBTransferOETF(vec4(inputColor.rgb, 1.0)).rgb + (d - 0.5) / 255.0;
    outputColor = vec4(sRGBTransferEOTF(vec4(encoded, 1.0)).rgb, inputColor.a);
  }
`;

/** Subtle per-pixel grain dither — breaks up gradient banding without visible texture. */
export class DitherEffect extends Effect {
  constructor() {
    super('DitherEffect', ditherFragment, { blendFunction: BlendFunction.NORMAL });
  }
}
