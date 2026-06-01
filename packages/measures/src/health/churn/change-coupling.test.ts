import {execSync} from 'node:child_process'
import {relative} from 'node:path'
import {describe, expect, it} from 'vitest'
import {DEFAULT_REPO_ROOT, discoverPackages, type PackageInfo} from '../../_shared/discovery/discover-packages'
import {recordHealthMetric} from '../../_shared/writers/report-writer'
import {readBudgetSync} from '../../_shared/budgets/read-budget.ts'

const REPO_ROOT: string = DEFAULT_REPO_ROOT
const {highTemporalCouplingThreshold: HIGH_TEMPORAL_COUPLING_THRESHOLD} = readBudgetSync<{highTemporalCouplingThreshold: number}>('churn/change-coupling.json')

type PackagePairStats = {
    readonly pair: string
    readonly packageA: string
    readonly packageB: string
    readonly commitsA: number
    readonly commitsB: number
    readonly eitherCommits: number
    readonly sharedCommits: number
    readonly ratio: number
    readonly containmentRatio: number
}

function getGitLog(): string {
    return execSync("git log --since='6 months ago' --name-only --format=format:COMMIT_SEP", {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        maxBuffer: 20 * 1024 * 1024,
    })
}

function packageForPath(filePath: string, packages: readonly PackageInfo[]): string | null {
    for (const pkg of packages) {
        const packageDir = relative(REPO_ROOT, pkg.absDir)
        if (filePath === packageDir || filePath.startsWith(`${packageDir}/`)) {
            return pkg.dirName
        }
    }
    return null
}

function parseTouchedPackagesByCommit(gitLog: string, packages: readonly PackageInfo[]): Set<string>[] {
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
            const minPackageCommits = Math.min(commitsA, commitsB)

            stats.push({
                pair: `${packageA} <-> ${packageB}`,
                packageA,
                packageB,
                commitsA,
                commitsB,
                eitherCommits,
                sharedCommits,
                ratio: eitherCommits === 0 ? 0 : sharedCommits / eitherCommits,
                containmentRatio: minPackageCommits === 0 ? 0 : sharedCommits / minPackageCommits,
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
        '┌───────────────────────────────────────────────┬────────┬────────┬────────┬────────┬────────┬────────┬────────┐',
        '│ Pair                                          │ Comm A │ Comm B │ Either │ Shared │ Jaccrd │ Contn  │ Status │',
        '├───────────────────────────────────────────────┼────────┼────────┼────────┼────────┼────────┼────────┼────────┤',
    ]

    for (const stat of stats) {
        const status = stat.ratio > HIGH_TEMPORAL_COUPLING_THRESHOLD ? 'WARN' : 'OK'
        lines.push(`│ ${stat.pair.padEnd(45)} │ ${String(stat.commitsA).padStart(6)} │ ${String(stat.commitsB).padStart(6)} │ ${String(stat.eitherCommits).padStart(6)} │ ${String(stat.sharedCommits).padStart(6)} │ ${formatPercent(stat.ratio).padStart(6)} │ ${formatPercent(stat.containmentRatio).padStart(6)} │ ${status.padStart(6)} │`)
    }

    lines.push('└───────────────────────────────────────────────┴────────┴────────┴────────┴────────┴────────┴────────┴────────┘')

    const highCouplingPairs = stats.filter(stat => stat.ratio > HIGH_TEMPORAL_COUPLING_THRESHOLD)
    if (highCouplingPairs.length > 0) {
        lines.push('')
        lines.push(`High temporal coupling warnings (ratio > ${formatPercent(HIGH_TEMPORAL_COUPLING_THRESHOLD)}):`)
        for (const stat of highCouplingPairs) {
            lines.push(`  ${stat.pair}: ${stat.sharedCommits} shared commits, Jaccard ratio ${formatPercent(stat.ratio)}`)
        }
    }

    return lines.join('\n')
}

describe('package temporal change coupling', () => {
    it('reports six-month package co-change diagnostics without gating CI', async () => {
        const packages = await discoverPackages()
        const packageNames = packages.map(pkg => pkg.dirName).sort()
        const commits = parseTouchedPackagesByCommit(getGitLog(), packages)
        const stats = buildPackagePairStats(packageNames, commits)
        const report = formatReport(stats)
        const maxRatio = stats.reduce((max, stat) => Math.max(max, stat.ratio), 0)
        const highCouplingPairs = stats.filter(stat => stat.ratio > HIGH_TEMPORAL_COUPLING_THRESHOLD)
        const topPairs = [...stats].sort((a, b) => b.ratio - a.ratio).slice(0, 20)

        console.info(report)

        await recordHealthMetric({
            metricId: 'change-coupling',
            metricName: 'Change Coupling',
            description: 'Highest six-month package pair Jaccard co-change ratio from git history.',
            category: 'Coupling',
            current: maxRatio,
            budget: HIGH_TEMPORAL_COUPLING_THRESHOLD,
            comparison: 'lte',
            unit: 'ratio',
            details: {
                highCouplingPairs,
                topPairs,
            },
        })

        expect(report).toContain('Pair')
    })
})
