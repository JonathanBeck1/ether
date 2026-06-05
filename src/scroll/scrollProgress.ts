import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ensureScrollTriggerRegistered } from './scrollBridge';

export interface ScrollProgressOptions {
  /** ScrollTrigger `end` (e.g. `'+=60%'`, `'bottom bottom'`, a number). */
  end: string | number;
  /** ScrollTrigger `scrub` smoothing in seconds, or `true`. */
  scrub: number | boolean;
  /** ScrollTrigger `trigger`. Default `'body'` (full-page progress). */
  trigger?: Element | string;
  /** ScrollTrigger `start`. Default `'top top'`. */
  start?: string | number;
}

/** Handle over a scroll-progress ScrollTrigger. */
export interface ScrollProgressTrigger {
  /** The underlying ScrollTrigger, for `refresh()` / advanced use. */
  readonly trigger: ScrollTrigger;
  /** Kill the trigger. Call in `Scene.dispose`. */
  kill(): void;
}

/**
 * Make a scrubbed ScrollTrigger that maps page-scroll progress (0..1) to a
 * callback — the one reusable "scroll drives a 3D value" shape (e.g. drift
 * progress, camera push-back). Event-style triggers (class/attr toggles on
 * enter/leave) stay in site code; they're brand-specific and not worth
 * abstracting.
 *
 * Registers the ScrollTrigger plugin on first use, so this also works on the
 * native-scroll path (no `ScrollBridge` required).
 *
 * @param onProgress called every scroll frame with the trigger's progress
 *                   (0..1). Keep it cheap — it runs on the scroll thread.
 */
export function createScrollProgress(
  onProgress: (progress: number) => void,
  options: ScrollProgressOptions,
): ScrollProgressTrigger {
  ensureScrollTriggerRegistered();
  const trigger = ScrollTrigger.create({
    trigger: options.trigger ?? 'body',
    start: options.start ?? 'top top',
    end: options.end,
    scrub: options.scrub,
    onUpdate: (self: ScrollTrigger) => onProgress(self.progress),
  });
  return { trigger, kill: () => trigger.kill() };
}
