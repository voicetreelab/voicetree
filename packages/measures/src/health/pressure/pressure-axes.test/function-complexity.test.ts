import {readFile} from 'node:fs/promises'
import * as ts from 'typescript'
import type {FunctionComplexity, SystemFile} from './types.test'

function isLogicalOperator(kind: ts.SyntaxKind): boolean {
    return kind === ts.SyntaxKind.AmpersandAmpersandToken
        || kind === ts.SyntaxKind.BarBarToken
        || kind === ts.SyntaxKind.QuestionQuestionToken
}

function isLogicalExpression(node: ts.Node): node is ts.BinaryExpression {
    return ts.isBinaryExpression(node) && isLogicalOperator(node.operatorToken.kind)
}

function countLogicalOperatorChains(expression: ts.Expression): number {
    const operators: ts.SyntaxKind[] = []
    function collect(node: ts.Node): void {
        if (!isLogicalExpression(node)) return
        collect(node.left)
        operators.push(node.operatorToken.kind)
        collect(node.right)
    }
    collect(expression)
    if (operators.length === 0) return 0
    let chains = 1
    for (let i = 1; i < operators.length; i += 1) {
        if (operators[i] !== operators[i - 1]) chains += 1
    }
    return chains
}

function propertyNameText(name: ts.PropertyName, sourceFile: ts.SourceFile): string {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text
    return name.getText(sourceFile)
}

function functionName(node: ts.Node, sourceFile: ts.SourceFile): string {
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && node.name) return node.name.text
    if (ts.isMethodDeclaration(node) && node.name) return propertyNameText(node.name, sourceFile)
    if (ts.isConstructorDeclaration(node)) return 'constructor'
    if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) return node.parent.name.text
    if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isPropertyAssignment(node.parent)) return propertyNameText(node.parent.name, sourceFile)
    return '<anonymous>'
}

function isFunctionLikeBoundary(node: ts.Node): node is ts.FunctionLikeDeclaration {
    return ts.isFunctionDeclaration(node)
        || ts.isFunctionExpression(node)
        || ts.isArrowFunction(node)
        || ts.isMethodDeclaration(node)
        || ts.isConstructorDeclaration(node)
}

function isDirectRecursiveCall(node: ts.CallExpression, name: string): boolean {
    if (name === '<anonymous>' || name === 'constructor') return false
    if (ts.isIdentifier(node.expression)) return node.expression.text === name
    if (ts.isPropertyAccessExpression(node.expression)) return node.expression.name.text === name
    return false
}

function scoreFunction(root: ts.FunctionLikeDeclaration, name: string, sourceFile: ts.SourceFile): number {
    let score = 0
    const addStructural = (nesting: number): void => { score += 1 + nesting }

    function visitIfStatement(node: ts.IfStatement, nesting: number, isElseIf: boolean): void {
        if (isElseIf) score += 1
        else addStructural(nesting)
        visit(node.expression, nesting)
        visit(node.thenStatement, nesting + 1)
        if (!node.elseStatement) return
        if (ts.isIfStatement(node.elseStatement)) {
            visitIfStatement(node.elseStatement, nesting, true)
            return
        }
        score += 1
        visit(node.elseStatement, nesting + 1)
    }

    function visit(node: ts.Node, nesting: number): void {
        if (node !== root && isFunctionLikeBoundary(node)) return
        if (ts.isIfStatement(node)) {
            visitIfStatement(node, nesting, false)
            return
        }
        if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)) {
            addStructural(nesting)
            ts.forEachChild(node, child => visit(child, nesting + 1))
            return
        }
        if (ts.isSwitchStatement(node)) {
            for (const clause of node.caseBlock.clauses) {
                if (ts.isCaseClause(clause)) score += 1 + nesting
                ts.forEachChild(clause, child => visit(child, nesting + 1))
            }
            return
        }
        if (ts.isCatchClause(node)) {
            addStructural(nesting)
            visit(node.block, nesting + 1)
            return
        }
        if (ts.isConditionalExpression(node)) {
            addStructural(nesting)
            ts.forEachChild(node, child => visit(child, nesting + 1))
            return
        }
        if ((ts.isBreakStatement(node) || ts.isContinueStatement(node)) && node.label) score += 1
        if (ts.isCallExpression(node) && isDirectRecursiveCall(node, name)) score += 1
        if (isLogicalExpression(node) && !isLogicalExpression(node.parent)) score += countLogicalOperatorChains(node)
        ts.forEachChild(node, child => visit(child, nesting))
    }

    visit(root, 0)
    return score
}

export async function measureCognitiveComplexity(files: readonly SystemFile[]): Promise<FunctionComplexity[]> {
    const rows: FunctionComplexity[] = []
    for (const file of files) {
        const text = await readFile(file.absolutePath, 'utf8')
        const sourceFile = ts.createSourceFile(file.absolutePath, text, ts.ScriptTarget.Latest, true)
        function visit(node: ts.Node): void {
            if (isFunctionLikeBoundary(node)) {
                const name = functionName(node, sourceFile)
                const {line} = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
                rows.push({
                    packageName: file.packageName,
                    file: file.relativePath,
                    line: line + 1,
                    name,
                    score: scoreFunction(node, name, sourceFile),
                })
            }
            ts.forEachChild(node, visit)
        }
        ts.forEachChild(sourceFile, visit)
    }
    return rows.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
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

export async function measureCyclomaticComplexity(files: readonly SystemFile[]): Promise<Required<FunctionComplexity>[]> {
    const rows: Required<FunctionComplexity>[] = []
    for (const file of files) {
        const text = await readFile(file.absolutePath, 'utf8')
        const sourceFile = ts.createSourceFile(file.absolutePath, text, ts.ScriptTarget.Latest, true)
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
    }
    return rows.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
}
