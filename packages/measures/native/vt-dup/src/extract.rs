//! Function extraction over the oxc AST. Mirrors `duplication-extract/extract-functions.ts`.
//!
//! oxc's AST has no uniform child-enumeration, so we rebuild a generic arena tree
//! from the `Visit` enter/leave stream (the same shape `ts.forEachChild` walks),
//! then identify function-like boundaries, resolve names, apply the triviality
//! filters, and slice each body's classified token stream.
//!
//! Triviality thresholds (BF-389): MIN_AST_NODES=5 over oxc arena nodes,
//! MIN_TOKEN_COUNT=20 over the real (oxc-lexed) body token count. Both are
//! unchanged from the tsc pipeline — validated to function-set Jaccard 0.970 vs
//! the TS extractor. tsc's MIN_TOKEN_COUNT was calibrated against a buggy
//! regex-shredding scanner; oxc lexes regex literals as one token, so the same
//! threshold over a correct count reproduces the kept set (the ~3% residual is
//! exactly the regex-inflated functions tsc spuriously kept).

use oxc_allocator::Allocator;
use oxc_ast::ast::*;
use oxc_ast::AstKind;
use oxc_ast_visit::Visit;
use oxc_parser::config::TokensParserConfig;
use oxc_parser::{Kind, Parser};
use oxc_span::{GetSpan, SourceType};
use std::path::Path;

const MIN_AST_NODES: usize = 5;
const MIN_TOKEN_COUNT: usize = 20;

#[derive(Clone, Copy, PartialEq)]
pub enum Acc {
    Plain,
    Accessor, // get/set — tsc excludes these from function-like boundaries
}

/// A node in the rebuilt generic AST. `label` is the oxc node kind with payload
/// stripped; synthetic operator leaves carry `OP:<op>` labels.
pub struct GNode {
    pub label: String,
    pub start: u32,
    pub end: u32,
    pub parent: i32,
    pub children: Vec<u32>,
    pub synth: bool,
    pub is_fn: bool,
    pub acc: Acc,
}

pub struct FnMeta {
    pub id: String,
    pub package_name: String,
    pub file: String,
    pub line: usize,
    pub name: String,
    pub loc: usize,
    pub body_node_count: usize,
}

pub struct ExtractedFn {
    pub meta: FnMeta,
    /// Index into `ExtractedFile::nodes` of this function's body (FunctionBody).
    pub body_idx: usize,
    /// Classified tokens within the body span, source order (lexical signal input).
    pub token_stream: Vec<String>,
}

pub struct ExtractedFile {
    pub nodes: Vec<GNode>,
    pub functions: Vec<ExtractedFn>,
}

struct Builder {
    nodes: Vec<GNode>,
    stack: Vec<u32>,
}

impl Builder {
    fn push(&mut self, label: String, start: u32, end: u32, is_fn: bool, acc: Acc, synth: bool) -> u32 {
        let parent = self.stack.last().map(|&i| i as i32).unwrap_or(-1);
        let idx = self.nodes.len() as u32;
        self.nodes.push(GNode { label, start, end, parent, children: Vec::new(), synth, is_fn, acc });
        if parent >= 0 {
            self.nodes[parent as usize].children.push(idx);
        }
        idx
    }
}

/// debug_name() embeds payload in parens (e.g. "IdentifierReference(foo)") — strip it.
fn clean_label(name: &str) -> &str {
    match name.find('(') {
        Some(i) => &name[..i],
        None => name,
    }
}

/// Operators oxc stores as enum fields; tsc surfaces them as operatorToken children.
/// Re-inject as a synthetic leaf so `a + b` and `a - b` stay structurally distinct.
fn operator_of(kind: &AstKind) -> Option<String> {
    match kind {
        AstKind::BinaryExpression(e) => Some(format!("OP:{}", e.operator.as_str())),
        AstKind::LogicalExpression(e) => Some(format!("OP:{}", e.operator.as_str())),
        AstKind::UnaryExpression(e) => Some(format!("OP:{}", e.operator.as_str())),
        AstKind::UpdateExpression(e) => Some(format!("OP:{}", e.operator.as_str())),
        AstKind::AssignmentExpression(e) => Some(format!("OP:{}", e.operator.as_str())),
        _ => None,
    }
}

fn accessor_of(kind: &AstKind) -> Acc {
    match kind {
        AstKind::MethodDefinition(m) => match m.kind {
            MethodDefinitionKind::Get | MethodDefinitionKind::Set => Acc::Accessor,
            _ => Acc::Plain,
        },
        AstKind::ObjectProperty(p) => match p.kind {
            PropertyKind::Get | PropertyKind::Set => Acc::Accessor,
            _ => Acc::Plain,
        },
        _ => Acc::Plain,
    }
}

impl<'a> Visit<'a> for Builder {
    fn enter_node(&mut self, kind: AstKind<'a>) {
        let span = kind.span();
        let label = clean_label(&kind.debug_name()).to_string();
        let is_fn = matches!(kind, AstKind::Function(_) | AstKind::ArrowFunctionExpression(_));
        let acc = accessor_of(&kind);
        let idx = self.push(label, span.start, span.end, is_fn, acc, false);
        self.stack.push(idx);
        if let Some(op) = operator_of(&kind) {
            self.push(op, span.start, span.start, false, Acc::Plain, true);
        }
    }
    fn leave_node(&mut self, _kind: AstKind<'a>) {
        self.stack.pop();
    }
}

/// Classify a lexed token, mirroring `extract-functions.ts` classifyToken:
/// Identifier -> ID; string/number/bigint/regex/template literals -> LIT;
/// everything else (keywords incl. true/false/null, punctuation) -> its source text.
fn classify(kind: Kind) -> String {
    if kind == Kind::Ident {
        return "ID".to_string();
    }
    if kind.is_number()
        || matches!(
            kind,
            Kind::Str | Kind::RegExp | Kind::NoSubstitutionTemplate
                | Kind::TemplateHead | Kind::TemplateMiddle | Kind::TemplateTail
        )
    {
        return "LIT".to_string();
    }
    kind.to_str().to_string()
}

fn first_child_with<'a>(nodes: &'a [GNode], idx: usize, labels: &[&str]) -> Option<&'a GNode> {
    nodes[idx].children.iter().map(|&c| &nodes[c as usize]).find(|c| labels.contains(&c.label.as_str()))
}

fn slice<'s>(src: &'s [u8], start: u32, end: u32) -> &'s str {
    std::str::from_utf8(&src[start as usize..end as usize]).unwrap_or("<anonymous>")
}

/// Mirror extract-functions.ts functionName: own id; else var name; else
/// object-property key; else method/constructor key; else <anonymous>. Class
/// fields (PropertyDefinition) and get/set accessors fall outside tsc's
/// function-like boundaries — `None` signals "not an extractable boundary".
fn function_name(nodes: &[GNode], src: &[u8], idx: usize) -> Option<String> {
    let node = &nodes[idx];
    if let Some(id) = first_child_with(nodes, idx, &["BindingIdentifier"]) {
        return Some(slice(src, id.start, id.end).to_string());
    }
    let p = node.parent;
    if p < 0 {
        return Some("<anonymous>".to_string());
    }
    let parent = &nodes[p as usize];
    match parent.label.as_str() {
        "VariableDeclarator" => first_child_with(nodes, p as usize, &["BindingIdentifier"])
            .map(|id| slice(src, id.start, id.end).to_string()),
        "MethodDefinition" | "ObjectProperty" => {
            if parent.acc == Acc::Accessor {
                return None;
            }
            first_child_with(nodes, p as usize, &["IdentifierName", "StringLiteral", "NumericLiteral", "PrivateIdentifier"])
                .map(|k| slice(src, k.start, k.end).to_string())
                .or(Some("<anonymous>".to_string()))
        }
        _ => Some("<anonymous>".to_string()),
    }
}

/// tsc start line for a method is the MethodDeclaration start; oxc's boundary is
/// the inner Function — climb to the MethodDefinition so the id line matches.
fn boundary_start(nodes: &[GNode], idx: usize) -> u32 {
    let node = &nodes[idx];
    let p = node.parent;
    if p >= 0 && nodes[p as usize].label == "MethodDefinition" {
        return nodes[p as usize].start;
    }
    node.start
}

/// Real AST node count in a body subtree (synthetic operator leaves excluded).
fn count_nodes(nodes: &[GNode], idx: usize) -> usize {
    let mut total = if nodes[idx].synth { 0 } else { 1 };
    for &c in &nodes[idx].children {
        total += count_nodes(nodes, c as usize);
    }
    total
}

fn line_of(line_starts: &[u32], off: u32) -> usize {
    match line_starts.binary_search(&off) {
        Ok(i) => i + 1,
        Err(i) => i,
    }
}

pub fn extract_file(abs: &Path, rel: &str, package: &str) -> ExtractedFile {
    let src = match std::fs::read(abs) {
        Ok(s) => s,
        Err(_) => return ExtractedFile { nodes: Vec::new(), functions: Vec::new() },
    };
    let source_text = String::from_utf8_lossy(&src).to_string();
    let bytes = source_text.as_bytes();

    let allocator = Allocator::default();
    let source_type = SourceType::from_path(abs).unwrap_or(SourceType::tsx());
    let ret = Parser::new(&allocator, &source_text, source_type)
        .with_config(TokensParserConfig)
        .parse();

    // Source-order token starts + classifications (trivia is not tokenized).
    let mut token_starts: Vec<u32> = Vec::with_capacity(ret.tokens.len());
    let mut token_class: Vec<String> = Vec::with_capacity(ret.tokens.len());
    for tok in ret.tokens.iter() {
        if tok.kind() == Kind::Eof {
            continue;
        }
        token_starts.push(tok.start());
        token_class.push(classify(tok.kind()));
    }

    let mut line_starts = vec![0u32];
    for (i, &b) in bytes.iter().enumerate() {
        if b == b'\n' {
            line_starts.push((i + 1) as u32);
        }
    }

    let mut builder = Builder { nodes: Vec::new(), stack: Vec::new() };
    builder.visit_program(&ret.program);
    let nodes = builder.nodes;

    let mut functions = Vec::new();
    for idx in 0..nodes.len() {
        if !nodes[idx].is_fn {
            continue;
        }
        let body_idx = match nodes[idx].children.iter().copied().find(|&c| nodes[c as usize].label == "FunctionBody") {
            Some(c) => c as usize,
            None => continue, // overload/abstract — tsc skips (body undefined)
        };
        let name = match function_name(&nodes, bytes, idx) {
            Some(n) => n,
            None => continue, // get/set accessor
        };
        let body_node_count = count_nodes(&nodes, body_idx);
        if body_node_count < MIN_AST_NODES {
            continue;
        }
        let (bs, be) = (nodes[body_idx].start, nodes[body_idx].end);
        let lo = token_starts.partition_point(|&s| s < bs);
        let hi = token_starts.partition_point(|&s| s < be);
        if hi - lo < MIN_TOKEN_COUNT {
            continue;
        }
        let token_stream = token_class[lo..hi].to_vec();

        let start_line = line_of(&line_starts, boundary_start(&nodes, idx));
        let end_line = line_of(&line_starts, nodes[idx].end.saturating_sub(1));
        let id = format!("{rel}:{start_line}:{name}");
        functions.push(ExtractedFn {
            meta: FnMeta {
                id,
                package_name: package.to_string(),
                file: rel.to_string(),
                line: start_line,
                name,
                loc: end_line.saturating_sub(start_line) + 1,
                body_node_count,
            },
            body_idx,
            token_stream,
        });
    }

    ExtractedFile { nodes, functions }
}
