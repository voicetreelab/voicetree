/**
 * Side-effect loader: importing this module triggers every subgraph measure
 * to call {@link registerMeasure} at its top level.
 *
 * The runner imports this once; the registry is then populated for the
 * lifetime of the process. Adding a new measure means adding one line here.
 */
import '../../checks/tier_0_subgraph/behavioral/module-state-bindings.ts'
import '../../checks/tier_0_subgraph/behavioral/implicit-globals.ts'
import '../../checks/tier_0_subgraph/behavioral/ast-purity-ratio.ts'
import '../../checks/tier_0_subgraph/structural/structural-orange.ts'
import '../../checks/tier_0_subgraph/structural/tree-width-approx.ts'
// modularity-q deferred from the active gate: Q is a partition-quality
// measure whose computed value depends on the edge-set in scope. The
// baseline-capture path passes the full graph; the commit-time gate
// passes a touched-community + 1-hop subgraph, and the two produce
// different Q values for the same partition (subgraph drops cross-cluster
// edges that the full-graph Q accounted for). Re-enable after the measure
// is rewritten to compute Q over the original full partition regardless
// of subgraph window. See modularity-q.ts comment block.
import '../../checks/tier_0_subgraph/structural/dsm-upper-triangular.ts'
import '../../checks/tier_0_subgraph/structural/cycles.ts'
import '../../checks/tier_0_subgraph/structural/boundary-width.ts'
// martin-distance deferred from the active gate: same scope-drift class as
// modularity-q. I and A depend on the inbound/outbound edge counts visible
// in the current subgraph window; baseline captured over the full graph
// disagrees with the touched-community subgraph by single-edge deltas
// (e.g. Ce=13 full vs Ce=12 subgraph for the same community). Re-enable
// after the measure computes I/A over the full partition.
// import '../../checks/tier_0_subgraph/structural/martin-distance.ts'
import '../../checks/tier_0_subgraph/shape/cyclomatic-per-fn.ts'
import '../../checks/tier_0_subgraph/shape/cognitive-per-fn.ts'
import '../../checks/tier_0_subgraph/shape/exports-per-file.ts'
