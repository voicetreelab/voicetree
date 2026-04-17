import {execFileSync} from 'child_process'
import {readFileSync, rmSync, writeFileSync} from 'fs'
import path from 'path'
import {fileURLToPath} from 'url'
import {describe, expect, it} from 'vitest'

const testDir: string = path.dirname(fileURLToPath(import.meta.url))
const repoRoot: string = path.resolve(testDir, '../../..')
const cataloguePath: string = path.join(
    repoRoot,
    'brain/working-memory/tasks/cytoscape-ui-decoupling/coupling-catalogue.md',
)
const seedFilePath: string = path.join(repoRoot, 'packages/graph-model/src/__audit_seed__.ts')
const REQUIRED_COUPLING_SURFACES: readonly string[] = [
    'collapseSet',
    'selection',
    'hover',
    'compound-parent',
    'layout',
    'loaded-roots',
    'F6 aggregation call sites',
    'direct cy.$ reads',
] as const

function runAuditCli(): string {
    return execFileSync(
        'zsh',
        ['-lc', 'npx tsx packages/graph-tools/scripts/audit-cytoscape-coupling.ts'],
        {
            cwd: repoRoot,
            encoding: 'utf-8',
        },
    )
}

function parseBaselineCount(markdown: string): number {
    const match: RegExpMatchArray | null = markdown.match(/Outside projection seam `cy\.\*` count: (\d+)/)
    if (!match?.[1]) {
        throw new Error('Could not parse baseline count from coupling catalogue')
    }
    return Number(match[1])
}

function parseCliCount(output: string): number {
    const match: RegExpMatchArray | null = output.match(/Outside projection seam count: (\d+)/)
    if (!match?.[1]) {
        throw new Error('Could not parse count from audit CLI output')
    }
    return Number(match[1])
}

describe('runCytoscapeCouplingAudit ratchet', () => {
    it('matches the committed baseline when run via the CLI', () => {
        const baselineMarkdown: string = readFileSync(cataloguePath, 'utf-8')
        const baselineCount: number = parseBaselineCount(baselineMarkdown)
        const output: string = runAuditCli()
        const cliCount: number = parseCliCount(output)

        // Floor sanity-checks the audit runs and returns a non-negative count. Post-L2 baseline is 11; any count ≥ 0 is valid.
        expect(baselineCount).toBeGreaterThanOrEqual(0)
        expect(cliCount).toBe(baselineCount)
        expect(output).toContain(`Catalogue: ${cataloguePath}`)
        expect(output).toContain('Named surfaces:')
        for (const surface of REQUIRED_COUPLING_SURFACES) {
            expect(output).toContain(`- ${surface}`)
        }
    })

    it('shows the seeded increase and restoration through the same CLI command', () => {
        rmSync(seedFilePath, {force: true})
        const baselineCount: number = parseCliCount(runAuditCli())

        writeFileSync(seedFilePath, '// cy.add(...)\n')
        try {
            const seededCount: number = parseCliCount(runAuditCli())
            expect(seededCount).toBeGreaterThan(baselineCount)
        } finally {
            rmSync(seedFilePath, {force: true})
        }

        const restoredCount: number = parseCliCount(runAuditCli())
        expect(restoredCount).toBe(baselineCount)
    })
})
