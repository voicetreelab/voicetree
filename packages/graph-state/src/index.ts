/**
 * @vt/graph-state — contract-only barrel (BF-138).
 *
 * At this level, graph-state exports TYPES ONLY. The package is the single
 * public surface that every L1 consumer (cytoscape shell, CLI, live MCP
 * client) writes against. Implementation lands in BF-142 and beyond.
 *
 * See:
 * - src/contract.d.ts       — public types + function signatures
 * - decisions.md            — numbered decisions w/ rationale + alternatives
 * - fixture-format.md       — schema consumed by BF-141 (test fixtures)
 */
export type {
    State,
    StateRoots,
    StateLayout,
    StateMetadata,
    Command,
    Collapse,
    Expand,
    Select,
    Deselect,
    AddNode,
    RemoveNode,
    AddEdge,
    RemoveEdge,
    Move,
    LoadRoot,
    UnloadRoot,
    Delta,
    ElementSpec,
    NodeElement,
    EdgeElement,
    ChangeToken,
    Subscription,
    Unsubscribe,
    LiveTransport,
    GraphStateAPI,
} from './contract'
