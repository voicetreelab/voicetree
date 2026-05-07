// Baseline computed from brain/knowledge/world-model (453 nodes, 117 dirs)
// using: npx tsx packages/graph-tools/scripts/compute-hygiene-baseline.ts brain/knowledge/world-model
//
// Methodology: compute p95 across the reference vault (a(G)≈3, known-good from BF-192),
// then set threshold = max(ceil(p95 × 1.5), observed_max) so the reference vault is
// violation-free by construction. This gives room for authored nodes to exceed the median
// while catching outliers in newer/larger vaults.
//
// Output:
//   max_wikilinks_per_node: mean=1.03, p50=1, p95=3, max=9  → p95×1.5=5, max=9 → threshold=9
//   max_tree_width:         mean=4.91, p50=5, p95=10, max=18 → p95×1.5=15, max=18 → threshold=18

export const HYGIENE_THRESHOLDS = {
    /** Maximum outgoing wikilinks per node before triggering a violation. */
    maxWikilinksPerNode: 9,

    /** Maximum immediate children (files + subdirectories) per directory. */
    maxTreeWidth: 18,
} as const

export type HygieneThresholds = typeof HYGIENE_THRESHOLDS
