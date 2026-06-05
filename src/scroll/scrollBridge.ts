import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

let pluginRegistered = false;

/** Register the GSAP ScrollTrigger plugin exactly once. `gsap.registerPlugin`
 *  is itself idempotent; the module flag avoids call churn across HMR and
 *  repeated scene construction. Internal — not part of the public barrel. */
export function ensureScrollTriggerRegistered(): void {
  if (pluginRegistered) return;
  gsap.registerPlugin(ScrollTrigger);
  pluginRegistered = true;
}

/** Options forwarded verbatim to `new Lenis(...)`. Brand tuning (duration,
 *  easing, multipliers) lives in the consuming site's constants. */
export type ScrollBridgeOptions = NonNullable<ConstructorParameters<typeof Lenis>[0]>;

/**
 * Lenis ↔ GSAP ScrollTrigger bridge — the engine half of the smooth-scroll
 * pattern. Owns the three things a site shouldn't have to: registering the
 * ScrollTrigger plugin, wiring `lenis.on('scroll', ScrollTrigger.update)` so
 * ScrollTrigger reads the smoothed position, and the seconds→milliseconds
 * `raf` conversion (our render loop ticks in seconds; Lenis wants ms).
 *
 * Smooth scroll is optional: construct only when the quality tier enables it
 * (touch / low-end run native scroll, which ScrollTrigger reads by default).
 * Lifecycle: construct in the scene ctor → `raf(time)` each frame in tick →
 * `scrollTo(0, { immediate: true })` in preload → `destroy()` in dispose.
 */
export class ScrollBridge {
  readonly lenis: Lenis;

  constructor(options?: ScrollBridgeOptions) {
    ensureScrollTriggerRegistered();
    this.lenis = new Lenis(options);
    this.lenis.on('scroll', ScrollTrigger.update);
  }

  /** Advance Lenis by one frame. Pass the monotonic SECONDS your `Scene.tick`
   *  receives; the bridge converts to the milliseconds Lenis expects. */
  raf(timeSeconds: number): void {
    this.lenis.raf(timeSeconds * 1000);
  }

  /** Forward to `lenis.scrollTo`. Use `scrollTo(0, { immediate: true })` in
   *  preload to defeat browser scroll restoration before the intro plays. */
  scrollTo(target: number | string | HTMLElement, opts?: { immediate?: boolean }): void {
    this.lenis.scrollTo(target, opts);
  }

  /** Tear down Lenis and remove its scroll listener. */
  destroy(): void {
    this.lenis.destroy();
  }
}
