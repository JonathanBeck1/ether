// @taketwo/kit/dev — development overlays + diagnostics.
//
// Import lazily and gate behind a URL param so the cost only lands
// when explicitly requested. Safe to ship in production builds —
// the overlay does nothing until mounted.
export { Stats } from './Stats';
