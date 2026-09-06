// ether/text — type as FORM.
//
// `extrudedWord(word, font, opts)` returns per-letter `ExtrudeGeometry`
// instances ready to mount into a `THREE.Group`. Each letter comes with
// its canonical `assembledPosition` + `assembledScale` so any
// drift / scramble system has a single source of truth for "rest" pose.
// The caller wraps each geometry with its own material — keeping the
// shader/brand layer out of kit.
//
// Type as TEXT — crisp MSDF meshes via troika-three-text — lives at
// `ether/text/msdf`, its own entry so this one never pulls that optional
// peer into a site that only extrudes.
export {
  extrudedWord,
  type ExtrudedLetter,
  type ExtrudedWordOptions,
  type ExtrudeProfile,
} from './extrudedWord';
