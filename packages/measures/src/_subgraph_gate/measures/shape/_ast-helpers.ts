/**
 * Local AST helpers shared across the three shape measures
 * (cyclomatic-per-fn, cognitive-per-fn, exports-per-file).
 *
 * Kept co-located under `_subgraph_gate/measures/shape/` rather than promoted to
 * `_shared/` because:
 *   1. Every helper here is a pure function from `ts.Node` → primitive,
 *      so duplicating semantics in a peer agent's measure is harmless.
 *   2. Promoting now would force coordination with the BEHAVIORAL and
 *      STRUCTURAL agents working in parallel worktrees, for no gain —
 *      shape measures are the only callers.
 *   3. The repo already has equivalents under `_shared/complexity/`
 *      (`cyclomatic.ts`, `cogcx-scorer.ts`) that this file is
 *      intentionally aligned with; a future cleanup can dedupe in one
 *      pass after all three subgraph agents land.
 */
// IMPORTANT: import the typescript module from ts-morph rather than the
// project's `typescript` package. ts-morph ships its own (newer) TS, and
// the SourceFile/Node objects we read via `project.getSourceFile().compilerNode`
// belong to THAT TS. Mixing `import * as ts from 'typescript'` (5.8.x) with
// ts-morph's bundled TS (6.x) makes type-predicates silently return false
// because the SyntaxKind enum constants differ across versions.
import {ts} from 'ts-morph'

export type FunctionDetail = {
    readonly name: string
    readonly line: number
    readonly score: number
}

export function isFunctionLikeBoundary(node: ts.Node): node is ts.FunctionLikeDeclaration {
    return ts.isFunctionDeclaration(node)
        || ts.isFunctionExpression(node)
        || ts.isArrowFunction(node)
        || ts.isMethodDeclaration(node)
        || ts.isConstructorDeclaration(node)
        || ts.isGetAccessorDeclaration(node)
        || ts.isSetAccessorDeclaration(node)
}

function propertyNameText(name: ts.PropertyName, sourceFile: ts.SourceFile): string {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text
    return name.getText(sourceFile)
}

export function functionName(node: ts.Node, sourceFile: ts.SourceFile): string {
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && node.name) return node.name.text
    if (ts.isMethodDeclaration(node) && node.name) return propertyNameText(node.name, sourceFile)
    if ((ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) && node.name) {
        const prefix = ts.isGetAccessorDeclaration(node) ? 'get ' : 'set '
        return prefix + propertyNameText(node.name, sourceFile)
    }
    if (ts.isConstructorDeclaration(node)) return 'constructor'
    if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
        return node.parent.name.text
    }
    if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isPropertyAssignment(node.parent)) {
        return propertyNameText(node.parent.name, sourceFile)
    }
    return '<anonymous>'
}

/**
 * Walk every function-like declaration in `sourceFile` (including nested
 * functions) and yield `{name, line, score}` for each, where `score` is
 * produced by `scoreOne`.
 *
 * `scoreOne` is called with the function root and the enclosing SourceFile;
 * it returns a non-negative integer score for the function's body (must
 * itself stop at nested-function boundaries — see the scorer contracts).
 *
 * Pure: no I/O, no shared state, deterministic for a given `sourceFile`.
 */
export function walkFunctions(
    sourceFile: ts.SourceFile,
    scoreOne: (root: ts.FunctionLikeDeclaration, name: string, sourceFile: ts.SourceFile) => number,
): FunctionDetail[] {
    const results: FunctionDetail[] = []
    function visit(node: ts.Node): void {
        if (isFunctionLikeBoundary(node)) {
            const name = functionName(node, sourceFile)
            const {line} = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
            results.push({name, line: line + 1, score: scoreOne(node, name, sourceFile)})
        }
        ts.forEachChild(node, visit)
    }
    ts.forEachChild(sourceFile, visit)
    return results
}
