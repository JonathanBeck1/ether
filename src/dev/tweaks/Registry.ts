import type {
  ColorDescriptor,
  Control,
  ControlContext,
  Descriptor,
  ExportTarget,
  GroupConfig,
  IntervalDescriptor,
  MonitorDescriptor,
  SelectDescriptor,
  SliderDescriptor,
  ToggleDescriptor,
  TweakValue,
  VectorDescriptor,
} from './types';
import type { Store } from './Store';
import { SliderControl } from './controls/SliderControl';
import { ColorControl } from './controls/ColorControl';
import { ToggleControl } from './controls/ToggleControl';
import { SelectControl } from './controls/SelectControl';
import { IntervalControl } from './controls/IntervalControl';
import { MonitorControl } from './controls/MonitorControl';
import { VectorControl } from './controls/VectorControl';

/** Input shape for addMonitor — read-only, so it omits the writable contract
 *  fields (set/default/export) the adder fills with no-ops. */
export type MonitorInput = Pick<MonitorDescriptor, 'path' | 'label' | 'get' | 'unit' | 'format' | 'enabledUntil'>;

export interface RegistryEntry {
  control: Control;
  group: GroupRecord;
  /** Live read of the scene value — drives the read-back drift check. */
  get: () => TweakValue;
  /** Live write to the scene (descriptor.set). */
  set: (v: TweakValue) => void;
  /** Closed gate ⇒ control disabled + scene writes deferred (A5). */
  enabledUntil?: () => boolean;
  /** Export target (null = runtime-only) — read by the constants-block exporter. */
  export: ExportTarget | null;
  /** Step precision — feeds numberToLiteral so export literals match readouts. */
  step: number;
  /** Read-only monitor: refreshed from get() each read-back tick, but never
   *  store-registered, persisted, exported, or counted as changed. */
  monitor?: boolean;
}

export interface GroupRecord {
  name: string;
  config: GroupConfig;
  entries: RegistryEntry[];
}

/**
 * Holds the declared groups + descriptors, instantiates the bespoke controls,
 * enforces unique paths, and builds the ControlContext that wires
 * store ↔ control ↔ scene. No plugin system: one typed adder per control type.
 */
export class Registry {
  readonly groups: GroupRecord[] = [];
  private readonly paths = new Set<string>();

  constructor(private readonly store: Store) {}

  group(name: string, config: GroupConfig): GroupBuilder {
    const record: GroupRecord = { name, config, entries: [] };
    this.groups.push(record);
    return new GroupBuilder(this, record);
  }

  /** Flat list across all groups, in declaration order. */
  entries(): RegistryEntry[] {
    return this.groups.flatMap((g) => g.entries);
  }

  /** @internal — called by GroupBuilder for each descriptor. */
  add(group: GroupRecord, control: Control, desc: Descriptor, step: number): void {
    if (this.paths.has(desc.path)) throw new Error(`[tweaks] duplicate path: ${desc.path}`);
    this.paths.add(desc.path);

    // A2: defaults captured at registration. BaseControl picks live-get vs
    // descriptor.default by gate; the store mirrors what the control captured.
    const def = desc.enabledUntil ? desc.default : desc.get();
    this.store.register(desc.path, def, step);

    const ctx: ControlContext = {
      accent: group.config.accent,
      beginEdit: () => this.store.beginUndoCapture(),
      live: (v) => {
        (desc.set as (v: TweakValue) => void)(v);
        this.store.setLive(desc.path, v);
      },
      commit: (v) => {
        this.store.commit(desc.path, v);
        this.store.pushUndo();
      },
    };
    control.mount(ctx);

    group.entries.push({
      control,
      group,
      get: desc.get as () => TweakValue,
      set: desc.set as (v: TweakValue) => void,
      enabledUntil: desc.enabledUntil,
      export: desc.export,
      step,
    });
  }

  /** @internal — read-only monitor registration. Skips the store entirely (no
   *  dirty/persist/export) and wires a no-op ControlContext; the shell refreshes
   *  it from get() on the read-back loop. */
  addMonitor(group: GroupRecord, control: Control, desc: MonitorDescriptor): void {
    if (this.paths.has(desc.path)) throw new Error(`[tweaks] duplicate path: ${desc.path}`);
    this.paths.add(desc.path);

    const noop = (): void => {};
    control.mount({ accent: group.config.accent, beginEdit: noop, live: noop, commit: noop });

    group.entries.push({
      control,
      group,
      get: desc.get as () => TweakValue,
      set: noop,
      enabledUntil: desc.enabledUntil,
      export: null,
      step: 0,
      monitor: true,
    });
  }
}

export class GroupBuilder {
  constructor(
    private readonly registry: Registry,
    private readonly record: GroupRecord,
  ) {}

  addSlider(desc: SliderDescriptor): this {
    this.registry.add(this.record, new SliderControl(desc), desc, desc.step);
    return this;
  }

  addColor(desc: ColorDescriptor): this {
    this.registry.add(this.record, new ColorControl(desc), desc, 0);
    return this;
  }

  addToggle(desc: ToggleDescriptor): this {
    this.registry.add(this.record, new ToggleControl(desc), desc, 0);
    return this;
  }

  addSelect(desc: SelectDescriptor): this {
    this.registry.add(this.record, new SelectControl(desc), desc, 0);
    return this;
  }

  addInterval(desc: IntervalDescriptor): this {
    this.registry.add(this.record, new IntervalControl(desc), desc, desc.step);
    return this;
  }

  /** Read-only live readout + sparkline. No set/default/export — the input is
   *  reduced; the registry fills the contract with no-ops and skips the store. */
  addMonitor(input: MonitorInput): this {
    const desc: MonitorDescriptor = {
      ...input,
      set: () => {},
      default: input.get(),
      export: null,
    };
    this.registry.addMonitor(this.record, new MonitorControl(desc), desc);
    return this;
  }

  addVector(desc: VectorDescriptor): this {
    this.registry.add(this.record, new VectorControl(desc), desc, desc.step);
    return this;
  }
}
