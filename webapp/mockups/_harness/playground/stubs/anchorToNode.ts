// Browser-only stub of `@/shell/edge/UI-edge/floating-windows/anchoring/anchor-to-node`.
//
// The real module wires terminal shadow-node placement into spatial-index
// queries + floating-window chrome. applyGraphDeltaToUI only invokes
// anchorToNode when a terminal is anchored to a freshly-arrived file node —
// the playground has no terminals, so the call site is unreachable. Stub
// keeps the import graph browser-resolvable without dragging in the chrome
// stack.

export function anchorToNode(): void {}
