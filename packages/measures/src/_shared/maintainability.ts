import {readFile} from 'node:fs/promises'
import {relative} from 'node:path'
import * as ts from 'typescript'
import type {FunctionComplexity} from './cyclomatic'
import {DEFAULT_REPO_ROOT} from './discover-packages'
import type {SourceFileInfo} from './function-discovery'

export type MaintainabilityRow = {
    readonly file: string
    readonly sloc: number
    readonly vocabulary: number
    readonly length: number
    readonly volume: number
    readonly cyclomatic: number
    readonly maintainabilityIndex: number
}

function sourceLinesOfCode(text: string): number {
    return text.split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('//') && !line.startsWith('*') && !line.startsWith('/*'))
        .length
}

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

function measureHalstead(
    filePath: string,
    text: string,
    cyclomatic: number,
    repoRoot: string,
): MaintainabilityRow {
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

    const vocabulary = operators.size + operands.size
    const length = [...operators.values()].reduce((sum, count) => sum + count, 0)
        + [...operands.values()].reduce((sum, count) => sum + count, 0)
    const volume = vocabulary === 0 || length === 0 ? 0 : length * Math.log2(vocabulary)
    const sloc = sourceLinesOfCode(text)
    const rawMaintainability = 171
        - 5.2 * Math.log(Math.max(1, volume))
        - 0.23 * cyclomatic
        - 16.2 * Math.log(Math.max(1, sloc))
    const maintainabilityIndex = Math.max(0, Math.min(100, (rawMaintainability * 100) / 171))

    return {
        file: relative(repoRoot, filePath),
        sloc,
        vocabulary,
        length,
        volume,
        cyclomatic,
        maintainabilityIndex,
    }
}

export async function measureMaintainability(
    files: readonly SourceFileInfo[],
    cyclomaticRows: readonly FunctionComplexity[],
    repoRoot: string = DEFAULT_REPO_ROOT,
): Promise<MaintainabilityRow[]> {
    const cyclomaticByFile = new Map<string, number>()
    for (const row of cyclomaticRows) {
        cyclomaticByFile.set(row.file, (cyclomaticByFile.get(row.file) ?? 0) + row.score)
    }

    const rows = await Promise.all(files.map(async file => {
        const text = await readFile(file.absolutePath, 'utf8')
        return measureHalstead(file.absolutePath, text, cyclomaticByFile.get(file.relativePath) ?? 1, repoRoot)
    }))
    return rows.sort((a, b) => a.maintainabilityIndex - b.maintainabilityIndex || a.file.localeCompare(b.file))
}
