/**
 * aether — root barrel.
 *
 * Deliberately empty: the kit is consumed ONLY through its sub-exports
 * (`aether/core`, `aether/astro`, `aether/postfx`, `aether/scroll`,
 * `aether/quality`, `aether/dev`, `aether/interactions`, `aether/text`,
 * `aether/primitives`) — bundler tree-shaking is reliable across tools
 * when you target a sub-export. See /kit/README.md for the module map.
 */
export {};
