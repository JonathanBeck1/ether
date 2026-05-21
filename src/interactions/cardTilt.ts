/**
 * 3D card-tilt hover effect — Resn / Active Theory pattern.
 *
 * For each [data-tilt] element, tracks pointer position relative to the
 * card and applies a tiny rotate3d to the inner .project-card__media
 * element via CSS variables. Rotation is bounded to MAX_TILT_DEG — the
 * point is "this responds to me," not "this is a 3D toy."
 *
 * Smoothness: pointermove writes a TARGET tilt; a single shared rAF
 * loop lerps every active card's CURRENT tilt toward its target each
 * frame. This means:
 *   • Active mousemove → snappy follow (lerp factor 0.18 per frame =
 *     ~80% there in 8 frames at 60fps, basically instant)
 *   • Pointer leaves → target snaps to 0, lerp eases back smoothly
 *   • One rAF for all cards = O(n) per frame, no per-card listeners
 *     fighting.
 *
 * Reduced-motion: skip entirely. CSS will leave transform at default.
 *
 * Production caveats:
 *   • Only fires on devices with a fine pointer (no-op on touch).
 *   • Re-runs on Astro view transitions (idempotent — clears existing
 *     state before re-binding).
 */

const MAX_TILT_DEG = 4; // ± per axis at the corners
const HOVER_SCALE = 1.015; // subtle lift on hover, NOT a "pop"
const LERP = 0.18; // per-frame easing toward target (snappy follow)
const REST_LERP = 0.10; // slower ease back to rest when pointer leaves

interface TiltState {
  el: HTMLElement;
  inner: HTMLElement | null;
  targetX: number; // target X tilt in degrees
  targetY: number;
  targetScale: number;
  curX: number; // current interpolated values (what's actually rendered)
  curY: number;
  curScale: number;
  active: boolean; // pointer currently over the card?
}

let states: TiltState[] = [];
let rafId: number | null = null;
let teardown: (() => void) | null = null;

function tick() {
  let anyMoving = false;

  for (const s of states) {
    const lerpFactor = s.active ? LERP : REST_LERP;
    s.curX += (s.targetX - s.curX) * lerpFactor;
    s.curY += (s.targetY - s.curY) * lerpFactor;
    s.curScale += (s.targetScale - s.curScale) * lerpFactor;

    // Snap-to-zero threshold so we stop animating idle cards (saves
    // a few ms per frame when many cards exist).
    if (
      !s.active &&
      Math.abs(s.curX) < 0.01 &&
      Math.abs(s.curY) < 0.01 &&
      Math.abs(s.curScale - 1) < 0.0005
    ) {
      s.curX = 0;
      s.curY = 0;
      s.curScale = 1;
    } else {
      anyMoving = true;
    }

    // Apply to the inner media element (where transform-style:preserve-3d
    // lives). Falls back to the card itself if no inner found.
    const target = s.inner ?? s.el;
    target.style.setProperty('--tilt-x', `${s.curX.toFixed(3)}deg`);
    target.style.setProperty('--tilt-y', `${s.curY.toFixed(3)}deg`);
    target.style.setProperty('--tilt-scale', s.curScale.toFixed(4));
  }

  // Keep ticking only if anything is still moving — saves CPU on idle
  // pages with no hover activity.
  if (anyMoving) {
    rafId = requestAnimationFrame(tick);
  } else {
    rafId = null;
  }
}

function ensureTicking() {
  if (rafId === null) {
    rafId = requestAnimationFrame(tick);
  }
}

function onPointerMove(this: HTMLElement, e: PointerEvent) {
  const s = states.find((st) => st.el === this);
  if (!s) return;

  const rect = this.getBoundingClientRect();
  // Normalize pointer position to [-0.5, 0.5] inside the card
  const nx = (e.clientX - rect.left) / rect.width - 0.5;
  const ny = (e.clientY - rect.top) / rect.height - 0.5;

  // Y-axis cursor → X-axis rotation (negative so cursor-down tilts
  // top-toward-camera, matching natural perspective).
  s.targetX = -ny * 2 * MAX_TILT_DEG;
  // X-axis cursor → Y-axis rotation.
  s.targetY = nx * 2 * MAX_TILT_DEG;
  s.targetScale = HOVER_SCALE;
  s.active = true;
  ensureTicking();
}

function onPointerLeave(this: HTMLElement) {
  const s = states.find((st) => st.el === this);
  if (!s) return;
  s.targetX = 0;
  s.targetY = 0;
  s.targetScale = 1;
  s.active = false;
  ensureTicking();
}

export function initCardTilt(): void {
  // Idempotent — tear down previous instance first (safe across Astro
  // view transitions / HMR).
  if (teardown) teardown();

  // Skip on devices without a fine pointer (touch, mostly). The hover
  // effect requires a real cursor to make sense.
  if (typeof window === 'undefined') return;
  if (!window.matchMedia('(pointer: fine)').matches) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const cards = document.querySelectorAll<HTMLElement>('[data-tilt]');
  if (cards.length === 0) return;

  states = Array.from(cards).map((el) => ({
    el,
    inner: el.querySelector<HTMLElement>('.project-card__media'),
    targetX: 0,
    targetY: 0,
    targetScale: 1,
    curX: 0,
    curY: 0,
    curScale: 1,
    active: false,
  }));

  for (const s of states) {
    s.el.addEventListener('pointermove', onPointerMove);
    s.el.addEventListener('pointerleave', onPointerLeave);
  }

  teardown = () => {
    for (const s of states) {
      s.el.removeEventListener('pointermove', onPointerMove);
      s.el.removeEventListener('pointerleave', onPointerLeave);
    }
    states = [];
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    teardown = null;
  };
}
