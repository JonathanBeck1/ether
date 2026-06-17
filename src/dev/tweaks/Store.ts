import type { TweakValue } from './types';
import { hexNormalize } from './color';

const UNDO_DEPTH = 50;

/**
 * The single source of truth: a flat Record<path, TweakValue> plus captured
 * defaults. Export, JSON, localStorage, presets, undo and URL-state are all
 * the same serialization of this map.
 *
 * setLive (drag) writes + emits, no persist. commit (release) writes + emits;
 * the caller persists + pushes the undo entry. The store stays a Map + a
 * Set<subscriber> + a defaults snapshot — no reactive framework.
 */
export class Store {
  private values: Record<string, TweakValue> = {};
  private defaults: Record<string, TweakValue> = {};
  private steps: Record<string, number> = {}; // for number dirty tolerance (±step/2)
  private subs = new Set<(path: string, v: TweakValue) => void>();

  private undoStack: Record<string, TweakValue>[] = [];
  private redoStack: Record<string, TweakValue>[] = [];

  register(path: string, def: TweakValue, step?: number): void {
    this.defaults[path] = def;
    if (step != null) this.steps[path] = step;
    if (!(path in this.values)) this.values[path] = def;
  }

  get(path: string): TweakValue {
    return this.values[path];
  }

  /** Drag — write + emit, no persist, no undo. */
  setLive(path: string, v: TweakValue): void {
    this.values[path] = v;
    this.emit(path, v);
  }

  /** Release — write + emit. Caller persists + pushes the undo entry. */
  commit(path: string, v: TweakValue): void {
    this.values[path] = v;
    this.emit(path, v);
  }

  isDirty(path: string): boolean {
    const cur = this.values[path];
    const def = this.defaults[path];
    if (typeof cur === 'number' && typeof def === 'number') {
      const tol = (this.steps[path] ?? 0) / 2;
      return Math.abs(cur - def) > tol;
    }
    if (typeof cur === 'string' && typeof def === 'string') {
      return (hexNormalize(cur) ?? cur.toLowerCase()) !== (hexNormalize(def) ?? def.toLowerCase());
    }
    return cur !== def;
  }

  changedPaths(): string[] {
    return Object.keys(this.values).filter((p) => this.isDirty(p));
  }

  /** The changed-from-default subset — the diff carried by export + URL-state. */
  diff(): Record<string, TweakValue> {
    const out: Record<string, TweakValue> = {};
    for (const p of this.changedPaths()) out[p] = this.values[p];
    return out;
  }

  snapshot(): Record<string, TweakValue> {
    return { ...this.values };
  }

  /** Replace values with defaults + map, then emit every path so widgets resync.
   *  The shell decides whether each emit reaches the scene (gated paths defer). */
  restore(map: Record<string, TweakValue>): void {
    const known: Record<string, TweakValue> = {};
    for (const k in map) if (k in this.defaults) known[k] = map[k];
    this.values = { ...this.defaults, ...known };
    for (const p in this.values) this.emit(p, this.values[p]);
  }

  subscribe(fn: (p: string, v: TweakValue) => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  // ── Undo / redo (one snapshot per committed gesture) ──────────────

  /** Capture the pre-gesture snapshot at beginEdit; finalized by pushUndo on commit. */
  private pendingPre: Record<string, TweakValue> | null = null;

  beginUndoCapture(): void {
    if (!this.pendingPre) this.pendingPre = { ...this.values };
  }

  /** Finalize one undo entry from the captured pre-gesture snapshot. */
  pushUndo(): void {
    if (!this.pendingPre) return;
    this.undoStack.push(this.pendingPre);
    if (this.undoStack.length > UNDO_DEPTH) this.undoStack.shift();
    this.redoStack.length = 0;
    this.pendingPre = null;
  }

  /** Pop the last entry, push current onto redo, restore. */
  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push({ ...this.values });
    this.restore(prev);
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push({ ...this.values });
    this.restore(next);
  }

  private emit(path: string, v: TweakValue): void {
    for (const fn of this.subs) fn(path, v);
  }
}
