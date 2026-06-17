// localStorage + URL-state + named presets — the same flat DiffMap serialized
// every way. Every read is boundary-guarded: a throw / bad version / non-object
// payload falls to defaults silently (never crash a dev session on stale state).

import type { DiffMap } from './types';

const PERSIST_DEBOUNCE_MS = 280;

interface PanelState {
  left?: number;
  top?: number;
  collapsed?: boolean;
}

function isPlainMap(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

// ── Live state (changed-only diff + panel chrome) ──────────────────────

export function readState(storageKey: string): DiffMap {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainMap(parsed) || parsed.v !== 1 || !isPlainMap(parsed.values)) return {};
    return parsed.values as DiffMap;
  } catch {
    return {};
  }
}

export function writeState(storageKey: string, values: DiffMap): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ v: 1, values }));
  } catch {
    /* quota / disabled storage — dev-only, drop silently */
  }
}

/** A debounced writer bound to one storageKey. schedule(values) coalesces calls
 *  ~280ms; the returned handle lets the shell clear a pending write on unmount. */
export function createDebouncedWriter(
  storageKey: string,
  onSchedule: (handle: ReturnType<typeof setTimeout>) => void,
): (values: DiffMap) => void {
  return (values) => {
    const handle = setTimeout(() => writeState(storageKey, values), PERSIST_DEBOUNCE_MS);
    onSchedule(handle);
  };
}

// ── Panel position + collapsed (A8) ────────────────────────────────────

export function readPanelState(storageKey: string): PanelState {
  try {
    const raw = localStorage.getItem(`${storageKey}:panel`);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return isPlainMap(parsed) ? (parsed as PanelState) : {};
  } catch {
    return {};
  }
}

export function writePanelState(storageKey: string, state: PanelState): void {
  try {
    localStorage.setItem(`${storageKey}:panel`, JSON.stringify(state));
  } catch {
    /* drop silently */
  }
}

// ── Named presets (full map per preset, self-contained vs default drift) ──

export function readPresets(storageKey: string): Record<string, DiffMap> {
  try {
    const raw = localStorage.getItem(`${storageKey}:presets`);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return isPlainMap(parsed) ? (parsed as Record<string, DiffMap>) : {};
  } catch {
    return {};
  }
}

function writePresets(storageKey: string, presets: Record<string, DiffMap>): void {
  try {
    localStorage.setItem(`${storageKey}:presets`, JSON.stringify(presets));
  } catch {
    /* drop silently */
  }
}

export function savePreset(storageKey: string, name: string, map: DiffMap): void {
  const presets = readPresets(storageKey);
  presets[name] = map;
  writePresets(storageKey, presets);
}

export function deletePreset(storageKey: string, name: string): void {
  const presets = readPresets(storageKey);
  delete presets[name];
  writePresets(storageKey, presets);
}

// ── URL state (diff only, base64) ──────────────────────────────────────

export function encodeURLState(diff: DiffMap): string {
  return btoa(JSON.stringify(diff));
}

/** Decode the ?tweak payload. Guarded: bad base64 / JSON / shape → null. */
export function decodeURLState(payload: string | null): DiffMap | null {
  if (!payload) return null;
  try {
    const parsed: unknown = JSON.parse(atob(payload));
    return isPlainMap(parsed) ? (parsed as DiffMap) : null;
  } catch {
    return null;
  }
}
