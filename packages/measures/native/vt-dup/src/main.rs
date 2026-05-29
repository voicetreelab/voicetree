//! vt-dup — native duplication detector for the @vt/measures health gates.
//!
//! Replaces the in-process TypeScript duplication pipeline (duplication-extract,
//! duplication-fingerprints, duplication-lsh, duplication-per-function,
//! duplication-workflow, duplication-ranking). The three vitest gates shell out
//! to this binary and assert over its JSON output (design D4 / spec delta).
//!
//! Usage:
//!   vt-dup --mode {mass|semantic|workflow} --json [--root <repo-root>]
//!
//! `--root` defaults to the current working directory; the gate passes the repo
//! root explicitly. `--json` is currently the only output format (the flag is
//! accepted for forward-compatibility and to make the contract explicit at the
//! call site).

mod discovery;
mod extract;
mod output;
mod pipeline;

use output::{MassOutput, SemanticOutput, WorkflowOutput};
use std::path::PathBuf;
use std::process::ExitCode;

#[derive(Clone, Copy, PartialEq)]
enum Mode {
    Mass,
    Semantic,
    Workflow,
}

struct Args {
    mode: Option<Mode>,
    root: PathBuf,
    /// Debug/validation: dump the kept-function set (file\tline\tname\tloc\tnodes\ttokens)
    /// instead of running a gate. Used to diff the kept set against the TS extractor.
    dump_functions: bool,
}

fn parse_args() -> Result<Args, String> {
    let mut mode: Option<Mode> = None;
    let mut root: Option<PathBuf> = None;
    let mut json = false;
    let mut dump_functions = false;

    let mut it = std::env::args().skip(1);
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--mode" => {
                let value = it.next().ok_or("--mode requires a value")?;
                mode = Some(match value.as_str() {
                    "mass" => Mode::Mass,
                    "semantic" => Mode::Semantic,
                    "workflow" => Mode::Workflow,
                    other => return Err(format!("unknown --mode '{other}' (expected mass|semantic|workflow)")),
                });
            }
            "--root" => {
                root = Some(PathBuf::from(it.next().ok_or("--root requires a value")?));
            }
            "--json" => json = true,
            "--dump-functions" => dump_functions = true,
            other => return Err(format!("unknown argument '{other}'")),
        }
    }

    let root = match root {
        Some(r) => r,
        None => std::env::current_dir().map_err(|e| format!("cannot resolve cwd: {e}"))?,
    };
    if dump_functions {
        return Ok(Args { mode: None, root, dump_functions });
    }
    if !json {
        return Err("--json is required (the only supported output format)".to_string());
    }
    let mode = mode.ok_or("--mode is required (mass|semantic|workflow)")?;
    Ok(Args { mode: Some(mode), root, dump_functions })
}

fn dump_functions(root: &PathBuf) -> String {
    let files = pipeline::extract_all(root);
    let mut out = String::new();
    for file in &files {
        for func in &file.functions {
            out.push_str(&format!(
                "{}\t{}\t{}\t{}\t{}\t{}\n",
                func.meta.file, func.meta.line, func.meta.name, func.meta.loc,
                func.meta.body_node_count, func.token_stream.len(),
            ));
        }
    }
    out
}

fn run(args: &Args) -> Result<String, String> {
    // Pipeline is built up across BF-389..BF-393. For now (BF-388 scaffold) emit
    // the zeroed contract so the gate wiring (BF-394) can be built against a
    // stable interface before the engine lands.
    let _ = &args.root;
    let json = match args.mode {
        Some(Mode::Mass) => serde_json::to_string_pretty(&MassOutput::default()),
        Some(Mode::Semantic) => serde_json::to_string_pretty(&SemanticOutput::default()),
        Some(Mode::Workflow) => serde_json::to_string_pretty(&WorkflowOutput::default()),
        None => unreachable!("mode is Some unless dump_functions short-circuits in main"),
    };
    json.map_err(|e| format!("failed to serialize output: {e}"))
}

fn main() -> ExitCode {
    let args = match parse_args() {
        Ok(a) => a,
        Err(e) => {
            eprintln!("vt-dup: {e}");
            return ExitCode::FAILURE;
        }
    };
    if args.dump_functions {
        print!("{}", dump_functions(&args.root));
        return ExitCode::SUCCESS;
    }
    match run(&args) {
        Ok(json) => {
            println!("{json}");
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("vt-dup: {e}");
            ExitCode::FAILURE
        }
    }
}
