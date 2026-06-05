// aether/scroll — Lenis ↔ GSAP ScrollTrigger bridge.
//
// `ScrollBridge` wraps a Lenis instance: brand-tuned options passed through,
// the `ScrollTrigger.update` wiring, idempotent plugin registration, and the
// seconds→ms raf conversion. Construct only when smooth scroll is enabled
// (touch / low tier run native scroll, which ScrollTrigger reads by default).
//
// `createScrollProgress` makes one scrubbed ScrollTrigger mapping page-scroll
// progress (0..1) to a callback — the reusable "scroll drives a 3D value"
// shape. Event-style triggers (class/attr toggles) stay in site code.
export { ScrollBridge, type ScrollBridgeOptions } from './scrollBridge';
export {
  createScrollProgress,
  type ScrollProgressOptions,
  type ScrollProgressTrigger,
} from './scrollProgress';
