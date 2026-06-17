import type {
  ColorDescriptor,
  Control,
  ControlContext,
  ExportTarget,
  GroupConfig,
  SliderDescriptor,
  ToggleDescriptor,
  TweakValue,
} from './types';
import type { Store } from './Store';
import { SliderControl } from './controls/SliderControl';
import { ColorControl } from './controls/ColorControl';
import { ToggleControl } from './controls/ToggleControl';

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
  add(group: GroupRecord, control: Control, desc: SliderDescriptor | ColorDescriptor | ToggleDescriptor, step: number): void {
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
}
