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
import '../../checks/tier_0_subgraph/structural/modularity-q.ts'
import '../../checks/tier_0_subgraph/structural/dsm-upper-triangular.ts'
import '../../checks/tier_0_subgraph/structural/cycles.ts'
import '../../checks/tier_0_subgraph/structural/boundary-width.ts'
import '../../checks/tier_0_subgraph/structural/martin-distance.ts'
import '../../checks/tier_0_subgraph/shape/cyclomatic-per-fn.ts'
import '../../checks/tier_0_subgraph/shape/cognitive-per-fn.ts'
import '../../checks/tier_0_subgraph/shape/exports-per-file.ts'
