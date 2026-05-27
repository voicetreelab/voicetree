/**
 * Core wire-type primitives owned by vt-daemon-protocol.
 *
 * These are intentionally self-defined (not re-imported from `@vt/graph-model`)
 * so the protocol package stays a leaf-tier package with no `@vt/*` runtime
 * dependencies. `NodeIdAndFilePath` is structurally a string at every layer
 * (filesystem path acts as the node ID); TypeScript's structural typing means
 * the alias defined here is assignment-compatible with the identically-shaped
 * alias in `@vt/graph-model`, so cross-package boundaries continue to compose
 * without lossy conversion.
 */

export type NodeIdAndFilePath = string
