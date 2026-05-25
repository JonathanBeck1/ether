/**
 * Quality tier detection.
 *
 * Probes the user's GPU once at boot via `detect-gpu` (browsing-data-backed
 * benchmark of every shipping GPU) and folds the result into ONE enum that
 * every other module reads. Don't query `navigator.userAgent` or
 * `hardwareConcurrency` elsewhere — read `getQuality()` and branch on the
 * tier.
 *
 * Three tiers, picked for what the rest of the engine can toggle cheaply:
 *
 *   LOW   - bottom-tier integrated GPUs (older iPhones, Chromebooks, base
 *           Android). DPR pinned to 1, no MSAA, NO post-processing composer
 *           (raw renderer.render), no smooth-scroll bridge (let the OS do
 *           native scroll). Goal: hold 30fps without melting the device.
 *
 *   MID   - mid-range mobile / older desktop. DPR clamped to 1.5, MSAA on,
 *           composer with bloom only (no dither). Goal: 60fps with most of
 *           the visual identity intact.
 *
 *   HIGH  - everything else (recent desktop, M-series Macs, flagship phones).
 *           Full quality: DPR 2, MSAA, full bloom + dither.
 *
 * Why we don't sniff UA: spoofed strings, lying iPads, etc. detect-gpu has a
 * vetted benchmark per GPU model + a fallback fingerprint.
 */

import { getGPUTier } from 'detect-gpu';

export type QualityTier = 'LOW' | 'MID' | 'HIGH';

export interface QualityProfile {
  tier: QualityTier;
  /** 0..1, lower = weaker GPU. Useful for analytics/debug only. */
  rawScore: number;
  /** Pixel-ratio cap. Renderer should `min(window.devicePixelRatio, dprCap)`. */
  dprCap: number;
  /** Whether the renderer should request MSAA antialias. */
  antialias: boolean;
  /** Whether to build the post-processing composer at all. */
  enablePostFX: boolean;
  /** Whether to include dither (the most expensive pass after bloom). */
  enableDither: boolean;
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

  // Hover-fine = mouse/trackpad. No hover = touch primary. We treat touch as
  // a strong hint toward LOW because (a) most touch devices are mid-tier or
  // worse, (b) Lenis on touch fights iOS native scroll, and (c) it's the
  // single biggest perf cliff in the codebase.
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
  // — they explicitly asked for less stuff happening.
  if (reducedMotion && tier === 'HIGH') tier = 'MID';
  if (reducedMotion && tier === 'MID') tier = 'LOW';

  cached = {
    tier,
    rawScore,
    dprCap:             tier === 'LOW' ? 1   : tier === 'MID' ? 1.5 : 2,
    antialias:          tier !== 'LOW',
    // Postprocessing on ALL tiers — bloom is critical for the violet
    // rim halo on text/sculpture work. A single bloom pass is cheap
    // enough that even modern "LOW" tier phones (iPhone 11 base, etc.)
    // can handle it. Without bloom the brand glow disappears entirely.
    enablePostFX:       true,
    enableDither:       tier === 'HIGH',
    enableSmoothScroll: tier !== 'LOW' && !isTouch,
    reducedMotion,
  };
  return cached;
}

/** Sync read for code paths that can't await. Returns null pre-detection. */
export function getQuality(): QualityProfile | null {
  return cached;
}
