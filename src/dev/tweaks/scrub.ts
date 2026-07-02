// Pointer-Lock drag-scrub — the instrument-vs-widget signal. Shared by the
// slider readout and the color RGB fields. Accumulates e.movementX (NOT
// clientX: Pointer Lock makes clientX meaningless and unbounded drag is the
// point). Modifier precision is read LIVE mid-gesture. A pointerdown→up under
// the click threshold is a click (focus-to-type), not a scrub.

export interface ScrubOptions {
  step: number;
  pxPerStep?: number; // px of pointer travel per step (default 4)
  min?: number;
  max?: number;
  getValue: () => number;
  onStart(): void; // → control.beginEdit
  onScrub(value: number): void; // → control.live (every move)
  onEnd(): void; // → control.commit (once per gesture)
  /** Gesture resolved as a CLICK (< CLICK_PX travel): the value was restored
   *  to its gesture-start state and no commit will fire — clear edit state
   *  without an undo entry (→ control.cancelEdit). Falls back to onEnd when
   *  absent so the edit NEVER stays open. */
  onCancel?(): void;
  onClick?(): void; // < CLICK_PX travel → focus the field for keyboard entry
}

const CLICK_PX = 3;

const quantize = (v: number, step: number): number => Math.round(v / step) * step;

const precision = (e: PointerEvent | MouseEvent): number => (e.shiftKey ? 10 : e.altKey ? 0.1 : 1);

export function attachScrub(el: HTMLElement, opts: ScrubOptions): () => void {
  const pxPerStep = opts.pxPerStep ?? 4;
  const min = opts.min ?? -Infinity;
  const max = opts.max ?? Infinity;

  let active = false;
  let locked = false; // Pointer Lock granted (movementX) vs denied fallback (clientX delta)
  let start = 0; // value at gesture start
  let accumPx = 0; // total pointer travel since down
  let travel = 0; // absolute travel, for the click guard
  let lastClientX = 0; // fallback delta source when Pointer Lock is denied

  const apply = (e: PointerEvent): void => {
    const next = clamp(quantize(start + (accumPx / pxPerStep) * opts.step * precision(e), opts.step), min, max);
    opts.onScrub(next);
  };

  const onMove = (e: PointerEvent): void => {
    if (!active) return;
    const dx = locked ? e.movementX : e.clientX - lastClientX;
    lastClientX = e.clientX;
    accumPx += dx;
    travel += Math.abs(dx);
    apply(e);
  };

  const exit = (): void => {
    if (!active) return;
    active = false;
    window.removeEventListener('pointermove', onMove);
    if (document.pointerLockElement === el) document.exitPointerLock();
    locked = false;
    el.style.cursor = '';
    document.body.style.userSelect = '';
  };

  const onUp = (): void => {
    if (!active) return;
    const click = travel < CLICK_PX;
    exit();
    if (click) {
      // A click is value-neutral: sub-threshold jitter may still have
      // scrubbed ±1 step via onMove — restore the gesture-start value,
      // close the edit WITHOUT a commit (no undo entry for a no-op), then
      // hand off to the click action (focus-to-type). Previously this
      // branch never ended the edit at all: isEditing stuck true and the
      // read-back loop skipped the control forever.
      // Restore START exactly (no quantize): a click on a value that was
      // typed off-grid must not silently snap it to the step grid.
      if (accumPx !== 0) opts.onScrub(clamp(start, min, max));
      (opts.onCancel ?? opts.onEnd)();
      opts.onClick?.();
    } else {
      opts.onEnd();
    }
  };

  const onCancel = (): void => {
    if (!active) return;
    exit();
    opts.onEnd(); // A12: cancel still finalizes the gesture (one undo entry)
  };

  const onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    active = true;
    start = opts.getValue();
    accumPx = 0;
    travel = 0;
    lastClientX = e.clientX;
    opts.onStart();
    el.requestPointerLock();
    locked = document.pointerLockElement === el; // sync grant on Chromium; lockchange flips it otherwise
    el.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onMove);
  };

  const onLockChange = (): void => {
    if (active) locked = document.pointerLockElement === el;
  };

  el.addEventListener('pointerdown', onDown);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  document.addEventListener('pointerlockchange', onLockChange);

  return (): void => {
    exit();
    el.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    document.removeEventListener('pointerlockchange', onLockChange);
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
