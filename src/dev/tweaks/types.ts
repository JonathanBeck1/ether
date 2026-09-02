// Frozen contract for the Tweaks instrument. No runtime code — types only.
// Controls, chrome, store, registry and the scene-side bindings all bind to
// exactly these shapes.

export type TweakValue = number | boolean | string | number[]; // string = hex color OR enum value; number[] = interval [min,max] / vector [x,y(,z)]

export interface ExportTarget {
  constant?: string; // scalar target, e.g. 'COLOR_VIOLET', 'FRESNEL_EXP_DESKTOP'
  constants?: string[]; // array values → one constant per element (e.g. ['CAMERA_Z_START', 'CAMERA_Z_END'])
  shape: 'three-color' | 'number';
  needsPromotion?: boolean; // true → constant has no constants.ts home yet (export adds a promotion note)
}

export interface BaseDescriptor<T extends TweakValue> {
  path: string; // unique across the panel (registry enforces)
  label?: string; // defaults to humanized path
  get: () => T; // read LIVE scene value — seeds at mount + read-back loop
  set: (v: T) => void; // write LIVE scene value — called every input event
  default: T; // captured for dirty-diff + reset + export "changed-only"
  export: ExportTarget | null; // null = runtime-only, omitted from constants block
  enabledUntil?: () => boolean; // intro/availability gate (control disabled until true)
  onReset?: () => void; // override-aware reset: when present, called INSTEAD of set(default)
}

export interface SliderDescriptor extends BaseDescriptor<number> {
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
}

export interface ColorDescriptor extends BaseDescriptor<string> {} // value is '#rrggbb'

export interface ToggleDescriptor extends BaseDescriptor<boolean> {}

export interface SelectDescriptor extends BaseDescriptor<string | number> {
  options: Record<string, string | number>; // { label: value } — segmented pills ≤4, dropdown >4
}

export interface IntervalDescriptor extends BaseDescriptor<number[]> {
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
} // value is [lo, hi] — a min/max band; thumbs can't cross

export interface MonitorDescriptor extends BaseDescriptor<number> {
  unit?: string;
  format?: (v: number) => string;
} // READ-ONLY: get() + sparkline; no set() write path (registered non-editable)

export interface VectorDescriptor extends BaseDescriptor<number[]> {
  min: number;
  max: number;
  step: number;
  axes: 2 | 3; // 2 → XY pad; 3 → XY pad + a z slider
  format?: (v: number) => string;
} // value is [x, y] or [x, y, z]

export type Descriptor =
  | SliderDescriptor
  | ColorDescriptor
  | ToggleDescriptor
  | SelectDescriptor
  | IntervalDescriptor
  | MonitorDescriptor
  | VectorDescriptor;

// ─── Panel construction ──────────────────────────────────────────────

export interface TweaksConfig {
  storageKey: string; // localStorage namespace, e.g. 'taketwo:tweaks:home'
  title?: string; // Staatliches header lockup text, default 'TWEAKS'
  startCollapsed?: boolean; // default false; persisted thereafter
  spawn?: { top: number; left: number }; // initial position; a persisted panel position still wins
  presetsMenu?: boolean; // default true; false hides the presets dropdown entirely
  monoFontSources?: false | { w400: string; w500: string }; // false = no @font-face; URLs override the CDN default
}

export interface GroupConfig {
  accent: '#e66cff' | '#59ffe2' | '#ff7d4e' | string; // left-rail + thumb-glow tint
  collapsed?: boolean; // default false; persisted
  available?: () => boolean; // group hidden when false (e.g. LOW tier → no bloom)
}

// ─── Persistence shapes (one serialization for store / URL / localStorage) ──

export type DiffMap = Record<string, TweakValue>;

// ─── Control contract — the single extensibility seam ────────────────

export interface ControlContext {
  /** Live-write to the scene immediately (descriptor.set) + Store.setLive. Cheap, per-frame safe.
   *  Does NOT persist/undo/dirty-recompute. Called on every input event. */
  live(value: TweakValue): void;
  /** End of gesture: Store.commit → dirty recompute + debounced persist + finalize undo entry. */
  commit(value: TweakValue): void;
  /** Begin of gesture (pointerdown / focus): capture pre-edit snapshot for ONE undo step. */
  beginEdit(): void;
  /** Owning group's accent, for thumb glow / fill / left-rail (controls read var(--tw-accent)). */
  readonly accent: string;
}

export interface Control {
  readonly path: string; // stable identity (registry-unique)
  readonly el: HTMLElement; // root row; registry appends to the group body

  /** True between beginEdit() and commit(). The read-back loop skips editing controls
   *  so the scene animating the same value mid-gesture can't snap the widget. */
  readonly isEditing: boolean;

  mount(ctx: ControlContext): void; // build DOM + attach listeners (the ONLY place listeners are added)
  destroy(): void; // remove EVERY listener, exit Pointer Lock if held, drop refs. Idempotent.

  /** Re-read external truth into the widget WITHOUT firing live/commit (DOM-only).
   *  Called on: mount seed, preset/URL/persist apply, undo/redo, throttled read-back loop. */
  refresh(value: TweakValue): void;

  getValue(): TweakValue;
  setValue(value: TweakValue): void; // display-only set; caller decides whether to live()/commit()

  isDirty(): boolean; // by VALUE vs captured default (number ±step/2, color norm-lc-hex)
  reset(): void; // setValue(default) + live/commit, OR onReset() for override-guarded params
}
