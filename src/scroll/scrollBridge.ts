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
 * (low-end runs native scroll, which ScrollTrigger reads by default). Touch
 * gets the bridge via Lenis `syncTouch` — smoothing on top of native iOS
 * momentum, not a hijack — so touch feeds ScrollTrigger the same rAF-synced
 * position desktop does.
 *
 * Lifecycle: construct at `enterTransition` START (never the scene
 * constructor) → `raf(time)` each frame in tick → `destroy()` in
 * exit/dispose. Lenis intercepts wheel input from the moment it exists
 * but only moves the page when `raf` is pumped — and a scene's tick only
 * runs once it is the manager's activeScene, AFTER preload. A
 * constructor-built bridge therefore eats every wheel event for the
 * preload window and dumps the accumulated delta as a lurch when ticking
 * starts. Before enter, native scroll handles input fine.
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
