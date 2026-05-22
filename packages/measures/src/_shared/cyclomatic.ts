import {readFile} from 'node:fs/promises'
import * as ts from 'typescript'
import type {SourceFileInfo} from './function-discovery'

export type FunctionComplexity = {
    readonly packageName: string
    readonly file: string
    readonly line: number
    readonly name: string
    readonly score: number
    readonly crapZeroCoverage: number
}

function isLogicalOperator(kind: ts.SyntaxKind): boolean {
    return kind === ts.SyntaxKind.AmpersandAmpersandToken
        || kind === ts.SyntaxKind.BarBarToken
        || kind === ts.SyntaxKind.QuestionQuestionToken
}

function isLogicalExpression(node: ts.Node): node is ts.BinaryExpression {
    return ts.isBinaryExpression(node) && isLogicalOperator(node.operatorToken.kind)
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

function isFunctionLikeBoundary(node: ts.Node): node is ts.FunctionLikeDeclaration {
    return ts.isFunctionDeclaration(node)
        || ts.isFunctionExpression(node)
        || ts.isArrowFunction(node)
        || ts.isMethodDeclaration(node)
        || ts.isConstructorDeclaration(node)
}

function cyclomaticIncrement(node: ts.Node): number {
    if (ts.isIfStatement(node)
        || ts.isForStatement(node)
        || ts.isForInStatement(node)
        || ts.isForOfStatement(node)
        || ts.isWhileStatement(node)
        || ts.isDoStatement(node)
        || ts.isCatchClause(node)
        || ts.isConditionalExpression(node)) {
        return 1
    }
    if (ts.isCaseClause(node)) return 1
    if (isLogicalExpression(node)) return 1
    return 0
}

function scoreCyclomaticComplexity(root: ts.FunctionLikeDeclaration): number {
    let score = 1
    function visit(node: ts.Node): void {
        if (node !== root && isFunctionLikeBoundary(node)) return
        score += cyclomaticIncrement(node)
        ts.forEachChild(node, visit)
    }
    visit(root)
    return score
}

export async function measureCyclomaticComplexity(files: readonly SourceFileInfo[]): Promise<FunctionComplexity[]> {
    const nested = await Promise.all(files.map(async file => {
        const text = await readFile(file.absolutePath, 'utf8')
        const sourceFile = ts.createSourceFile(file.absolutePath, text, ts.ScriptTarget.Latest, true)
        const rows: FunctionComplexity[] = []
        function visit(node: ts.Node): void {
            if (isFunctionLikeBoundary(node)) {
                const name = functionName(node, sourceFile)
                const {line} = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
                const score = scoreCyclomaticComplexity(node)
                rows.push({
                    packageName: file.packageName,
                    file: file.relativePath,
                    line: line + 1,
                    name,
                    score,
                    crapZeroCoverage: score * score + score,
                })
            }
            ts.forEachChild(node, visit)
        }
        ts.forEachChild(sourceFile, visit)
        return rows
    }))
    return nested.flat().sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.line - b.line)
}
