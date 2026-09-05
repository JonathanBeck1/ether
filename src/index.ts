/**
 * ether — root barrel.
 *
 * Deliberately empty: the kit is consumed ONLY through its sub-exports
 * (`ether/core`, `ether/astro`, `ether/postfx`, `ether/scroll`,
 * `ether/quality`, `ether/dev`, `ether/interactions`, `ether/text`,
 * `ether/primitives`) — bundler tree-shaking is reliable across tools
 * when you target a sub-export. See /kit/README.md for the module map.
 */
export {};
