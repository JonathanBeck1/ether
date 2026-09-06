export interface Progress {
  /** Weighted completion of everything tracked so far, 0..1. 0 before
   *  anything is tracked; 1 once every tracked promise has settled. */
  readonly value: number;
  /** Register a promise under `weight` (default 1). Returns the same
   *  promise, so it slots into existing `await`s. Rejections settle
   *  too — a failed asset must not stall the loading beat forever; the
   *  caller still sees the rejection. */
  track<T>(promise: Promise<T>, weight?: number): Promise<T>;
  /** Fires with the new value on every change. Returns the unsubscribe. */
  onChange(listener: (value: number) => void): () => void;
}

/** Options shared by every loader in this module. */
export interface TrackOptions {
  progress?: Progress;
  /** Relative weight of this asset in `progress` (default 1). Weight a
   *  hero model above its textures so the bar reflects wall-clock, not
   *  request count. */
  weight?: number;
}

/**
 * One progress value for a set of loads of unequal cost. Feed it every
 * loader in this module (via `{ progress }`) or any promise of your own.
 * Items complete atomically — the value steps, it does not stream bytes.
 */
export function createProgress(): Progress {
  let total = 0;
  let done = 0;
  const listeners = new Set<(value: number) => void>();
  const value = () => (total === 0 ? 0 : done / total);
  const emit = () => {
    const v = value();
    for (const listener of listeners) listener(v);
  };
  return {
    get value() {
      return value();
    },
    track(promise, weight = 1) {
      total += weight;
      emit();
      const settle = () => {
        done += weight;
        emit();
      };
      promise.then(settle, settle);
      return promise;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function tracked<T>(promise: Promise<T>, options: TrackOptions): Promise<T> {
  return options.progress ? options.progress.track(promise, options.weight) : promise;
}
