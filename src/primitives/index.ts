// ether/primitives — engine-level reusable shapes.
//
// `ShaderQuad` is the canonical "fullscreen shader plane" — a backdrop
// plane that runs your GLSL with `uTime` + `uAspect` already wired.
// Use for caustics, plasma, dither fields, custom backgrounds.
//
// Future: `Disposables` aggregator, single-rAF `Ticker` if site code
// shows it'd benefit.
export { ShaderQuad, type ShaderQuadOptions } from './ShaderQuad';
