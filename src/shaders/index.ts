// aether/shaders — reusable GLSL chunks.
//
// Each .glsl file in this directory is consumed via a `?raw` import —
// consumers compose them into their own shader strings:
//
//   import dither from 'aether/shaders/dither.glsl?raw';
//   const frag = /* glsl */`${dither}\nvoid main(){...}`;
//
// This barrel has no exports — the files ARE the API. Future chunks
// (noise, fresnel, fbm, sdf, msdf) follow the same pattern.
export {};
