import type { ColorDescriptor } from '../types';
import type { HSV } from '../color';
import { BaseControl } from './BaseControl';
import { el } from '../dom';
import { hexNormalize, hexToHsv, hsvToHex, hsvToRgb, rgbToHex } from '../color';
import { attachScrub } from '../scrub';

const SV_W = 168;
const SV_H = 120;
const HUE_W = 16;
const BRAND_SWATCHES = ['#e66cff', '#59ffe2', '#ff7d4e'];

/**
 * Bespoke HSV picker. Canonical store value is '#rrggbb' (no color-space
 * transform). The editing state is HSV — re-deriving HSV from RGB each frame
 * makes the hue handle jump in the dark/desaturated corner, so H/S/V are held
 * directly and only re-synced from hex when refreshed externally. Every edit
 * funnels through setHSV().
 */
export class ColorControl extends BaseControl<string> {
  private hsv: HSV = { h: 0, s: 0, v: 0 };
  private hex = '#000000';
  private open = false;

  private swatch!: HTMLElement;
  private hexLabel!: HTMLElement;
  private panel!: HTMLElement;

  private svCanvas!: HTMLCanvasElement;
  private svCursor!: HTMLElement;
  private hueCanvas!: HTMLCanvasElement;
  private hueCursor!: HTMLElement;

  private hexInput!: HTMLInputElement;
  private rgbInputs: HTMLInputElement[] = [];
  private rgbEditing: boolean[] = [false, false, false];
  private scrubDetach: Array<() => void> = [];

  constructor(desc: ColorDescriptor) {
    super(desc, 0);
    this.applyHex(this.capturedDefault);
  }

  protected buildWidget(): void {
    const wrap = el('div', { class: 'tw-color' });

    // ── Collapsed row: swatch + hex, click to expand ──
    const row = el('div', { class: 'tw-color-row' });
    this.swatch = el('span', { class: 'tw-swatch' });
    this.hexLabel = el('span', { class: 'tw-hex' });
    row.appendChild(this.swatch);
    row.appendChild(this.hexLabel);
    this.on(row, 'click', () => this.toggleOpen());

    // ── Expanded panel ──
    this.panel = el('div', { class: 'tw-color-panel' });
    const inner = el('div', { style: { padding: '8px 0', display: 'flex', flexDirection: 'column', gap: '8px' } });

    const pickers = el('div', { style: { display: 'flex', gap: '8px' } });

    this.svCanvas = el('canvas', { class: 'tw-sv' });
    this.svCanvas.width = SV_W;
    this.svCanvas.height = SV_H;
    Object.assign(this.svCanvas.style, { width: SV_W + 'px', height: SV_H + 'px' });
    const svBox = el('div', { style: { position: 'relative', flex: '1 1 auto' } });
    this.svCursor = el('div', { class: 'tw-cursor' });
    svBox.appendChild(this.svCanvas);
    svBox.appendChild(this.svCursor);

    this.hueCanvas = el('canvas', { class: 'tw-hue' });
    this.hueCanvas.width = HUE_W;
    this.hueCanvas.height = SV_H;
    Object.assign(this.hueCanvas.style, { width: HUE_W + 'px', height: SV_H + 'px' });
    const hueBox = el('div', { style: { position: 'relative', flex: '0 0 auto' } });
    this.hueCursor = el('div', { class: 'tw-cursor', style: { width: '100%', height: '4px', borderRadius: '2px', left: '50%' } });
    hueBox.appendChild(this.hueCanvas);
    hueBox.appendChild(this.hueCursor);

    pickers.appendChild(svBox);
    pickers.appendChild(hueBox);

    this.paintHue();

    // ── Hex field ──
    this.hexInput = el('input', { class: 'tw-input', attrs: { type: 'text', spellcheck: 'false' } });
    Object.assign(this.hexInput.style, { textAlign: 'left' });

    // ── R / G / B scrub fields ──
    const rgbRow = el('div', { class: 'tw-rgb' });
    for (let i = 0; i < 3; i++) {
      const field = el('input', { class: 'tw-input tw-rgb-field', attrs: { type: 'text', inputmode: 'numeric' } });
      rgbRow.appendChild(field);
      this.rgbInputs.push(field);
    }

    // ── EyeDropper + brand swatches ──
    const tools = el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } });
    const swatches = el('div', { class: 'tw-swatches' });
    for (const sw of BRAND_SWATCHES) {
      const chip = el('button', { class: 'tw-chip', style: { background: sw }, attrs: { type: 'button', 'aria-label': sw } });
      this.on(chip, 'click', () => this.commitHex(sw));
      swatches.appendChild(chip);
    }
    tools.appendChild(swatches);

    if ('EyeDropper' in window) {
      const eye = el('button', { class: 'tw-eyedropper', text: 'pick', attrs: { type: 'button', 'aria-label': 'Eyedropper' } });
      this.on(eye, 'click', () => this.openEyeDropper());
      tools.appendChild(eye);
    }

    inner.appendChild(pickers);
    inner.appendChild(this.hexInput);
    inner.appendChild(rgbRow);
    inner.appendChild(tools);
    this.panel.appendChild(inner);

    wrap.appendChild(row);
    wrap.appendChild(this.panel);
    this.widget.appendChild(wrap);

    this.wireSV();
    this.wireHue();
    this.wireHexInput();
    this.wireRgbInputs();
  }

  protected refreshWidget(value: string): void {
    this.applyHex(value);
    this.paintAll();
  }

  protected readWidget(): string {
    return this.hex;
  }

  destroy(): void {
    for (const d of this.scrubDetach) d();
    this.scrubDetach = [];
    super.destroy();
  }

  // ── HSV funnel ─────────────────────────────────────────────────────

  /** The single edit path: update HSV → repaint → live(hex); commit on release. */
  private setHSV(h: number, s: number, v: number, opts: { commit: boolean }): void {
    this.hsv = { h, s, v };
    this.hex = hsvToHex(this.hsv);
    this.paintAll();
    this.ctx.live(this.hex);
    if (opts.commit) this.commitEdit(this.hex);
  }

  /** External hex → internal HSV, preserving hue/sat where hex is ambiguous (black/grey). */
  private applyHex(input: string): void {
    const hex = hexNormalize(input) ?? '#000000';
    const next = hexToHsv(hex);
    // Black has no hue, greys no saturation — keep the prior handle so the
    // hue/SV cursors don't snap to a corner on a round-trip through such a color.
    this.hsv = {
      h: next.v === 0 || next.s === 0 ? this.hsv.h : next.h,
      s: next.v === 0 ? this.hsv.s : next.s,
      v: next.v,
    };
    this.hex = hex;
  }

  // ── Painting ───────────────────────────────────────────────────────

  private paintAll(): void {
    this.swatch.style.background = this.hex;
    this.hexLabel.textContent = this.hex;
    if (this.open) {
      this.paintSV();
      this.placeSVCursor();
      this.placeHueCursor();
      if (document.activeElement !== this.hexInput) this.hexInput.value = this.hex;
      this.paintRgb();
    }
  }

  private paintSV(): void {
    const ctx = this.svCanvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = `hsl(${this.hsv.h}, 100%, 50%)`;
    ctx.fillRect(0, 0, SV_W, SV_H);
    const white = ctx.createLinearGradient(0, 0, SV_W, 0);
    white.addColorStop(0, 'rgba(255,255,255,1)');
    white.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = white;
    ctx.fillRect(0, 0, SV_W, SV_H);
    const black = ctx.createLinearGradient(0, 0, 0, SV_H);
    black.addColorStop(0, 'rgba(0,0,0,0)');
    black.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = black;
    ctx.fillRect(0, 0, SV_W, SV_H);
  }

  private paintHue(): void {
    const ctx = this.hueCanvas.getContext('2d');
    if (!ctx) return;
    const grad = ctx.createLinearGradient(0, 0, 0, SV_H);
    for (let i = 0; i <= 6; i++) grad.addColorStop(i / 6, `hsl(${(i / 6) * 360}, 100%, 50%)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, HUE_W, SV_H);
  }

  private placeSVCursor(): void {
    this.svCursor.style.left = this.hsv.s * SV_W + 'px';
    this.svCursor.style.top = (1 - this.hsv.v) * SV_H + 'px';
  }

  private placeHueCursor(): void {
    this.hueCursor.style.top = (this.hsv.h / 360) * SV_H + 'px';
  }

  private paintRgb(): void {
    const rgb = hsvToRgb(this.hsv);
    const vals = [Math.round(rgb.r), Math.round(rgb.g), Math.round(rgb.b)];
    for (let i = 0; i < 3; i++) {
      if (!this.rgbEditing[i] && document.activeElement !== this.rgbInputs[i]) {
        this.rgbInputs[i].value = String(vals[i]);
      }
    }
  }

  // ── Expand / collapse ──────────────────────────────────────────────

  private toggleOpen(): void {
    this.open = !this.open;
    this.panel.classList.toggle('tw-open', this.open);
    if (this.open) {
      this.paintAll();
      // height:auto doesn't transition — measure and set an explicit px height.
      this.panel.style.height = this.panel.scrollHeight + 'px';
    } else {
      this.panel.style.height = '0px';
    }
  }

  // ── SV square drag ─────────────────────────────────────────────────

  private wireSV(): void {
    const apply = (e: PointerEvent, commit: boolean): void => {
      const rect = this.svCanvas.getBoundingClientRect();
      const s = clamp01((e.clientX - rect.left) / rect.width);
      const v = clamp01(1 - (e.clientY - rect.top) / rect.height);
      this.setHSV(this.hsv.h, s, v, { commit });
    };
    this.on(this.svCanvas, 'pointerdown', ((e: PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      this.svCanvas.setPointerCapture(e.pointerId);
      this.beginEdit();
      apply(e, false);
    }) as EventListener);
    this.on(this.svCanvas, 'pointermove', ((e: PointerEvent) => {
      if (!this.svCanvas.hasPointerCapture(e.pointerId)) return;
      apply(e, false);
    }) as EventListener);
    this.on(this.svCanvas, 'pointerup', ((e: PointerEvent) => {
      if (!this.svCanvas.hasPointerCapture(e.pointerId)) return;
      this.svCanvas.releasePointerCapture(e.pointerId);
      apply(e, true);
    }) as EventListener);
  }

  // ── Hue strip drag ─────────────────────────────────────────────────

  private wireHue(): void {
    const apply = (e: PointerEvent, commit: boolean): void => {
      const rect = this.hueCanvas.getBoundingClientRect();
      const h = clamp01((e.clientY - rect.top) / rect.height) * 360;
      this.setHSV(h, this.hsv.s, this.hsv.v, { commit });
    };
    this.on(this.hueCanvas, 'pointerdown', ((e: PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      this.hueCanvas.setPointerCapture(e.pointerId);
      this.beginEdit();
      apply(e, false);
    }) as EventListener);
    this.on(this.hueCanvas, 'pointermove', ((e: PointerEvent) => {
      if (!this.hueCanvas.hasPointerCapture(e.pointerId)) return;
      apply(e, false);
    }) as EventListener);
    this.on(this.hueCanvas, 'pointerup', ((e: PointerEvent) => {
      if (!this.hueCanvas.hasPointerCapture(e.pointerId)) return;
      this.hueCanvas.releasePointerCapture(e.pointerId);
      apply(e, true);
    }) as EventListener);
  }

  // ── Hex input ──────────────────────────────────────────────────────

  private wireHexInput(): void {
    const commit = (): void => {
      const norm = hexNormalize(this.hexInput.value);
      if (norm) this.commitHex(norm);
      else this.hexInput.value = this.hex; // boundary: invalid → revert
    };
    this.on(this.hexInput, 'keydown', ((e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
        this.hexInput.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.hexInput.value = this.hex;
        this.hexInput.blur();
      }
    }) as EventListener);
    this.on(this.hexInput, 'blur', commit);
  }

  /** Discrete commit from hex string / swatch / eyedropper. */
  private commitHex(hex: string): void {
    this.beginEdit();
    this.applyHex(hex);
    this.paintAll();
    this.ctx.live(this.hex);
    this.commitEdit(this.hex);
  }

  // ── RGB scrub fields ───────────────────────────────────────────────

  private wireRgbInputs(): void {
    for (let i = 0; i < 3; i++) {
      const field = this.rgbInputs[i];
      const setChannel = (val: number, commit: boolean): void => {
        const rgb = hsvToRgb(this.hsv);
        const channel = [rgb.r, rgb.g, rgb.b];
        channel[i] = val;
        this.applyHex(rgbToHex({ r: channel[0], g: channel[1], b: channel[2] }));
        this.paintAll();
        this.ctx.live(this.hex);
        if (commit) this.commitEdit(this.hex);
      };
      this.scrubDetach.push(
        attachScrub(field, {
          step: 1,
          min: 0,
          max: 255,
          getValue: () => channelValue(hsvToRgb(this.hsv), i),
          onStart: () => {
            this.rgbEditing[i] = true;
            this.beginEdit();
          },
          onScrub: (v) => setChannel(v, false),
          onEnd: () => {
            this.rgbEditing[i] = false;
            setChannel(channelValue(hsvToRgb(this.hsv), i), true);
          },
          onCancel: () => {
            // Click-to-focus: no commit is coming from the scrub gesture, so
            // clear BOTH flags here — rgbEditing[i] otherwise leaked true
            // (nothing in the typed/blur path resets it) and the read-back
            // loop stopped syncing this field forever. The focused-field
            // guard keeps read-back from stomping the input while typing.
            this.rgbEditing[i] = false;
            this.cancelEdit();
          },
          onClick: () => {
            field.focus();
            field.select();
          },
        }),
      );
      const typed = (commit: boolean): void => {
        const n = Number(field.value);
        if (Number.isFinite(n)) {
          this.beginEdit();
          setChannel(Math.max(0, Math.min(255, Math.round(n))), commit);
        } else {
          this.paintRgb(); // boundary: invalid → revert display
        }
      };
      this.on(field, 'keydown', ((e: KeyboardEvent) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          typed(true);
          field.blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          this.paintRgb();
          field.blur();
        }
      }) as EventListener);
      this.on(field, 'blur', () => typed(true));
    }
  }

  // ── EyeDropper ─────────────────────────────────────────────────────

  private openEyeDropper(): void {
    const Ctor = window.EyeDropper;
    if (!Ctor) return;
    void new Ctor().open().then((r) => {
      const norm = hexNormalize(r.sRGBHex);
      if (norm) this.commitHex(norm);
    });
  }
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

function channelValue(rgb: { r: number; g: number; b: number }, i: number): number {
  return Math.round(i === 0 ? rgb.r : i === 1 ? rgb.g : rgb.b);
}
