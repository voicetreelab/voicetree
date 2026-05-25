import {execSync} from 'node:child_process'
import {readFile} from 'node:fs/promises'
import * as ts from 'typescript'
import {REPO_ROOT} from './repo-root.test'
import type {SystemFile, TurbulenceRow} from './types.test'

function countSimpleComplexity(filePath: string, text: string): number {
    const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true)
    let complexity = 0
    function visit(node: ts.Node): void {
        if (ts.isIfStatement(node)
            || ts.isForStatement(node)
            || ts.isForInStatement(node)
            || ts.isForOfStatement(node)
            || ts.isWhileStatement(node)
            || ts.isDoStatement(node)
            || ts.isSwitchStatement(node)
            || ts.isCatchClause(node)
            || ts.isConditionalExpression(node)) {
            complexity += 1
        }
        ts.forEachChild(node, visit)
    }
    ts.forEachChild(sourceFile, visit)
    return complexity
}

function tryRunGit(args: string): string | null {
    try {
        // 64 MB cap: whole-repo `git log --name-only --since=6mo` is ~1.4 MB
        // today and grows with history. The default 1 MB limit silently truncates
        // → churn map empty → file-turbulence axis falsely reports 0.
        return execSync(`git ${args}`, {cwd: REPO_ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024})
    } catch {
        return null
    }
}

function collectGitChurn(): ReadonlyMap<string, number> {
    const output = tryRunGit("log --since='6 months ago' --format=%H --name-only") ?? ''
    const churn = new Map<string, number>()
    for (const line of output.split('\n')) {
        const file = line.trim()
        if (!file) continue
        churn.set(file, (churn.get(file) ?? 0) + 1)
    }
    return churn
}

export async function measureTurbulence(files: readonly SystemFile[]): Promise<TurbulenceRow[]> {
    const churn = collectGitChurn()
    const rows: TurbulenceRow[] = []
    for (const file of files) {
        const text = await readFile(file.absolutePath, 'utf8')
        const fileChurn = churn.get(file.relativePath) ?? 0
        const complexity = countSimpleComplexity(file.absolutePath, text)
        rows.push({
            packageName: file.packageName,
            file: file.relativePath,
            churn: fileChurn,
            complexity,
            turbulence: fileChurn * complexity,
        })
    }
    return rows.sort((a, b) => b.turbulence - a.turbulence || a.file.localeCompare(b.file))
}

export function aggregateTurbulence(rows: readonly TurbulenceRow[]) {
    const grouped = new Map<string, TurbulenceRow[]>()
    for (const row of rows) {
        const existing = grouped.get(row.packageName) ?? []
        existing.push(row)
        grouped.set(row.packageName, existing)
    }

    return [...grouped.entries()].map(([packageName, files]) => {
        const total = files.reduce((sum, row) => sum + row.turbulence, 0)
        const maxFile = [...files].sort((a, b) => b.turbulence - a.turbulence || a.file.localeCompare(b.file))[0] ?? null
        return {packageName, files: files.length, total, average: files.length === 0 ? 0 : total / files.length, maxFile}
    }).sort((a, b) => b.average - a.average || a.packageName.localeCompare(b.packageName))
}
