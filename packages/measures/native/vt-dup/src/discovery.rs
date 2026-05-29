//! Package + source-file discovery. Mirrors
//! `_shared/discovery/discover-packages.ts` and `function-discovery.ts`:
//! every dir with a named package.json + a `src/` dir is a package; production
//! `.ts` sources under each `src/` are the analysis corpus.
//!
//! `package` downstream means the package's *directory name* (TS uses
//! `pkg.dirName`, not `pkg.name`).

use std::fs;
use std::path::{Path, PathBuf};

/// Directory names never descended into (mirrors EXCLUDED_DIR_NAMES).
const EXCLUDED_DIR_NAMES: &[&str] = &[
    "node_modules", "dist", "dist-electron", "dist-test", "out", "build",
    ".git", ".venv", "coverage", ".worktrees", "__tests__",
];

/// Repo-relative top-level paths excluded wholesale (mirrors EXCLUDED_RELATIVE_PATHS).
const EXCLUDED_RELATIVE_PATHS: &[&str] = &["brain", "vt-website-quartz", "voicetree-evals"];

pub struct Package {
    pub dir_name: String,
    pub src_root: PathBuf,
}

pub struct SourceFile {
    pub absolute_path: PathBuf,
    /// repo-relative, forward-slash path — the `file` field of every record id.
    pub relative_path: String,
    /// package directory name.
    pub package_name: String,
}

fn package_name(abs_dir: &Path) -> Option<String> {
    let pkg_json = abs_dir.join("package.json");
    let text = fs::read_to_string(&pkg_json).ok()?;
    let parsed: serde_json::Value = serde_json::from_str(&text).ok()?;
    match parsed.get("name").and_then(|v| v.as_str()) {
        Some(name) if !name.is_empty() => Some(name.to_string()),
        _ => None,
    }
}

fn rel_to_unix(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

/// Walk the repo collecting packages (dir with a named package.json + src/).
pub fn discover_packages(root: &Path) -> Vec<Package> {
    let mut found = Vec::new();
    walk_packages(root, root, &mut found);
    found.sort_by(|a, b| a.dir_name.cmp(&b.dir_name));
    found
}

fn walk_packages(abs_dir: &Path, root: &Path, found: &mut Vec<Package>) {
    // Skip nested git roots (a vendored repo); the repo root itself is allowed.
    if abs_dir != root && abs_dir.join(".git").exists() {
        return;
    }
    if abs_dir != root {
        if let Some(_name) = package_name(abs_dir) {
            let src_dir = abs_dir.join("src");
            if src_dir.exists() {
                found.push(Package {
                    dir_name: abs_dir.file_name().unwrap_or_default().to_string_lossy().to_string(),
                    src_root: src_dir,
                });
            }
        }
    }
    let entries = match fs::read_dir(abs_dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if EXCLUDED_DIR_NAMES.contains(&name.as_str()) {
            continue;
        }
        let child = entry.path();
        let child_rel = rel_to_unix(root, &child);
        if EXCLUDED_RELATIVE_PATHS.contains(&child_rel.as_str()) {
            continue;
        }
        walk_packages(&child, root, found);
    }
}

fn is_production_source(path: &str) -> bool {
    path.ends_with(".ts")
        && !path.ends_with("/__audit_seed__.ts")
        && !path.ends_with(".test.ts")
        && !path.ends_with(".spec.ts")
        && !path.ends_with(".d.ts")
        && !path.contains("/__tests__/")
        && !path.contains("/__generated__/")
}

fn list_production_sources(root: &Path, out: &mut Vec<PathBuf>) {
    let entries = match fs::read_dir(root) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let ty = match entry.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };
        if ty.is_dir() {
            list_production_sources(&path, out);
        } else if ty.is_file() && is_production_source(&path.to_string_lossy().replace('\\', "/")) {
            out.push(path);
        }
    }
}

/// All production source files across the discovered packages, sorted by repo-relative path.
pub fn discover_source_files(packages: &[Package], root: &Path) -> Vec<SourceFile> {
    let mut files = Vec::new();
    for pkg in packages {
        let mut paths = Vec::new();
        list_production_sources(&pkg.src_root, &mut paths);
        for path in paths {
            files.push(SourceFile {
                relative_path: rel_to_unix(root, &path),
                absolute_path: path,
                package_name: pkg.dir_name.clone(),
            });
        }
    }
    files.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    files
}
