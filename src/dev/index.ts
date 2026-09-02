// aether/dev — development overlays + diagnostics.
//
// Import lazily and gate behind a URL param so the cost only lands
// when explicitly requested. Safe to ship in production builds —
// the overlay does nothing until mounted.
export { Stats } from './Stats';
export { Tweaks } from './tweaks';
export type {
  TweaksConfig,
  GroupConfig,
  Control,
  ControlContext,
  TweakValue,
  Descriptor,
  BaseDescriptor,
  SliderDescriptor,
  ColorDescriptor,
  ToggleDescriptor,
  SelectDescriptor,
  IntervalDescriptor,
  MonitorDescriptor,
  VectorDescriptor,
  MonitorInput,
  DiffMap,
} from './tweaks';
