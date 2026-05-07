import path from 'path'
import {fileURLToPath} from 'url'
import {
    renderCytoscapeCouplingAuditSummary,
    runCytoscapeCouplingAudit,
    writeCytoscapeCouplingCatalogue,
} from '../src/cytoscapeCouplingAudit'

const scriptDir: string = path.dirname(fileURLToPath(import.meta.url))
const repoRoot: string = path.resolve(scriptDir, '../../..')
const shouldWriteCatalogue: boolean = process.argv.includes('--write-catalogue')

const report = runCytoscapeCouplingAudit(repoRoot)
if (shouldWriteCatalogue) {
    writeCytoscapeCouplingCatalogue(report)
}

console.log(renderCytoscapeCouplingAuditSummary(report))
