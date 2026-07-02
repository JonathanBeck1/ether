/**
 * Quality tier detection.
 *
 * Probes the user's GPU once at boot via `detect-gpu` (browsing-data-backed
 * benchmark of every shipping GPU) and folds the result into ONE enum that
 * every other module reads. Don't query `navigator.userAgent` or
 * `hardwareConcurrency` elsewhere — read `getQuality()` and branch on the
 * tier.
 *
 * Three tiers, picked for what the rest of the engine can toggle cheaply
 * (the numbers below mirror the profile constructed at the bottom of this
 * file — update BOTH when tuning):
 *
 *   LOW   - bottom-tier integrated GPUs (older iPhones, Chromebooks, base
 *           Android). DPR capped 1.5, composer with bloom + dither (the
 *           brand glow is non-negotiable), NO composer MSAA, native scroll
 *           (no Lenis bridge). Goal: hold 30fps without melting the device.
 *
 *   MID   - mid-range mobile / older desktop. DPR capped 1.5, composer with
 *           bloom + dither, 2× composer MSAA, smooth scroll on. Goal: 60fps
 *           with the full visual identity.
 *
 *   HIGH  - everything else (recent desktop, M-series Macs, flagship phones).
 *           DPR 2, 4× composer MSAA, bloom + dither, smooth scroll.
 *
 * Why we don't sniff UA: spoofed strings, lying iPads, etc. detect-gpu has a
 * vetted benchmark per GPU model + a fallback fingerprint.
 */

import { getGPUTier } from 'detect-gpu';

export type QualityTier = 'LOW' | 'MID' | 'HIGH';

export interface QualityProfile {
  tier: QualityTier;
  /** detect-gpu's raw fps benchmark for the detected GPU (0 when unknown).
   *  NOT normalized — useful for analytics/debug only. */
  rawScore: number;
  /** Pixel-ratio cap. Renderer should `min(window.devicePixelRatio, dprCap)`. */
  dprCap: number;
  /**
   * Whether the renderer should request CONTEXT MSAA. Only meaningful
   * when no composer runs: post-processing renders into textures that
   * bypass the canvas framebuffer, making this flag visually dead (and
   * a memory cost). With `enablePostFX` true, real edge AA comes from
   * `msaaSamples` instead.
   */
  antialias: boolean;
  /** Whether to build the post-processing composer at all. */
  enablePostFX: boolean;
  /**
   * Whether to include dither. NOT expensive — it's a handful of ALU
   * ops merged into the SAME fullscreen pass as bloom. Without it the
   * dark-field gradients band visibly, worst on mobile OLED, where the
   * posterization reads as wrong colors.
   */
  enableDither: boolean;
  /**
   * MSAA sample count for the composer's render targets (WebGL2) — the
   * antialiasing that actually reaches the screen when post-processing
   * is on. 0 disables. Cheap on mobile tile GPUs.
   */
  msaaSamples: number;
  /** Whether the page should run Lenis smooth-scroll. */
  enableSmoothScroll: boolean;
  /** True if the user has prefers-reduced-motion. Mirrored here for one-stop reads. */
  reducedMotion: boolean;
}

let cached: QualityProfile | null = null;

/** Resolve once at boot. Subsequent calls return the cached profile. */
export async function detectQuality(): Promise<QualityProfile> {
  if (cached) return cached;

  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Hover-fine = mouse/trackpad. No hover = touch primary. Used only to
  // nudge tier-1 GPUs down to LOW. (We no longer gate smooth-scroll on
  // touch: Lenis 1.3.23 `syncTouch` smooths ON TOP of native iOS
  // momentum rather than hijacking it, so the old "Lenis fights iOS"
  // concern is obsolete — touch now gets the same buttery scroll-to-3D
  // wiring as desktop. See enableSmoothScroll below.)
  const isTouch =
    typeof window !== 'undefined' &&
    !window.matchMedia('(hover: hover)').matches;

  let tier: QualityTier;
  let rawScore = 0;
  try {
    const gpu = await getGPUTier({
      // glContext: undefined → detect-gpu creates its own probe context.
      benchmarksURL: undefined, // use bundled defaults
    });
    rawScore = gpu.fps ?? 0;

    // detect-gpu returns tier 0..3. Map to our 3 buckets:
    //   tier 0 (no GPU / failed detection)     -> LOW
    //   tier 1                                 -> LOW on touch, MID on desktop
    //   tier 2                                 -> MID
    //   tier 3 (high-end discrete / Apple Silicon) -> HIGH
    if (gpu.tier === 0 || (gpu.tier === 1 && isTouch)) {
      tier = 'LOW';
    } else if (gpu.tier === 1 || gpu.tier === 2) {
      tier = 'MID';
    } else {
      tier = 'HIGH';
    }
  } catch (err) {
    // detect-gpu can throw if WebGL probe fails — assume LOW so we don't
    // melt whatever rendered the failure.
    console.warn('[quality] detect-gpu failed, defaulting to LOW:', err);
    tier = 'LOW';
  }

  // Reduced-motion users get downgraded one tier (HIGH→MID, MID→LOW, LOW→LOW)
  // — they explicitly asked for less stuff happening. Must be else-if: two
  // sequential ifs took HIGH→MID→LOW in one pass, double-downgrading
  // reduced-motion users on high-end GPUs (softer DPR + no MSAA + native
  // scroll on exactly the machines that could afford the quality).
  if (reducedMotion) {
    if (tier === 'HIGH') tier = 'MID';
    else if (tier === 'MID') tier = 'LOW';
  }

  cached = {
    tier,
    rawScore,
    // DPR cap: even LOW gets 1.5 now. Original LOW=1 was over-cautious
    // for the 2026 baseline — most "LOW" classifications in 2026 are
    // modern phones with detect-gpu tier 1 + touch. They handle DPR 1.5
    // + a single bloom pass easily. DPR=1 was making text and rim
    // details render soft on retina displays where 1 CSS px maps to
    // 2-3 device pixels — the visible jaggies are worse than the perf
    // cost of bumping to 1.5.
    dprCap:             tier === 'LOW' ? 1.5 : tier === 'MID' ? 1.5 : 2,
    // Context MSAA is dead weight whenever the composer runs (which is
    // every tier now) — post-processing renders into textures that
    // bypass the canvas framebuffer. Real edge AA = msaaSamples below.
    antialias:          false,
    // Postprocessing on ALL tiers — bloom is critical for the violet
    // rim halo on text/sculpture work. A single bloom pass is cheap
    // enough that even modern "LOW" tier phones (iPhone 11 base, etc.)
    // can handle it. Without bloom the brand glow disappears entirely.
    enablePostFX:       true,
    // Dither on ALL tiers: it shares bloom's fullscreen pass (a few
    // ALU ops, effectively free) and without it the dark-field
    // gradients band hard — worst on mobile OLED, where posterization
    // reads as wrong colors. (An earlier comment called this "the most
    // expensive pass after bloom" — measured wrong; retired.)
    enableDither:       true,
    // Composer-target MSAA — the AA that actually reaches the screen.
    // Tile-based mobile GPUs resolve MSAA nearly free; 2× on MID keeps
    // extruded letter edges clean at DPR 1.5 on 3× screens.
    msaaSamples:        tier === 'HIGH' ? 4 : tier === 'MID' ? 2 : 0,
    // Smooth scroll on every tier except LOW (weak GPUs can't spare the
    // extra rAF). Touch INCLUDED now — Lenis syncTouch gives phones the
    // same rAF-synced scroll position desktop has, which is what feeds
    // ScrollTrigger a smooth per-frame value (the buttery scroll-to-3D
    // feel). Without it, touch bound the 3D to iOS's stepped native
    // scroll and read as choppy.
    enableSmoothScroll: tier !== 'LOW',
    reducedMotion,
  };
  return cached;
}

/** Sync read for code paths that can't await. Returns null pre-detection. */
export function getQuality(): QualityProfile | null {
  return cached;
}
