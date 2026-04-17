import {readFileSync} from 'fs'
import path from 'path'
import {fileURLToPath} from 'url'
import {describe, expect, it} from 'vitest'
import {
    parseBaselineCountFromCatalogue,
    REQUIRED_COUPLING_SURFACES,
    runCytoscapeCouplingAudit,
} from '../src/cytoscapeCouplingAudit'

const testDir: string = path.dirname(fileURLToPath(import.meta.url))
const repoRoot: string = path.resolve(testDir, '../../..')

describe('runCytoscapeCouplingAudit ratchet', () => {
    it('does not let the outside projection seam count exceed the committed baseline', () => {
        const report = runCytoscapeCouplingAudit(repoRoot)
        const baselineMarkdown: string = readFileSync(report.catalogueAbsolutePath, 'utf-8')
        const baselineCount: number = parseBaselineCountFromCatalogue(baselineMarkdown)

        expect(baselineCount).toBeGreaterThanOrEqual(20)
        expect(report.outsideProjectionSeamCount).toBeLessThanOrEqual(baselineCount)
    })

    it('covers every named BF-139 surface', () => {
        const report = runCytoscapeCouplingAudit(repoRoot)
        const coveredSurfaces: readonly string[] = [...new Set(report.surfaceEntries.map(entry => entry.surface))]

        expect(coveredSurfaces).toEqual(expect.arrayContaining(REQUIRED_COUPLING_SURFACES))
    })
})
