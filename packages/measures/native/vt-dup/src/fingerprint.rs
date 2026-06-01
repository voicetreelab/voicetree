//! The three per-function fingerprints, mirroring
//! `duplication-fingerprints/{structural,lexical,behavioral}-fingerprint.ts`.
//!
//! - structural: canonical AST-shape (ID/LIT erased) — rootHash (exact bucket)
//!   + the multiset of subtree shapes (for exact Jaccard).
//! - lexical: 5-token shingles over the classified token stream; MinHash 128 / seed 1.
//! - behavioral: called-symbol log-buckets + quantized CFG + signature; MinHash 64 / seed 2.
//!
//! All three run off the generic arena + source bytes produced by `extract.rs`,
//! so no second parse is needed.

use crate::extract::{ExtractedFile, ExtractedFn, FnMeta, GNode};
use crate::minhash::{minhash, perms_for, stable_hash, Perms};
use std::collections::{HashMap, HashSet};

pub const LEX_SHINGLE_SIZE: usize = 5;
const LEX_PERMUTATION_COUNT: usize = 128;
const LEX_SEED: u32 = 1;
const BEH_PERMUTATION_COUNT: usize = 64;
const BEH_SEED: u32 = 2;

/// Pre-derived permutation sets, built once and shared across the parallel
/// per-file fingerprinting.
pub struct PermSets {
    pub lex: Perms,
    pub beh: Perms,
}

impl PermSets {
    pub fn new() -> Self {
        PermSets {
            lex: perms_for(LEX_SEED, LEX_PERMUTATION_COUNT),
            beh: perms_for(BEH_SEED, BEH_PERMUTATION_COUNT),
        }
    }
}

/// Lean per-function record: metadata + the three fingerprints. Carries the
/// feature sets (not just signatures) because the final score uses exact
/// Jaccard, not the MinHash estimate.
pub struct Record {
    pub meta: FnMeta,
    pub root_hash: u32,
    pub subtree_shapes: HashSet<String>,
    pub lex_shingles: HashSet<String>,
    pub lex_sig: Vec<i64>,
    pub beh_features: HashSet<String>,
    pub beh_sig: Vec<i64>,
}

// ---- structural ----------------------------------------------------------

const ID_LABELS: &[&str] = &[
    "IdentifierReference", "BindingIdentifier", "IdentifierName", "LabelIdentifier", "PrivateIdentifier",
];
const LIT_LABELS: &[&str] = &[
    "NumericLiteral", "StringLiteral", "BooleanLiteral", "NullLiteral", "BigIntLiteral", "RegExpLiteral",
];

fn erase(label: &str) -> Option<&'static str> {
    if ID_LABELS.contains(&label) {
        return Some("ID");
    }
    if LIT_LABELS.contains(&label) {
        return Some("LIT");
    }
    None
}

/// Mirror structural-fingerprint.ts collectSubtreeShapes: returns this node's
/// shape and inserts every subtree shape into `into`.
fn collect_subtree_shapes(nodes: &[GNode], idx: usize, into: &mut HashSet<String>) -> String {
    let n = &nodes[idx];
    if n.synth {
        into.insert(n.label.clone());
        return n.label.clone();
    }
    if let Some(e) = erase(&n.label) {
        into.insert(e.to_string());
        return e.to_string();
    }
    if n.children.is_empty() {
        into.insert(n.label.clone());
        return n.label.clone();
    }
    let child_shapes: Vec<String> = n.children.iter().map(|&c| collect_subtree_shapes(nodes, c as usize, into)).collect();
    let shape = format!("{}({})", n.label, child_shapes.join(","));
    into.insert(shape.clone());
    shape
}

// ---- lexical -------------------------------------------------------------

fn shingles_of(tokens: &[String], size: usize) -> HashSet<String> {
    let mut shingles = HashSet::new();
    if tokens.len() < size {
        if !tokens.is_empty() {
            shingles.insert(tokens.join("|"));
        }
        return shingles;
    }
    for start in 0..=(tokens.len() - size) {
        shingles.insert(tokens[start..start + size].join("|"));
    }
    shingles
}

// ---- behavioral ----------------------------------------------------------

const BRANCHING: &[&str] = &["IfStatement", "ConditionalExpression", "SwitchCase", "CatchClause"];
const LOOPS: &[&str] = &["ForStatement", "ForInStatement", "ForOfStatement", "WhileStatement", "DoWhileStatement"];
// tsc's body Block is a nesting increment; oxc's body is a FunctionBody, so it
// is included here to keep the quantized depth aligned (see BF-390 notes).
const NESTING: &[&str] = &[
    "FunctionBody", "BlockStatement", "IfStatement", "ForStatement", "ForInStatement",
    "ForOfStatement", "WhileStatement", "DoWhileStatement", "TryStatement", "CatchClause", "SwitchStatement",
];

fn slice<'s>(src: &'s [u8], start: u32, end: u32) -> &'s str {
    std::str::from_utf8(&src[start as usize..end as usize]).unwrap_or("")
}

fn first_child_label<'a>(nodes: &'a [GNode], idx: usize, label: &str) -> Option<&'a GNode> {
    nodes[idx].children.iter().map(|&c| &nodes[c as usize]).find(|c| c.label == label)
}

/// Mirror behavioral-fingerprint.ts calleeText: last identifier of a call's
/// callee, unwrapping member access / paren / non-null / string element access.
fn callee_text(nodes: &[GNode], idx: usize, src: &[u8]) -> Option<String> {
    let n = &nodes[idx];
    match n.label.as_str() {
        "IdentifierReference" | "IdentifierName" => Some(slice(src, n.start, n.end).to_string()),
        "StaticMemberExpression" => first_child_label(nodes, idx, "IdentifierName")
            .map(|p| slice(src, p.start, p.end).to_string()),
        "ComputedMemberExpression" => first_child_label(nodes, idx, "StringLiteral").map(|s| {
            // strip the quotes so `obj["foo"]` matches `foo`, as tsc's arg.text does
            slice(src, s.start, s.end).trim_matches(|c| c == '"' || c == '\'' || c == '`').to_string()
        }),
        "ParenthesizedExpression" | "TSNonNullExpression" => {
            n.children.first().and_then(|&c| callee_text(nodes, c as usize, src))
        }
        _ => None,
    }
}

struct CfgAccum {
    called: HashMap<String, u32>,
    branches: u32,
    loops: u32,
    max_depth: u32,
}

fn collect_behavior(nodes: &[GNode], idx: usize, depth: u32, src: &[u8], acc: &mut CfgAccum) {
    let n = &nodes[idx];
    if n.synth {
        return;
    }
    let label = n.label.as_str();
    if BRANCHING.contains(&label) {
        acc.branches += 1;
    }
    if LOOPS.contains(&label) {
        acc.loops += 1;
    }
    if label == "CallExpression" {
        if let Some(&callee) = n.children.first() {
            if let Some(name) = callee_text(nodes, callee as usize, src) {
                if !name.is_empty() {
                    *acc.called.entry(name).or_insert(0) += 1;
                }
            }
        }
    }
    let next_depth = if NESTING.contains(&label) { depth + 1 } else { depth };
    if next_depth > acc.max_depth {
        acc.max_depth = next_depth;
    }
    for &c in &n.children {
        // Stop at nested function boundaries (their bodies are separate records).
        if nodes[c as usize].is_fn {
            continue;
        }
        collect_behavior(nodes, c as usize, next_depth, src, acc);
    }
}

fn quantize(value: u32, bins: &[u32]) -> usize {
    for (index, &bin) in bins.iter().enumerate() {
        if value <= bin {
            return index;
        }
    }
    bins.len()
}

fn quantize_cfg(branches: u32, loops: u32, depth: u32) -> String {
    format!(
        "B{}L{}D{}",
        quantize(branches, &[0, 1, 3, 7]),
        quantize(loops, &[0, 1, 3, 7]),
        quantize(depth, &[1, 2, 3, 5]),
    )
}

fn log_bucket(count: u32) -> u32 {
    if count == 0 {
        return 0;
    }
    31 - count.leading_zeros() // floor(log2(count))
}

/// Does any return statement in the body carry a value? (tsc returnsValue.)
fn returns_value_scan(nodes: &[GNode], idx: usize) -> bool {
    let n = &nodes[idx];
    if n.label == "ReturnStatement" && n.children.iter().any(|&c| !nodes[c as usize].synth) {
        return true;
    }
    for &c in &n.children {
        if nodes[c as usize].is_fn {
            continue;
        }
        if returns_value_scan(nodes, c as usize) {
            return true;
        }
    }
    false
}

fn behavioral_features(file: &ExtractedFile, func: &ExtractedFn) -> HashSet<String> {
    let nodes = &file.nodes;
    let mut acc = CfgAccum { called: HashMap::new(), branches: 0, loops: 0, max_depth: 0 };
    // Walk the body subtree (the body itself is not a function boundary).
    for &c in &nodes[func.body_idx].children {
        if nodes[c as usize].is_fn {
            continue;
        }
        collect_behavior(nodes, c as usize, 0, &file.source, &mut acc);
    }
    // The body node itself is a nesting increment (FunctionBody), depth >= 1.
    let depth = acc.max_depth.max(if nodes[func.body_idx].label == "FunctionBody" { 1 } else { 0 });

    let returns = if func.sig.is_constructor {
        false
    } else if func.sig.is_arrow_expr_body {
        true
    } else {
        returns_value_scan(nodes, func.body_idx)
    };
    let signature = format!(
        "arity-{}-async-{}-returns-{}",
        func.sig.arity,
        u8::from(func.sig.is_async),
        if returns { "value" } else { "void" },
    );

    let mut features = HashSet::new();
    for (symbol, count) in &acc.called {
        features.insert(format!("cs:{symbol}@{}", log_bucket(*count)));
    }
    features.insert(format!("cfg:{}", quantize_cfg(acc.branches, acc.loops, depth)));
    features.insert(format!("sig:{signature}"));
    features
}

// ---- driver --------------------------------------------------------------

/// Fingerprint every function in a file, consuming the extraction (drops the
/// arena + source once the lean records are built).
pub fn fingerprint_file(file: ExtractedFile, perms: &PermSets) -> Vec<Record> {
    let mut records = Vec::with_capacity(file.functions.len());
    // functions are processed by index so we can borrow `file` for the arena
    // while moving each function's owned data into the record.
    for func in &file.functions {
        let mut subtree_shapes = HashSet::new();
        let root = collect_subtree_shapes(&file.nodes, func.body_idx, &mut subtree_shapes);
        let root_hash = stable_hash(&root);

        let lex_shingles = shingles_of(&func.token_stream, LEX_SHINGLE_SIZE);
        let lex_sig = minhash(lex_shingles.iter().map(|s| s.as_str()), &perms.lex);

        let beh_features = behavioral_features(&file, func);
        let beh_sig = minhash(beh_features.iter().map(|s| s.as_str()), &perms.beh);

        records.push(Record {
            meta: FnMeta {
                id: func.meta.id.clone(),
                package_name: func.meta.package_name.clone(),
                file: func.meta.file.clone(),
                line: func.meta.line,
                name: func.meta.name.clone(),
                loc: func.meta.loc,
                body_node_count: func.meta.body_node_count,
            },
            root_hash,
            subtree_shapes,
            lex_shingles,
            lex_sig,
            beh_features,
            beh_sig,
        });
    }
    records
}
