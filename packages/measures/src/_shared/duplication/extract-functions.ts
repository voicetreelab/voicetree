/**
 * Discover all function-shaped declarations from a set of source files and
 * produce the records the duplication pipeline operates on.
 *
 * Filters out trivial functions before fingerprinting — anything below
 * MIN_AST_NODES or MIN_TOKEN_COUNT is too small to carry semantic content
 * worth comparing. The thresholds live as module-local consts so they can be
 * tightened/loosened in one place; callers do not need to know about them.
 *
 * Matches the function-boundary rules used by cyclomatic.ts so the two
 * measures stay aligned.
 */
import {readFile} from 'node:fs/promises'
import * as ts from 'typescript'
import type {SourceFileInfo} from '../discovery/function-discovery'

export type FunctionRecord = {
    readonly id: string
    readonly packageName: string
    readonly file: string
    readonly line: number
    readonly name: string
    readonly node: ts.FunctionLikeDeclaration
    readonly sourceFile: ts.SourceFile
    readonly tokenStream: readonly string[]
    readonly bodyNodeCount: number
}

const MIN_AST_NODES: number = 5
const MIN_TOKEN_COUNT: number = 20

function isFunctionLikeBoundary(node: ts.Node): node is ts.FunctionLikeDeclaration {
    return ts.isFunctionDeclaration(node)
        || ts.isFunctionExpression(node)
        || ts.isArrowFunction(node)
        || ts.isMethodDeclaration(node)
        || ts.isConstructorDeclaration(node)
}

function propertyNameText(name: ts.PropertyName, sourceFile: ts.SourceFile): string {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text
    return name.getText(sourceFile)
}

function functionName(node: ts.Node, sourceFile: ts.SourceFile): string {
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && node.name) return node.name.text
    if (ts.isMethodDeclaration(node) && node.name) return propertyNameText(node.name, sourceFile)
    if (ts.isConstructorDeclaration(node)) return 'constructor'
    if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
        return node.parent.name.text
    }
    if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isPropertyAssignment(node.parent)) {
        return propertyNameText(node.parent.name, sourceFile)
    }
    return '<anonymous>'
}

function functionBody(node: ts.FunctionLikeDeclaration): ts.Node | undefined {
    return node.body
}

function countBodyNodes(body: ts.Node): number {
    let count = 0
    function visit(node: ts.Node): void {
        count += 1
        ts.forEachChild(node, visit)
    }
    visit(body)
    return count
}

const SKIP_TRIVIA_TOKENS: ReadonlySet<ts.SyntaxKind> = new Set([
    ts.SyntaxKind.WhitespaceTrivia,
    ts.SyntaxKind.NewLineTrivia,
    ts.SyntaxKind.SingleLineCommentTrivia,
    ts.SyntaxKind.MultiLineCommentTrivia,
    ts.SyntaxKind.ShebangTrivia,
    ts.SyntaxKind.ConflictMarkerTrivia,
])

function classifyToken(kind: ts.SyntaxKind, text: string): string {
    if (kind === ts.SyntaxKind.Identifier) return 'ID'
    if (kind === ts.SyntaxKind.StringLiteral
        || kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral
        || kind === ts.SyntaxKind.TemplateHead
        || kind === ts.SyntaxKind.TemplateMiddle
        || kind === ts.SyntaxKind.TemplateTail
        || kind === ts.SyntaxKind.NumericLiteral
        || kind === ts.SyntaxKind.BigIntLiteral
        || kind === ts.SyntaxKind.RegularExpressionLiteral) {
        return 'LIT'
    }
    // For punctuation/keywords, the SyntaxKind name is what we want.
    return ts.SyntaxKind[kind] ?? text
}

function tokenizeRange(text: string, body: ts.Node, sourceFile: ts.SourceFile): string[] {
    const tokens: string[] = []
    const start = body.getStart(sourceFile, /*includeJsDocComment*/ false)
    const end = body.getEnd()
    const scanner = ts.createScanner(
        ts.ScriptTarget.Latest,
        /* skipTrivia */ true,
        ts.LanguageVariant.Standard,
        text,
        /* onError */ undefined,
        /* start */ start,
        /* length */ end - start,
    )
    while (true) {
        const kind = scanner.scan()
        if (kind === ts.SyntaxKind.EndOfFileToken) break
        if (scanner.getTokenStart() >= end) break
        if (SKIP_TRIVIA_TOKENS.has(kind)) continue
        tokens.push(classifyToken(kind, scanner.getTokenText()))
    }
    return tokens
}

function makeRecord(
    file: SourceFileInfo,
    sourceFile: ts.SourceFile,
    text: string,
    node: ts.FunctionLikeDeclaration,
): FunctionRecord | null {
    const body = functionBody(node)
    if (!body) return null
    const bodyNodeCount = countBodyNodes(body)
    if (bodyNodeCount < MIN_AST_NODES) return null
    const tokenStream = tokenizeRange(text, body, sourceFile)
    if (tokenStream.length < MIN_TOKEN_COUNT) return null
    const {line} = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    const name = functionName(node, sourceFile)
    return {
        id: `${file.relativePath}:${line + 1}:${name}`,
        packageName: file.packageName,
        file: file.relativePath,
        line: line + 1,
        name,
        node,
        sourceFile,
        tokenStream,
        bodyNodeCount,
    }
}

async function extractFromFile(file: SourceFileInfo): Promise<FunctionRecord[]> {
    const text = await readFile(file.absolutePath, 'utf8')
    const sourceFile = ts.createSourceFile(file.absolutePath, text, ts.ScriptTarget.Latest, true)
    const records: FunctionRecord[] = []
    function visit(node: ts.Node): void {
        if (isFunctionLikeBoundary(node)) {
            const record = makeRecord(file, sourceFile, text, node)
            if (record) records.push(record)
        }
        ts.forEachChild(node, visit)
    }
    ts.forEachChild(sourceFile, visit)
    return records
}

export async function extractFunctions(files: readonly SourceFileInfo[]): Promise<FunctionRecord[]> {
    const nested = await Promise.all(files.map(extractFromFile))
    return nested.flat()
}

/** Synchronous variant for unit tests that pass pre-parsed sources. */
export function extractFunctionsFromSource(
    file: SourceFileInfo,
    text: string,
): FunctionRecord[] {
    const sourceFile = ts.createSourceFile(file.absolutePath, text, ts.ScriptTarget.Latest, true)
    const records: FunctionRecord[] = []
    function visit(node: ts.Node): void {
        if (isFunctionLikeBoundary(node)) {
            const record = makeRecord(file, sourceFile, text, node)
            if (record) records.push(record)
        }
        ts.forEachChild(node, visit)
    }
    ts.forEachChild(sourceFile, visit)
    return records
}
