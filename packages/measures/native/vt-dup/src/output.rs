//! JSON output contract (design D4). Each gate mode emits its own typed shape,
//! matching exactly the fields the corresponding vitest gate consumes. `serde`
//! renames to camelCase so the JSON is byte-shape-compatible with the numbers
//! the TS pipeline previously fed to `recordHealthMetric`.
//!
//! Budgets (MAX_* constants) live in the gate test, not here — this binary is
//! the source of truth for the *computation*; the test is the source of truth
//! for the *ratchet thresholds* it asserts against.

use serde::Serialize;

/// `vt-dup --mode semantic` — per-function weighted-Jaccard duplicate pairs.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SemanticOutput {
    pub total_functions: usize,
    pub file_count: usize,
    /// Pairs reported with >= 2 matching signals (pre-threshold).
    pub pairs_reported: usize,
    /// Pairs at or above `score_threshold` — the gated metric.
    pub over_threshold: usize,
    pub score_threshold: f64,
    pub top_pairs: Vec<SemanticPair>,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SemanticPair {
    pub package_a: String,
    pub file_a: String,
    pub line_a: usize,
    pub name_a: String,
    pub package_b: String,
    pub file_b: String,
    pub line_b: usize,
    pub name_b: String,
    pub score: f64,
    pub signals_matched: Vec<String>,
}

/// `vt-dup --mode workflow` — call-DAG fingerprint duplicate pairs.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowOutput {
    pub total_functions: usize,
    pub non_trivial_functions: usize,
    pub file_count: usize,
    pub exact_buckets_with_duplicates: usize,
    pub candidate_pairs: usize,
    pub scored_pairs: usize,
    pub over_threshold: usize,
    pub exact_matches_at_threshold: usize,
    pub unresolved_internal_callee_total: usize,
    pub resolution_collision_total: usize,
    pub score_threshold: f64,
    pub top_pairs: Vec<WorkflowPair>,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowPair {
    pub package_a: String,
    pub file_a: String,
    pub line_a: usize,
    pub name_a: String,
    pub dag_depth_a: usize,
    pub dag_edge_count_a: usize,
    pub package_b: String,
    pub file_b: String,
    pub line_b: usize,
    pub name_b: String,
    pub dag_depth_b: usize,
    pub dag_edge_count_b: usize,
    pub score: f64,
    pub exact_match: bool,
    pub edge_set_jaccard: f64,
}

/// `vt-dup --mode mass` — severity-ranked recoverable-LOC gate + high-severity warning.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MassOutput {
    pub recoverable_loc: usize,
    pub high_severity_loc: usize,
    pub per_function_pairs: usize,
    pub workflow_pairs: usize,
    pub deduped_rankable: usize,
    pub import_graph: ImportGraphStats,
    pub same_file_pairs: usize,
    pub unreachable_pairs: usize,
    pub pairs_at_or_above_threshold: usize,
    pub high_severity_pairs: usize,
    pub severity_threshold: f64,
    pub high_severity_cutoff: f64,
    pub top_pairs: Vec<RankedPair>,
    pub top_high_severity: Vec<RankedPair>,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImportGraphStats {
    pub vertices: usize,
    pub edges: usize,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RankedPair {
    pub package_a: String,
    pub file_a: String,
    pub line_a: usize,
    pub name_a: String,
    pub loc_a: usize,
    pub package_b: String,
    pub file_b: String,
    pub line_b: usize,
    pub name_b: String,
    pub loc_b: usize,
    pub min_loc: usize,
    pub similarity: f64,
    pub import_distance: usize,
    pub severity: f64,
    pub source: String,
}
