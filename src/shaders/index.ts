// ether/shaders — reusable GLSL chunks, two ways.
//
// As strings, from any bundler:
//
//   import { dither } from 'ether/shaders';
//   const frag = /* glsl */`${dither}\nvoid main(){...}`;
//
// Or the files themselves, via Vite's `?raw`:
//
//   import dither from 'ether/shaders/dither.glsl?raw';
//
// Future chunks (noise, fresnel, fbm, sdf) follow the same pattern: one
// .glsl file, one named string export.
import ditherSource from './dither.glsl?raw';

/** 8x8 Bayer threshold helpers — see dither.glsl. */
export const dither: string = ditherSource;
