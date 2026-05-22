import * as ts from 'typescript'

function isLogicalOperator(kind: ts.SyntaxKind): boolean {
    return kind === ts.SyntaxKind.AmpersandAmpersandToken
        || kind === ts.SyntaxKind.BarBarToken
        || kind === ts.SyntaxKind.QuestionQuestionToken
}

function isLogicalExpression(node: ts.Node): node is ts.BinaryExpression {
    return ts.isBinaryExpression(node) && isLogicalOperator(node.operatorToken.kind)
}

function countLogicalOperatorChains(expression: ts.BinaryExpression): number {
    const operators: ts.SyntaxKind[] = []

    function collect(node: ts.Expression): void {
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

export function scoreFunction(root: ts.FunctionLikeDeclaration, name: string, sourceFile: ts.SourceFile): number {
    let score = 0

    function addStructural(nesting: number): void {
        score += 1 + nesting
    }

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

        if ((ts.isBreakStatement(node) || ts.isContinueStatement(node)) && node.label) {
            score += 1
        }

        if (ts.isCallExpression(node) && isDirectRecursiveCall(node, name)) {
            score += 1
        }

        if (isLogicalExpression(node) && !isLogicalExpression(node.parent)) {
            score += countLogicalOperatorChains(node)
        }

        ts.forEachChild(node, child => visit(child, nesting))
    }

    visit(root, 0)
    return score
}
