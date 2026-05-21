import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {describe, expect, it} from 'vitest'
import {discoverPackages, type PackageInfo} from '../../_shared/discover-packages'
import {recordHealthMetric} from '../../_shared/report-writer'

type PackageJson = {
    readonly dependencies?: Record<string, string>
    readonly devDependencies?: Record<string, string>
}

type PackageGraph = ReadonlyMap<string, readonly string[]>

async function readPackageJson(pkg: PackageInfo): Promise<PackageJson> {
    return JSON.parse(await readFile(join(pkg.absDir, 'package.json'), 'utf8')) as PackageJson
}

function dependencyNames(pkgJson: PackageJson): string[] {
    return [
        ...Object.keys(pkgJson.dependencies ?? {}),
        ...Object.keys(pkgJson.devDependencies ?? {}),
    ].filter(name => name.startsWith('@vt/')).sort()
}

async function buildPackageGraph(packages: readonly PackageInfo[]): Promise<PackageGraph> {
    const vtPackages = packages.filter(pkg => pkg.name.startsWith('@vt/'))
    const packageNames = new Set(vtPackages.map(pkg => pkg.name))
    const graph = new Map<string, string[]>()

    for (const pkg of vtPackages) {
        const pkgJson = await readPackageJson(pkg)
        graph.set(pkg.name, dependencyNames(pkgJson).filter(dep => packageNames.has(dep)))
    }

    return new Map([...graph].sort(([a], [b]) => a.localeCompare(b)))
}

function canonicalCycle(cycle: readonly string[]): string {
    const unclosed = cycle.slice(0, -1)
    const rotations = unclosed.map((_, index) => [
        ...unclosed.slice(index),
        ...unclosed.slice(0, index),
    ])
    const canonical = rotations
        .map(rotation => [...rotation, rotation[0]].join(' -> '))
        .sort((a, b) => a.localeCompare(b))[0]
    return canonical ?? cycle.join(' -> ')
}

function findCycles(graph: PackageGraph): string[] {
    const visited = new Set<string>()
    const activeIndex = new Map<string, number>()
    const stack: string[] = []
    const cycles = new Set<string>()

    const visit = (node: string): void => {
        const cycleStart = activeIndex.get(node)
        if (cycleStart !== undefined) {
            cycles.add(canonicalCycle([...stack.slice(cycleStart), node]))
            return
        }
        if (visited.has(node)) return

        visited.add(node)
        activeIndex.set(node, stack.length)
        stack.push(node)

        for (const dep of graph.get(node) ?? []) {
            visit(dep)
        }

        stack.pop()
        activeIndex.delete(node)
    }

    for (const pkg of graph.keys()) {
        visit(pkg)
    }

    return [...cycles].sort((a, b) => a.localeCompare(b))
}

describe('cross-package dependency cycles', () => {
    it('keeps @vt package.json dependency graph acyclic', async () => {
        const packages = await discoverPackages()
        const graph = await buildPackageGraph(packages)
        const cycles = findCycles(graph)
        const cycleSummary = cycles.length === 0
            ? `No circular deps among ${graph.size} @vt/* packages`
            : `Circular deps found:\n${cycles.join('\n')}`

        console.info(`\n${cycleSummary}`)

        await recordHealthMetric({
            metricId: 'cross-package-cycles',
            metricName: 'Cross-Package Cycles',
            description: 'Circular dependency chains between systems packages.',
            category: 'Coupling',
            current: cycles.length,
            budget: 0,
            comparison: 'lte',
            unit: 'cycles',
            details: {cycles},
        })

        expect(cycles, cycleSummary).toEqual([])
    })
})
