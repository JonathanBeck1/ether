import type { DiffMap, GroupConfig, TweaksConfig, TweakValue } from './types';
import type { RegistryEntry } from './Registry';
import { Registry, GroupBuilder } from './Registry';
import { Store } from './Store';
import { applyTokens, SCOPED_CSS } from './tokens';
import { el } from './dom';
import { formatNumber } from './format';
import { buildConstantsBlock, buildJson } from './exporter';
import {
  createDebouncedWriter,
  decodeURLState,
  deletePreset,
  encodeURLState,
  readPanelState,
  readPresets,
  readState,
  savePreset,
  writePanelState,
} from './persistence';

const READBACK_MS = 500; // ~2 Hz, the Stats cadence

/**
 * The panel shell: glass root + scoped <style>, group DOM, mount/unmount,
 * the throttled read-back rAF, header drag-to-move, and the global keydown
 * for undo/redo. Owns Store + Registry. Chrome (footer / header buttons /
 * presets dropdown) attaches via the marked extension hooks below without
 * rewriting the shell.
 */
export class Tweaks {
  readonly config: TweaksConfig;
  readonly store = new Store();
  private readonly registry = new Registry(this.store);

  private readonly root: HTMLElement; // shell, data-kit-tweaks, pointerEvents:'auto'
  private readonly styleEl: HTMLStyleElement; // the one scoped <style>, inside the shell
  private readonly header: HTMLElement;
  private readonly headerActions: HTMLElement; // hook: chrome appends header buttons here
  private readonly body: HTMLElement;
  private readonly footer: HTMLElement; // hook: chrome populates the footer

  private mounted = false;
  private rafId = 0;
  private lastReadback = 0;
  private readonly readbackBound: (now: number) => void;

  // Header drag — window listeners added on header pointerdown, removed on up.
  private readonly onHeaderDown: (e: PointerEvent) => void;
  private readonly onHeaderMove: (e: PointerEvent) => void;
  private readonly onHeaderUp: (e: PointerEvent) => void;
  private dragOffset = { x: 0, y: 0 };

  private readonly onKeyDown: (e: KeyboardEvent) => void;

  // A5: gated paths whose stored value awaits the gate opening before the
  // scene write fires (writing mid-tween would fight the intro/responsive pass).
  private readonly deferredGated = new Map<string, TweakValue>();
  // Tracks each entry's last-known gate state so we flip disabled + apply once.
  private readonly gateState = new Map<RegistryEntry, boolean>();

  // Chrome hook: scene-override teardown (A12 clears these on unmount).
  private clearOverrides: (() => void) | null = null;
  // Chrome hook: pending debounced-persist timer to clear on unmount (A12).
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  // Chrome state.
  private exportFull = false; // footer toggle: changed-only vs full snapshot
  private restoredKeys: string[] = []; // localStorage/URL overrides present at mount
  private countEl: HTMLElement | null = null;
  private overridesChip: HTMLElement | null = null;
  private schedulePersist: ((values: DiffMap) => void) | null = null;
  private scheduleURL: (() => void) | null = null;
  private urlTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(config: TweaksConfig) {
    this.config = config;

    const root = el('div', {
      class: 'tw-root',
      attrs: { 'data-kit-tweaks': '' },
      style: {
        position: 'fixed',
        top: '16px',
        left: '16px',
        zIndex: '100000',
        width: '320px',
        minWidth: '300px',
        pointerEvents: 'auto',
      },
    });

    const styleEl = document.createElement('style');
    styleEl.textContent = SCOPED_CSS;
    root.appendChild(styleEl);

    this.header = el('div', { class: 'tw-header' });
    const title = el('span', { class: 'tw-title', text: config.title ?? 'TWEAKS' });
    this.headerActions = el('div', { class: 'tw-header-actions' });
    this.header.appendChild(title);
    this.header.appendChild(this.headerActions);

    this.body = el('div', { class: 'tw-body' });
    this.footer = el('div', { class: 'tw-footer' });

    root.appendChild(this.header);
    root.appendChild(this.body);
    root.appendChild(this.footer);

    this.root = root;
    this.styleEl = styleEl;

    if (config.startCollapsed) this.root.classList.add('tw-collapsed');

    this.readbackBound = this.readback.bind(this);
    this.onHeaderDown = this.handleHeaderDown.bind(this);
    this.onHeaderMove = this.handleHeaderMove.bind(this);
    this.onHeaderUp = this.handleHeaderUp.bind(this);
    this.onKeyDown = this.handleKeyDown.bind(this);
  }

  /** Open a group; the builder exposes addSlider / addColor / addToggle. */
  group(name: string, config: GroupConfig): GroupBuilder {
    return this.registry.group(name, config);
  }

  mount(parent: HTMLElement = document.body): this {
    if (this.mounted) return this;
    applyTokens(this.root);
    if (!this.styleEl.isConnected) this.root.prepend(this.styleEl); // re-mount: unmount removed it
    this.buildGroups();
    parent.appendChild(this.root);
    this.restoreState();
    this.seedControls();
    this.buildChrome();
    this.on(this.header, 'pointerdown', this.onHeaderDown as EventListener);
    window.addEventListener('keydown', this.onKeyDown);
    this.lastReadback = performance.now();
    this.rafId = requestAnimationFrame(this.readbackBound);
    this.mounted = true;
    return this;
  }

  unmount(): void {
    if (!this.mounted) return;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('pointermove', this.onHeaderMove); // belt + braces
    window.removeEventListener('pointerup', this.onHeaderUp);
    if (document.pointerLockElement) document.exitPointerLock(); // scrub safety
    if (this.persistTimer) clearTimeout(this.persistTimer); // A12: no stale write
    this.persistTimer = null;
    if (this.urlTimer) clearTimeout(this.urlTimer); // A12: no stale URL write
    this.urlTimer = null;
    if (this.unsubscribe) this.unsubscribe();
    this.unsubscribe = null;
    if (this.clearOverrides) this.clearOverrides(); // A12: un-tweak the scene
    for (const [target, type, handler] of this.listeners) target.removeEventListener(type, handler);
    this.listeners = [];
    for (const e of this.registry.entries()) e.control.destroy();
    this.styleEl.remove();
    this.root.remove();
    this.mounted = false;
  }

  // ── Chrome extension hooks (the CHROME task wires these) ────────────
  // The footer / header buttons / presets dropdown attach here without
  // touching mount/unmount.

  /** Footer container — chrome appends Copy-constants / Copy-JSON / count / toggle. */
  get footerEl(): HTMLElement {
    return this.footer;
  }

  /** Header-actions container — chrome appends collapse / copy-link / presets dropdown. */
  get headerActionsEl(): HTMLElement {
    return this.headerActions;
  }

  /** Registry entries (control + live get/set + gate) for export / persist. */
  get registryEntries(): RegistryEntry[] {
    return this.registry.entries();
  }

  /** Chrome registers the scene-override teardown run on unmount (A12). */
  setOverrideTeardown(fn: () => void): void {
    this.clearOverrides = fn;
  }

  /** Chrome stores its debounced-persist timer so unmount can clear it (A12). */
  setPersistTimer(t: ReturnType<typeof setTimeout> | null): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = t;
  }

  /** Apply a flat map (preset / URL / undo) → store.restore + resync widgets,
   *  honoring gated deferral. Chrome calls this from presets / copy-link. */
  applyMap(map: Record<string, TweakValue>): void {
    this.store.restore(map);
    this.resyncFromStore();
  }

  // ── Internals ───────────────────────────────────────────────────────

  private buildGroups(): void {
    this.body.replaceChildren(); // idempotent: a re-mount rebuilds clean groups
    for (const g of this.registry.groups) {
      if (g.config.available && !g.config.available()) continue;

      const groupEl = el('div', { class: 'tw-group' });
      groupEl.style.setProperty('--tw-accent', g.config.accent);
      if (g.config.collapsed) groupEl.classList.add('tw-collapsed');

      const head = el('div', { class: 'tw-group-header', attrs: { role: 'button', tabindex: '0' } });
      const name = el('span', { text: g.name });
      const chevron = el('span', { text: '▾' });
      head.appendChild(name);
      head.appendChild(chevron);
      this.on(head, 'click', () => groupEl.classList.toggle('tw-collapsed'));
      this.on(head, 'keydown', ((e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          groupEl.classList.toggle('tw-collapsed');
        }
      }) as EventListener);

      const groupBody = el('div', { class: 'tw-group-body' });
      for (const entry of g.entries) groupBody.appendChild(entry.control.el);

      groupEl.appendChild(head);
      groupEl.appendChild(groupBody);
      this.body.appendChild(groupEl);
    }
  }

  /** Precedence: URL > localStorage > defaults. Loads the decoded diff into the
   *  store; seedControls() (called next in mount) seeds widgets + scene from it,
   *  honoring gated deferral. Also restores panel position + collapsed (A8). */
  private restoreState(): void {
    const key = this.config.storageKey;
    const urlPayload = new URL(location.href).searchParams.get('tweak');
    const fromUrl = decodeURLState(urlPayload);
    const restored = fromUrl ?? readState(key);
    this.restoredKeys = Object.keys(restored);
    if (this.restoredKeys.length) this.store.restore(restored);

    const panel = readPanelState(key);
    // Clamp into the viewport so a position saved at a larger window (or a
    // since-shrunk screen) can't strand the header off-screen and unreachable.
    if (panel.left != null) this.root.style.left = `${Math.max(0, Math.min(panel.left, window.innerWidth - 40))}px`;
    if (panel.top != null) this.root.style.top = `${Math.max(0, Math.min(panel.top, window.innerHeight - 40))}px`;
    if (panel.collapsed) this.root.classList.add('tw-collapsed');
  }

  /** Seed widgets from the store + write non-gated values to the scene; defer
   *  gated paths (A5) until their gate opens in the read-back loop. */
  private seedControls(): void {
    for (const e of this.registry.entries()) {
      if (e.monitor) {
        e.control.refresh(e.get()); // read-only: seed from the live value, no store, no scene write
        continue;
      }
      const v = this.store.get(e.control.path);
      e.control.refresh(v);
      const open = !e.enabledUntil || e.enabledUntil();
      this.gateState.set(e, open);
      e.control.el.classList.toggle('tw-disabled', !open);
      if (open) e.set(v);
      else this.deferredGated.set(e.control.path, v);
    }
  }

  /** Re-sync every widget from the store after a restore/undo, honoring gates. */
  private resyncFromStore(): void {
    for (const e of this.registry.entries()) {
      if (e.monitor) continue; // read-only: not in the store, the read-back loop keeps it fresh
      const v = this.store.get(e.control.path);
      e.control.refresh(v);
      const open = !e.enabledUntil || e.enabledUntil();
      if (open) e.set(v);
      else this.deferredGated.set(e.control.path, v);
    }
  }

  // ── Chrome: footer + header buttons + presets + persistence wiring ──

  /** Populate the EXISTING footer / header-actions hooks. Called once at mount
   *  after seedControls(). Wires the debounced persist + URL writers. */
  private buildChrome(): void {
    this.buildFooter();
    this.buildHeaderActions();

    if (this.unsubscribe) this.unsubscribe();
    this.schedulePersist = createDebouncedWriter(this.config.storageKey, (h) => this.setPersistTimer(h));
    this.unsubscribe = this.store.subscribe(() => {
      this.schedulePersist?.(this.store.diff());
      this.scheduleURL?.();
      this.refreshChrome();
    });
  }

  private buildFooter(): void {
    this.footer.replaceChildren(); // idempotent: a re-mount rebuilds clean chrome
    const copyConstants = el('button', { class: 'tw-btn', text: 'Copy constants.ts', attrs: { type: 'button' } });
    this.on(copyConstants, 'click', () => {
      void this.copy(buildConstantsBlock(this.exportMap(), this.registry.entries()), copyConstants, 'Copy constants.ts');
    });

    const copyJson = el('button', { class: 'tw-btn', text: 'Copy JSON', attrs: { type: 'button' } });
    this.on(copyJson, 'click', () => {
      void this.copy(buildJson(this.exportMap()), copyJson, 'Copy JSON');
    });

    const scopeToggle = el('button', { class: 'tw-btn', text: 'changed', attrs: { type: 'button', title: 'Toggle changed-only vs full' } });
    this.on(scopeToggle, 'click', () => {
      this.exportFull = !this.exportFull;
      scopeToggle.textContent = this.exportFull ? 'full' : 'changed';
    });

    this.overridesChip = el('span', { class: 'tw-chip-overrides' });
    const clearOverrides = el('button', { class: 'tw-btn', text: 'Clear', attrs: { type: 'button' } });
    this.on(clearOverrides, 'click', () => {
      this.restoredKeys = [];
      this.store.beginUndoCapture();
      this.applyMap({});
      this.store.pushUndo();
      this.refreshChrome();
    });

    this.countEl = el('span', { class: 'tw-count' });

    this.footer.appendChild(copyConstants);
    this.footer.appendChild(copyJson);
    this.footer.appendChild(scopeToggle);
    this.footer.appendChild(this.overridesChip);
    this.footer.appendChild(clearOverrides);
    this.footer.appendChild(this.countEl);

    this.refreshChrome();
  }

  private buildHeaderActions(): void {
    this.headerActions.replaceChildren(); // idempotent: a re-mount rebuilds clean chrome
    const collapse = el('button', { class: 'tw-btn', text: '–', attrs: { type: 'button', 'aria-label': 'Collapse' } });
    this.on(collapse, 'click', () => {
      this.root.classList.toggle('tw-collapsed');
      collapse.textContent = this.root.classList.contains('tw-collapsed') ? '+' : '–';
      this.savePanelState();
    });

    const copyLink = el('button', { class: 'tw-btn', text: 'Link', attrs: { type: 'button', 'aria-label': 'Copy link' } });
    this.on(copyLink, 'click', () => {
      this.writeUrlState();
      void this.copy(location.href, copyLink, 'Link');
    });
    this.scheduleURL = (): void => {
      if (this.urlTimer) clearTimeout(this.urlTimer);
      this.urlTimer = setTimeout(() => this.writeUrlState(), 400);
    };

    this.headerActions.appendChild(this.buildPresetsMenu());
    this.headerActions.appendChild(copyLink);
    this.headerActions.appendChild(collapse);
  }

  private buildPresetsMenu(): HTMLElement {
    const menu = el('div', { class: 'tw-menu' });
    const button = el('button', { class: 'tw-btn', text: 'Presets', attrs: { type: 'button' } });
    const list = el('div', { class: 'tw-menu-list' });

    const rebuild = (): void => {
      list.replaceChildren();
      const presets = readPresets(this.config.storageKey);
      for (const name of Object.keys(presets)) {
        const row = el('div', { class: 'tw-menu-item' });
        const recall = el('button', { class: 'tw-btn', text: name, attrs: { type: 'button' } });
        this.on(recall, 'click', () => {
          this.store.beginUndoCapture();
          this.applyMap(presets[name]);
          this.store.pushUndo();
          this.refreshChrome();
          list.classList.remove('tw-open');
        });
        const del = el('button', { class: 'tw-btn', text: '×', attrs: { type: 'button', 'aria-label': `Delete ${name}` } });
        this.on(del, 'click', () => {
          deletePreset(this.config.storageKey, name);
          rebuild();
        });
        row.appendChild(recall);
        row.appendChild(del);
        list.appendChild(row);
      }
      const save = el('button', { class: 'tw-btn', text: '+ Save current', attrs: { type: 'button' } });
      this.on(save, 'click', () => {
        const name = prompt('Preset name');
        if (!name) return;
        savePreset(this.config.storageKey, name, this.store.diff());
        rebuild();
      });
      list.appendChild(save);
    };

    this.on(button, 'click', () => {
      if (!list.classList.contains('tw-open')) rebuild();
      list.classList.toggle('tw-open');
    });

    menu.appendChild(button);
    menu.appendChild(list);
    return menu;
  }

  private exportMap(): DiffMap {
    return this.exportFull ? this.store.snapshot() : this.store.diff();
  }

  private writeUrlState(): void {
    const url = new URL(location.href);
    url.searchParams.set('tweak', encodeURLState(this.store.diff()));
    history.replaceState(null, '', url.toString());
  }

  private async copy(text: string, btn: HTMLElement, label: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* clipboard blocked (insecure context) — still flash so the dev knows the click registered */
    }
    btn.textContent = 'copied';
    setTimeout(() => {
      btn.textContent = label;
    }, 1100);
  }

  private refreshChrome(): void {
    const n = this.store.changedPaths().length;
    if (this.countEl) this.countEl.textContent = `${n} changed`;
    if (this.overridesChip) {
      this.overridesChip.textContent = this.restoredKeys.length ? 'overrides active' : '';
    }
  }

  /** ~2 Hz read-back: re-refresh only drifted controls; skip editing controls
   *  (A4); flip gated controls live + apply any deferred value (A5). */
  private readback(now: number): void {
    if (now - this.lastReadback >= READBACK_MS) {
      this.lastReadback = now;
      for (const e of this.registry.entries()) {
        const ctrl = e.control;

        if (e.monitor) {
          if (!e.enabledUntil || e.enabledUntil()) ctrl.refresh(e.get()); // always push a sample
          continue;
        }

        if (e.enabledUntil) {
          const open = e.enabledUntil();
          const was = this.gateState.get(e) ?? false;
          if (open !== was) {
            this.gateState.set(e, open);
            ctrl.el.classList.toggle('tw-disabled', !open);
            if (open) {
              const pending = this.deferredGated.get(ctrl.path);
              if (pending !== undefined) {
                e.set(pending); // A5: apply the stored value once, now that the gate opened
                this.deferredGated.delete(ctrl.path);
              }
            }
          }
          if (!open) continue;
        }

        if (ctrl.isEditing) continue; // A4: never refresh out from under a live gesture
        const live = e.get();
        if (!valuesEqual(live, ctrl.getValue())) ctrl.refresh(live);
      }
    }
    this.rafId = requestAnimationFrame(this.readbackBound);
  }

  private handleHeaderDown(e: PointerEvent): void {
    if ((e.target as HTMLElement).closest('.tw-header-actions')) return; // don't drag from a button
    const rect = this.root.getBoundingClientRect();
    this.dragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    window.addEventListener('pointermove', this.onHeaderMove);
    window.addEventListener('pointerup', this.onHeaderUp);
  }

  private handleHeaderMove(e: PointerEvent): void {
    this.root.style.left = `${e.clientX - this.dragOffset.x}px`;
    this.root.style.top = `${e.clientY - this.dragOffset.y}px`;
  }

  private handleHeaderUp(): void {
    window.removeEventListener('pointermove', this.onHeaderMove);
    window.removeEventListener('pointerup', this.onHeaderUp);
    this.savePanelState();
  }

  private savePanelState(): void {
    const rect = this.root.getBoundingClientRect();
    writePanelState(this.config.storageKey, {
      left: rect.left,
      top: rect.top,
      collapsed: this.root.classList.contains('tw-collapsed'),
    });
  }

  private handleKeyDown(e: KeyboardEvent): void {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) this.store.redo();
      else this.store.undo();
      this.resyncFromStore();
    }
    // Chrome attaches further hotkeys (search/toggle) here as needed.
  }

  // Shell-internal listener ledger (mirrors BaseControl; controls own theirs).
  private listeners: Array<[EventTarget, string, EventListener]> = [];
  private on(target: EventTarget, type: string, handler: EventListener): void {
    target.addEventListener(type, handler);
    this.listeners.push([target, type, handler]);
  }
}

function valuesEqual(a: TweakValue, b: TweakValue): boolean {
  if (typeof a === 'number' && typeof b === 'number') return formatNumber(a, 1e-6) === formatNumber(b, 1e-6);
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((n, i) => formatNumber(n, 1e-6) === formatNumber(b[i] as number, 1e-6));
  }
  return a === b;
}
