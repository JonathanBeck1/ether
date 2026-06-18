// Self-contained styling: brand tokens as CSS custom properties on the SHELL
// ROOT ONLY (never document.documentElement — no host leak), plus one scoped
// <style> string whose every selector is prefixed with [data-kit-tweaks].

export const TOKENS = {
  '--tw-violet': '#e66cff',
  '--tw-teal': '#59ffe2',
  '--tw-coral': '#ff7d4e',
  '--tw-glass': 'rgba(10,12,20,0.72)',
  '--tw-black': '#05060a',
  '--tw-navy': '#0a0e1a',
  '--tw-text': '#ffffff',
  '--tw-muted': '#8891aa',
  '--tw-hairline': 'rgba(255,255,255,0.08)',
  '--tw-groove': 'rgba(255,255,255,0.08)',
  '--tw-fill': 'linear-gradient(90deg, var(--tw-violet), var(--tw-teal))',
  '--tw-font-mono': "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  '--tw-font-display': "'Staatliches', 'IBM Plex Mono', monospace",
  '--tw-radius': '8px',
  '--tw-accent': '#e66cff', // per-group override sets this inline on the group element
} as const;

/** Set the brand tokens on the shell root. Never touches document.documentElement. */
export function applyTokens(shellRoot: HTMLElement): void {
  for (const k in TOKENS) {
    shellRoot.style.setProperty(k, TOKENS[k as keyof typeof TOKENS]);
  }
}

// IBM Plex Mono is NOT shipped by the host (global.css imports Staatliches +
// IBM Plex Sans only). Inject it so the panel's mono identity holds; degrades
// to ui-monospace if the dev is offline.
const FONT_FACE = `
@font-face {
  font-family: 'IBM Plex Mono';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('https://cdn.jsdelivr.net/fontsource/fonts/ibm-plex-mono@latest/latin-400-normal.woff2') format('woff2');
}
@font-face {
  font-family: 'IBM Plex Mono';
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  src: url('https://cdn.jsdelivr.net/fontsource/fonts/ibm-plex-mono@latest/latin-500-normal.woff2') format('woff2');
}`;

// The full class vocabulary. Controls and chrome REUSE these names; they do
// not invent their own. Every rule is prefixed with the shell attribute, so it
// travels with the panel and leaks nothing.
export const SCOPED_CSS = `${FONT_FACE}
[data-kit-tweaks] { box-sizing: border-box; font-family: var(--tw-font-mono); color: var(--tw-text); font-size: 11px; line-height: 1.5; letter-spacing: 0.04em; }
[data-kit-tweaks] *, [data-kit-tweaks] *::before, [data-kit-tweaks] *::after { box-sizing: border-box; }

/* ── Shell ─────────────────────────────────────────────── */
[data-kit-tweaks].tw-root { background: var(--tw-glass); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); border: 1px solid var(--tw-hairline); border-radius: var(--tw-radius); overflow: hidden; box-shadow: 0 12px 48px rgba(0,0,0,0.5); }
[data-kit-tweaks] .tw-body { max-height: 70vh; overflow-y: auto; overscroll-behavior: contain; }
[data-kit-tweaks].tw-collapsed .tw-body, [data-kit-tweaks].tw-collapsed .tw-footer { display: none; }

/* ── Header ────────────────────────────────────────────── */
[data-kit-tweaks] .tw-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; cursor: grab; border-bottom: 1px solid var(--tw-hairline); user-select: none; }
[data-kit-tweaks] .tw-header:active { cursor: grabbing; }
[data-kit-tweaks] .tw-title { font-family: var(--tw-font-display); font-size: 18px; letter-spacing: 0.08em; }
[data-kit-tweaks] .tw-header-actions { display: flex; align-items: center; gap: 6px; }

/* ── Group ─────────────────────────────────────────────── */
[data-kit-tweaks] .tw-group { border-bottom: 1px solid var(--tw-hairline); border-left: 2px solid var(--tw-accent); }
[data-kit-tweaks] .tw-group-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 12px; cursor: pointer; color: var(--tw-muted); text-transform: uppercase; }
[data-kit-tweaks] .tw-group-body { padding: 4px 12px 10px; display: flex; flex-direction: column; gap: 8px; }
[data-kit-tweaks] .tw-group.tw-collapsed .tw-group-body { display: none; }

/* ── Row scaffold (BaseControl) ────────────────────────── */
[data-kit-tweaks] .tw-row { display: flex; align-items: center; gap: 10px; min-height: 28px; }
[data-kit-tweaks] .tw-row.tw-disabled { opacity: 0.4; pointer-events: none; }
[data-kit-tweaks] .tw-label { flex: 0 0 auto; width: 38%; color: var(--tw-muted); font-size: 11px; letter-spacing: 0.04em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
[data-kit-tweaks] .tw-widget { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 8px; }
[data-kit-tweaks] .tw-dot { flex: 0 0 auto; width: 6px; height: 6px; border-radius: 50%; background: var(--tw-accent); opacity: 0; transition: opacity 120ms ease; }
[data-kit-tweaks] .tw-row.tw-dirty .tw-dot { opacity: 1; }
[data-kit-tweaks] .tw-reset { flex: 0 0 auto; width: 16px; height: 16px; padding: 0; border: 0; background: none; color: var(--tw-muted); cursor: pointer; opacity: 0; transition: opacity 120ms ease; font-size: 12px; line-height: 1; }
[data-kit-tweaks] .tw-row:hover .tw-reset, [data-kit-tweaks] .tw-row.tw-dirty .tw-reset { opacity: 0.7; }
[data-kit-tweaks] .tw-reset:hover { opacity: 1; color: var(--tw-text); }

/* ── Slider (built by controls task; vocabulary frozen here) ── */
[data-kit-tweaks] .tw-slider { position: relative; flex: 1 1 auto; height: 28px; display: flex; align-items: center; cursor: pointer; touch-action: none; }
[data-kit-tweaks] .tw-slider-track { position: relative; width: 100%; height: 4px; border-radius: 2px; background: var(--tw-groove); }
[data-kit-tweaks] .tw-slider-fill { position: absolute; top: 0; left: 0; height: 100%; border-radius: 2px; background: var(--tw-fill); background-repeat: no-repeat; }
[data-kit-tweaks] .tw-thumb { position: absolute; top: 50%; width: 12px; height: 12px; border-radius: 50%; background: var(--tw-text); transform: translate(-50%, -50%); box-shadow: 0 0 0 1px rgba(255,255,255,.25), 0 0 12px 2px var(--tw-accent); transition: box-shadow 120ms ease, transform 120ms ease; }
[data-kit-tweaks] .tw-slider.tw-grabbing .tw-thumb { transform: translate(-50%, -50%) scale(1.25); box-shadow: 0 0 0 1px rgba(255,255,255,.35), 0 0 18px 4px var(--tw-accent); }
[data-kit-tweaks] .tw-readout { flex: 0 0 auto; min-width: 52px; text-align: right; color: var(--tw-text); cursor: ew-resize; font-variant-numeric: tabular-nums; }
[data-kit-tweaks] .tw-input { width: 100%; background: transparent; border: 0; color: var(--tw-text); font: inherit; text-align: right; }
[data-kit-tweaks] :focus-visible { outline: 2px solid var(--tw-accent); outline-offset: 2px; }

/* ── Color (built by controls task; vocabulary frozen here) ── */
[data-kit-tweaks] .tw-color { flex: 1 1 auto; }
[data-kit-tweaks] .tw-color-row { display: flex; align-items: center; gap: 8px; cursor: pointer; }
[data-kit-tweaks] .tw-swatch { flex: 0 0 auto; width: 18px; height: 18px; border-radius: 4px; border: 1px solid var(--tw-hairline); }
[data-kit-tweaks] .tw-hex { color: var(--tw-text); font-variant-numeric: tabular-nums; }
[data-kit-tweaks] .tw-color-panel { overflow: hidden; height: 0; transition: height 200ms ease; }
[data-kit-tweaks] .tw-color-panel.tw-open { height: auto; }
[data-kit-tweaks] .tw-sv { position: relative; touch-action: none; cursor: crosshair; border-radius: 4px; }
[data-kit-tweaks] .tw-hue { position: relative; touch-action: none; cursor: ns-resize; border-radius: 4px; }
[data-kit-tweaks] .tw-cursor { position: absolute; width: 12px; height: 12px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.5); transform: translate(-50%, -50%); pointer-events: none; }
[data-kit-tweaks] .tw-rgb { display: flex; gap: 6px; }
[data-kit-tweaks] .tw-rgb-field { flex: 1 1 0; cursor: ew-resize; }
[data-kit-tweaks] .tw-swatches { display: flex; gap: 6px; }
[data-kit-tweaks] .tw-chip { width: 18px; height: 18px; border-radius: 4px; border: 1px solid var(--tw-hairline); cursor: pointer; padding: 0; }
[data-kit-tweaks] .tw-eyedropper { background: none; border: 1px solid var(--tw-hairline); border-radius: 4px; color: var(--tw-muted); cursor: pointer; font: inherit; padding: 2px 6px; }

/* ── Toggle (built by controls task; vocabulary frozen here) ── */
[data-kit-tweaks] .tw-toggle { flex: 0 0 auto; width: 34px; height: 18px; border-radius: 9px; background: var(--tw-groove); border: 1px solid var(--tw-hairline); cursor: pointer; padding: 0; position: relative; }
[data-kit-tweaks] .tw-toggle.tw-on { background: var(--tw-accent); }
[data-kit-tweaks] .tw-toggle-knob { position: absolute; top: 1px; left: 1px; width: 14px; height: 14px; border-radius: 50%; background: var(--tw-text); transition: transform 180ms ease; }
[data-kit-tweaks] .tw-toggle.tw-on .tw-toggle-knob { transform: translateX(16px); }

/* ── Select — segmented pills (≤4) ───────────────────────── */
[data-kit-tweaks] .tw-segments { display: flex; flex: 1 1 auto; gap: 2px; padding: 2px; background: var(--tw-groove); border-radius: 6px; }
[data-kit-tweaks] .tw-segment { flex: 1 1 0; min-width: 0; padding: 3px 6px; border: 0; border-radius: 4px; background: none; color: var(--tw-muted); cursor: pointer; font: inherit; letter-spacing: 0.04em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: background 120ms ease, color 120ms ease; }
[data-kit-tweaks] .tw-segment:hover { color: var(--tw-text); }
[data-kit-tweaks] .tw-segment.tw-on { background: var(--tw-accent); color: var(--tw-black); }

/* ── Select — bespoke dropdown (>4) ──────────────────────── */
[data-kit-tweaks] .tw-select { position: relative; flex: 1 1 auto; min-width: 0; }
[data-kit-tweaks] .tw-select-trigger { width: 100%; display: flex; align-items: center; justify-content: space-between; padding: 4px 8px; border: 1px solid var(--tw-hairline); border-radius: 4px; background: var(--tw-groove); color: var(--tw-text); cursor: pointer; font: inherit; text-align: left; }
[data-kit-tweaks] .tw-select-trigger::after { content: '▾'; color: var(--tw-muted); margin-left: 8px; }
[data-kit-tweaks] .tw-select-trigger:hover { border-color: var(--tw-accent); }
[data-kit-tweaks] .tw-select-list { position: absolute; top: calc(100% + 2px); left: 0; right: 0; max-height: 180px; overflow-y: auto; overscroll-behavior: contain; background: var(--tw-navy); border: 1px solid var(--tw-hairline); border-radius: 4px; padding: 4px; display: none; flex-direction: column; gap: 2px; z-index: 2; }
[data-kit-tweaks] .tw-select-list.tw-open { display: flex; }
[data-kit-tweaks] .tw-select-option { padding: 4px 8px; border: 0; border-radius: 3px; background: none; color: var(--tw-text); cursor: pointer; font: inherit; text-align: left; }
[data-kit-tweaks] .tw-select-option:hover { background: var(--tw-accent); color: var(--tw-black); }

/* ── Interval — dual-thumb band ──────────────────────────── */
[data-kit-tweaks] .tw-interval .tw-thumb { left: 0; }
[data-kit-tweaks] .tw-interval-readouts { flex: 0 0 auto; display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
[data-kit-tweaks] .tw-interval-readouts .tw-readout { min-width: 44px; }

/* ── Monitor — readout + sparkline (read-only) ───────────── */
[data-kit-tweaks] .tw-spark { flex: 1 1 auto; min-width: 0; height: 18px; }
[data-kit-tweaks] .tw-spark-line { fill: none; stroke: var(--tw-accent); stroke-width: 1.25; stroke-linejoin: round; stroke-linecap: round; vector-effect: non-scaling-stroke; }
[data-kit-tweaks] .tw-readout.tw-monitor { cursor: default; color: var(--tw-muted); }

/* ── Vector — XY pad + per-axis scrubs ───────────────────── */
[data-kit-tweaks] .tw-vector { flex: 1 1 auto; display: flex; align-items: center; gap: 10px; }
[data-kit-tweaks] .tw-xy { position: relative; flex: 0 0 auto; background: var(--tw-groove); border: 1px solid var(--tw-hairline); border-radius: 4px; touch-action: none; cursor: crosshair; background-image: linear-gradient(var(--tw-hairline) 1px, transparent 1px), linear-gradient(90deg, var(--tw-hairline) 1px, transparent 1px); background-size: 50% 50%; background-position: center; }
[data-kit-tweaks] .tw-xy-handle { position: absolute; top: 50%; left: 50%; width: 12px; height: 12px; border-radius: 50%; background: var(--tw-text); transform: translate(-50%, -50%); box-shadow: 0 0 0 1px rgba(255,255,255,.25), 0 0 12px 2px var(--tw-accent); transition: box-shadow 120ms ease, transform 120ms ease; }
[data-kit-tweaks] .tw-xy.tw-grabbing .tw-xy-handle { transform: translate(-50%, -50%) scale(1.25); box-shadow: 0 0 0 1px rgba(255,255,255,.35), 0 0 18px 4px var(--tw-accent); }
[data-kit-tweaks] .tw-vector-fields { flex: 1 1 auto; display: flex; flex-direction: column; gap: 2px; }
[data-kit-tweaks] .tw-vector-field { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
[data-kit-tweaks] .tw-axis-tag { color: var(--tw-muted); text-transform: uppercase; }
[data-kit-tweaks] .tw-vector-field .tw-readout { min-width: 44px; }

/* ── Footer + chrome (built by chrome task; vocabulary frozen here) ── */
[data-kit-tweaks] .tw-footer { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-top: 1px solid var(--tw-hairline); flex-wrap: wrap; }
[data-kit-tweaks] .tw-btn { background: none; border: 1px solid var(--tw-hairline); border-radius: 4px; color: var(--tw-text); cursor: pointer; font: inherit; padding: 4px 8px; letter-spacing: 0.04em; }
[data-kit-tweaks] .tw-btn:hover { border-color: var(--tw-accent); }
[data-kit-tweaks] .tw-count { color: var(--tw-muted); margin-left: auto; }
[data-kit-tweaks] .tw-chip-overrides { color: var(--tw-coral); }
[data-kit-tweaks] .tw-menu { position: relative; }
[data-kit-tweaks] .tw-menu-list { position: absolute; top: 100%; right: 0; background: var(--tw-navy); border: 1px solid var(--tw-hairline); border-radius: 4px; min-width: 160px; display: none; z-index: 1; padding: 4px; flex-direction: column; gap: 4px; }
[data-kit-tweaks] .tw-menu-list.tw-open { display: flex; }
[data-kit-tweaks] .tw-menu-item { display: flex; align-items: center; gap: 4px; }
[data-kit-tweaks] .tw-menu-item > .tw-btn:first-child { flex: 1 1 auto; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

@media (prefers-reduced-motion: reduce) {
  [data-kit-tweaks] * { transition: none !important; animation: none !important; }
}`;
