import {readFile} from 'node:fs/promises'
import {relative} from 'node:path'
import * as ts from 'typescript'
import {REPO_ROOT} from './repo-root.test'
import type {FunctionComplexity, MaintainabilityRow, SystemFile} from './types.test'

function isOperatorToken(kind: ts.SyntaxKind): boolean {
    return (kind >= ts.SyntaxKind.FirstKeyword && kind <= ts.SyntaxKind.LastKeyword)
        || (kind >= ts.SyntaxKind.FirstPunctuation && kind <= ts.SyntaxKind.LastPunctuation)
}

function isOperandToken(kind: ts.SyntaxKind): boolean {
    return kind === ts.SyntaxKind.Identifier
        || kind === ts.SyntaxKind.PrivateIdentifier
        || kind === ts.SyntaxKind.NumericLiteral
        || kind === ts.SyntaxKind.BigIntLiteral
        || kind === ts.SyntaxKind.StringLiteral
        || kind === ts.SyntaxKind.RegularExpressionLiteral
        || kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral
}

function measureHalstead(filePath: string, text: string, cyclomatic: number): MaintainabilityRow {
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, text)
    const operators = new Map<string, number>()
    const operands = new Map<string, number>()
    let token = scanner.scan()

    while (token !== ts.SyntaxKind.EndOfFileToken) {
        const value = scanner.getTokenText()
        if (isOperatorToken(token)) operators.set(value, (operators.get(value) ?? 0) + 1)
        if (isOperandToken(token)) operands.set(value, (operands.get(value) ?? 0) + 1)
        token = scanner.scan()
    }

    const n1 = operators.size
    const n2 = operands.size
    const totalOperators = [...operators.values()].reduce((sum, count) => sum + count, 0)
    const totalOperands = [...operands.values()].reduce((sum, count) => sum + count, 0)
    const vocabulary = n1 + n2
    const length = totalOperators + totalOperands
    const volume = vocabulary === 0 || length === 0 ? 0 : length * Math.log2(vocabulary)
    // SLOC term intentionally dropped: file-size pressure is gated by the dedicated
    // max-file-lines axis. Halstead-MI then measures token-level density only.
    const rawMaintainability = 171
        - 5.2 * Math.log(Math.max(1, volume))
        - 0.23 * cyclomatic
    const maintainabilityIndex = Math.max(0, Math.min(100, (rawMaintainability * 100) / 171))

    return {file: relative(REPO_ROOT, filePath), maintainabilityIndex}
}

export async function measureMaintainability(files: readonly SystemFile[], cyclomaticRows: readonly FunctionComplexity[]): Promise<MaintainabilityRow[]> {
    const cyclomaticByFile = new Map<string, number>()
    for (const row of cyclomaticRows) {
        cyclomaticByFile.set(row.file, (cyclomaticByFile.get(row.file) ?? 0) + row.score)
    }

    const rows: MaintainabilityRow[] = []
    for (const file of files) {
        const text = await readFile(file.absolutePath, 'utf8')
        rows.push(measureHalstead(file.absolutePath, text, cyclomaticByFile.get(file.relativePath) ?? 1))
    }
    return rows.sort((a, b) => a.maintainabilityIndex - b.maintainabilityIndex || a.file.localeCompare(b.file))
}
