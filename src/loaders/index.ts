// ether/loaders — asset loading with one progress value.
//
// Thin promise wrappers over three's loaders (`GLTFLoader` + Draco/KTX2,
// `RGBELoader` + PMREM, `TextureLoader`) that all accept `{ progress,
// weight }` from `createProgress()`, so a loading beat reads ONE number.
// Decoders are never fetched from a CDN: you serve them and pass the
// path. The kit does not own an asset pipeline — compress and optimise
// offline (gltf-transform, toktx), load here.
export { createProgress, type Progress, type TrackOptions } from './progress';
export { loadGLTF, type LoadGLTFOptions } from './gltf';
export { loadTexture, type LoadTextureOptions } from './texture';
export { loadHDR, type HDRResult, type LoadHDROptions } from './hdr';
