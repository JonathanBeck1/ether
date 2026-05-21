// @taketwo/kit/interactions — DOM-side micro-interactions.
//
// `initCardTilt()` binds a Resn / Active Theory style 3D-card hover-tilt
// to every `[data-tilt]` element. Single shared rAF, snap-to-zero idle,
// fine-pointer gated, reduced-motion safe, idempotent re-binding across
// Astro view transitions. Cards expose three CSS vars on their inner
// `.project-card__media` (or fall back to the card itself):
//   --tilt-x, --tilt-y, --tilt-scale
// Style the rotate3d/scale however you want in CSS.
export { initCardTilt } from './cardTilt';
