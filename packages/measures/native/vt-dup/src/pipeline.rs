//! Orchestration: discovery -> per-file extraction (parallel). Fingerprinting,
//! clustering, the workflow signal and severity ranking attach here in
//! BF-390..BF-393.

use crate::discovery;
use crate::extract::{self, ExtractedFile};
use crate::fingerprint::{fingerprint_file, PermSets, Record};
use rayon::prelude::*;
use std::path::Path;

/// Discover packages + production sources under `root`, then extract functions
/// from every file in parallel. One `ExtractedFile` per source file; each owns
/// its AST arena so downstream fingerprinting can borrow it and drop it.
pub fn extract_all(root: &Path) -> Vec<ExtractedFile> {
    let packages = discovery::discover_packages(root);
    let files = discovery::discover_source_files(&packages, root);
    files
        .par_iter()
        .map(|f| extract::extract_file(&f.absolute_path, &f.relative_path, &f.package_name))
        .collect()
}

/// Discover + extract + fingerprint every function. The AST arena for each file
/// is dropped as soon as its lean fingerprint records are built (matches the TS
/// pipeline's memory discipline).
pub fn fingerprint_all(root: &Path) -> Vec<Record> {
    let packages = discovery::discover_packages(root);
    let files = discovery::discover_source_files(&packages, root);
    let perms = PermSets::new();
    files
        .par_iter()
        .flat_map_iter(|f| {
            let extracted = extract::extract_file(&f.absolute_path, &f.relative_path, &f.package_name);
            fingerprint_file(extracted, &perms).into_iter()
        })
        .collect()
}
