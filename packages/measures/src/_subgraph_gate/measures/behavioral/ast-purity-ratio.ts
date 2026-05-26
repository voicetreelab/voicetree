/**
 * `ast-purity-ratio` — per-file function-purity classification, aggregated
 * to a per-community impurity *ratio* (impure / total).
 *
 * This file is a thin barrel that re-exports the implementation living in
 * `./ast-purity-ratio/measure.ts`. The body is held in a single sibling
 * file so the folder contributes one helper-file's worth of exports
 * (analyzeFile, measure, MEASURE_ID) plus this barrel's `*`. Splitting
 * the implementation across multiple sibling files would inflate
 * boundary-width without buying any deep-function shape.
 *
 * See `./ast-purity-ratio/measure.ts` for the classification rules,
 * AST helpers, severity thresholds, and the `registerMeasure` side
 * effect that wires this measure into the subgraph gate.
 */
export * from './ast-purity-ratio/measure.ts'
