// ether/text — 3D type helpers.
//
// `extrudedWord(word, font, opts)` returns per-letter `ExtrudeGeometry`
// instances ready to mount into a `THREE.Group`. Each letter comes with
// its canonical `assembledPosition` + `assembledScale` so any
// drift / scramble system has a single source of truth for "rest" pose.
// The caller wraps each geometry with its own material — keeping the
// shader/brand layer out of kit.
//
// Future: MSDF wrapper around `troika-three-text` for crisp ranging-zoom
// type. Same module, different entry point.
export {
  extrudedWord,
  type ExtrudedLetter,
  type ExtrudedWordOptions,
  type ExtrudeProfile,
} from './extrudedWord';
