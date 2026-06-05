// aether/quality — GPU tier detection.
//
// `detectQuality()` resolves the user's GPU once via `detect-gpu` and
// returns a `QualityProfile` with one enum (LOW/MID/HIGH) + the
// pre-computed renderer + UX settings every other module should branch
// on (DPR cap, antialias, postprocessing on/off, smooth-scroll on/off).
export {
  detectQuality,
  getQuality,
  type QualityProfile,
  type QualityTier,
} from './quality';
