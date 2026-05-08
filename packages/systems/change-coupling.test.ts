import {execSync} from 'node:child_process'
import {readdirSync, statSync} from 'node:fs'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'

const SYSTEMS_ROOT: string = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT: string = resolve(SYSTEMS_ROOT, '../..')
const HIGH_TEMPORAL_COUPLING_THRESHOLD = 0.5

type PackagePairStats = {
    readonly pair: string
    readonly packageA: string
    readonly packageB: string
    readonly commitsA: number
    readonly commitsB: number
    readonly eitherCommits: number
    readonly sharedCommits: number
    readonly ratio: number
}

function discoverPackageDirs(): string[] {
    return readdirSync(SYSTEMS_ROOT, {withFileTypes: true})
        .filter(entry => entry.isDirectory())
        .filter(entry => {
            try {
                return statSync(join(SYSTEMS_ROOT, entry.name, 'package.json')).isFile()
            } catch {
                return false
            }
        })
        .map(entry => entry.name)
        .sort()
}

function getGitLog(): string {
    return execSync("git log --since='6 months ago' --name-only --format=format:COMMIT_SEP", {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        maxBuffer: 20 * 1024 * 1024,
    })
}

function packageForPath(filePath: string, packages: readonly string[]): string | null {
    for (const packageName of packages) {
        if (filePath === `packages/systems/${packageName}` || filePath.startsWith(`packages/systems/${packageName}/`)) {
            return packageName
        }
    }
    return null
}

function parseTouchedPackagesByCommit(gitLog: string, packages: readonly string[]): Set<string>[] {
    return gitLog
        .split('COMMIT_SEP')
        .map(commitText => new Set(
            commitText
                .split(/\r?\n/)
                .map(line => line.trim())
                .filter(Boolean)
                .map(filePath => packageForPath(filePath, packages))
                .filter((packageName): packageName is string => packageName !== null),
        ))
        .filter(touchedPackages => touchedPackages.size > 0)
}

function buildPackagePairStats(packages: readonly string[], commits: readonly ReadonlySet<string>[]): PackagePairStats[] {
    const packageCommitCounts = new Map<string, number>(packages.map(packageName => [packageName, 0]))

    for (const touchedPackages of commits) {
        for (const packageName of touchedPackages) {
            packageCommitCounts.set(packageName, (packageCommitCounts.get(packageName) ?? 0) + 1)
        }
    }

    const stats: PackagePairStats[] = []
    for (let i = 0; i < packages.length; i += 1) {
        for (let j = i + 1; j < packages.length; j += 1) {
            const packageA = packages[i]
            const packageB = packages[j]
            const sharedCommits = commits.filter(touchedPackages => touchedPackages.has(packageA) && touchedPackages.has(packageB)).length
            const eitherCommits = commits.filter(touchedPackages => touchedPackages.has(packageA) || touchedPackages.has(packageB)).length
            const commitsA = packageCommitCounts.get(packageA) ?? 0
            const commitsB = packageCommitCounts.get(packageB) ?? 0
            const denominator = Math.min(commitsA, commitsB)

            stats.push({
                pair: `${packageA} <-> ${packageB}`,
                packageA,
                packageB,
                commitsA,
                commitsB,
                eitherCommits,
                sharedCommits,
                ratio: denominator === 0 ? 0 : sharedCommits / denominator,
            })
        }
    }

    return stats
}

function formatPercent(value: number): string {
    return `${(value * 100).toFixed(1)}%`
}

function formatReport(stats: readonly PackagePairStats[]): string {
    const lines: string[] = [
        '',
        '┌───────────────────────────────────────────────┬────────┬────────┬────────┬────────┬────────┬────────┐',
        '│ Pair                                          │ Comm A │ Comm B │ Either │ Shared │ Ratio  │ Status │',
        '├───────────────────────────────────────────────┼────────┼────────┼────────┼────────┼────────┼────────┤',
    ]

    for (const stat of stats) {
        const status = stat.ratio > HIGH_TEMPORAL_COUPLING_THRESHOLD ? 'WARN' : 'OK'
        lines.push(`│ ${stat.pair.padEnd(45)} │ ${String(stat.commitsA).padStart(6)} │ ${String(stat.commitsB).padStart(6)} │ ${String(stat.eitherCommits).padStart(6)} │ ${String(stat.sharedCommits).padStart(6)} │ ${formatPercent(stat.ratio).padStart(6)} │ ${status.padStart(6)} │`)
    }

    lines.push('└───────────────────────────────────────────────┴────────┴────────┴────────┴────────┴────────┴────────┘')

    const highCouplingPairs = stats.filter(stat => stat.ratio > HIGH_TEMPORAL_COUPLING_THRESHOLD)
    if (highCouplingPairs.length > 0) {
        lines.push('')
        lines.push(`High temporal coupling warnings (ratio > ${formatPercent(HIGH_TEMPORAL_COUPLING_THRESHOLD)}):`)
        for (const stat of highCouplingPairs) {
            lines.push(`  ${stat.pair}: ${stat.sharedCommits} shared commits, ratio ${formatPercent(stat.ratio)}`)
        }
    }

    return lines.join('\n')
}

describe('package temporal change coupling', () => {
    it('reports six-month package co-change diagnostics without gating CI', () => {
        const packages = discoverPackageDirs()
        const commits = parseTouchedPackagesByCommit(getGitLog(), packages)
        const stats = buildPackagePairStats(packages, commits)
        const report = formatReport(stats)

        console.info(report)

        expect(report).toContain('Pair')
    })
})
