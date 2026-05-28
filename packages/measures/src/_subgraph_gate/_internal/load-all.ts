/**
 * Side-effect loader: importing this module triggers every subgraph measure
 * to call {@link registerMeasure} at its top level.
 *
 * The runner imports this once; the registry is then populated for the
 * lifetime of the process. Adding a new measure means adding one line here.
 */
import '../measures/behavioral/module-state-bindings.ts'
import '../measures/behavioral/implicit-globals.ts'
import '../measures/behavioral/ast-purity-ratio.ts'
import '../measures/structural/structural-orange.ts'
import '../measures/structural/tree-width-approx.ts'
// modularity-q deferred from the active gate: Q is a partition-quality
// measure whose computed value depends on the edge-set in scope. The
// baseline-capture path passes the full graph; the commit-time gate
// passes a touched-community + 1-hop subgraph, and the two produce
// different Q values for the same partition (subgraph drops cross-cluster
// edges that the full-graph Q accounted for). Re-enable after the measure
// is rewritten to compute Q over the original full partition regardless
// of subgraph window. See modularity-q.ts comment block.
import '../measures/structural/dsm-upper-triangular.ts'
import '../measures/structural/cycles.ts'
import '../measures/structural/boundary-width.ts'
import '../measures/structural/relative-import-depth.ts'
// martin-distance deferred from the active gate: same scope-drift class as
// modularity-q. I and A depend on the inbound/outbound edge counts visible
// in the current subgraph window; baseline captured over the full graph
// disagrees with the touched-community subgraph by single-edge deltas
// (e.g. Ce=13 full vs Ce=12 subgraph for the same community). Re-enable
// after the measure computes I/A over the full partition.
// import '../measures/structural/_deferred/martin-distance.ts'
import '../measures/shape/cyclomatic-per-fn.ts'
import '../measures/shape/cognitive-per-fn.ts'
import '../measures/shape/exports-per-file.ts'
