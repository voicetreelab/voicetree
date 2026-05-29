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

mod output;

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
    mode: Mode,
    root: PathBuf,
}

fn parse_args() -> Result<Args, String> {
    let mut mode: Option<Mode> = None;
    let mut root: Option<PathBuf> = None;
    let mut json = false;

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
            other => return Err(format!("unknown argument '{other}'")),
        }
    }

    if !json {
        return Err("--json is required (the only supported output format)".to_string());
    }
    let mode = mode.ok_or("--mode is required (mass|semantic|workflow)")?;
    let root = match root {
        Some(r) => r,
        None => std::env::current_dir().map_err(|e| format!("cannot resolve cwd: {e}"))?,
    };
    Ok(Args { mode, root })
}

fn run(args: &Args) -> Result<String, String> {
    // Pipeline is built up across BF-389..BF-393. For now (BF-388 scaffold) emit
    // the zeroed contract so the gate wiring (BF-394) can be built against a
    // stable interface before the engine lands.
    let _ = &args.root;
    let json = match args.mode {
        Mode::Mass => serde_json::to_string_pretty(&MassOutput::default()),
        Mode::Semantic => serde_json::to_string_pretty(&SemanticOutput::default()),
        Mode::Workflow => serde_json::to_string_pretty(&WorkflowOutput::default()),
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
