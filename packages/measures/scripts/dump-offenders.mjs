// Per-file dump of implicit-globals and boundary-width for graph-db-server/data and /application
// Run with: node --experimental-strip-types packages/measures/scripts/dump-offenders.mjs
import { readFile, readdir, stat } from 'node:fs/promises'
import { join, relative, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Project } from 'ts-morph'
import { analyzeFile } from '../src/_subgraph_gate/measures/behavioral/implicit-globals.ts'
import { exportedSymbolNames } from '../src/_shared/complexity/exported-symbols.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

async function listProductionSources(dir) {
  const out = []
  const entries = await readdir(dir, { withFileTypes: true })
  for (const e of entries) {
    const path = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === '__tests__' || e.name === '__generated__') continue
      out.push(...(await listProductionSources(path)))
    } else if (
      path.endsWith('.ts')
      && !path.endsWith('.test.ts')
      && !path.endsWith('.spec.ts')
      && !path.endsWith('.d.ts')
      && !path.endsWith('.config.ts')
    ) {
      out.push(path)
    }
  }
  return out
}

async function dumpCommunity(label, dir) {
  const files = await listProductionSources(dir)
  const project = new Project({ useInMemoryFileSystem: false, skipAddingFilesFromTsConfig: true })
  for (const f of files) project.addSourceFileAtPath(f)

  const rows = []
  for (const f of files) {
    const morphFile = project.getSourceFile(f)
    const ig = analyzeFile(morphFile)
    const text = await readFile(f, 'utf8')
    const exports = exportedSymbolNames(f, text).length
    rows.push({
      file: relative(ROOT, f),
      implicitGlobals: ig.total,
      byCategory: ig.byCategory,
      exports,
    })
  }

  const totalIG = rows.reduce((s, r) => s + r.implicitGlobals, 0)
  const totalExports = rows.reduce((s, r) => s + r.exports, 0)
  console.log(`\n=== ${label} (totals: implicit-globals=${totalIG}, boundary-width=${totalExports}) ===\n`)

  console.log('Top implicit-globals offenders:')
  for (const r of [...rows].sort((a, b) => b.implicitGlobals - a.implicitGlobals).slice(0, 10)) {
    const cats = Object.entries(r.byCategory).filter(([, n]) => n > 0).map(([c, n]) => `${c}=${n}`).join(' ')
    console.log(`  ${String(r.implicitGlobals).padStart(3)} (${cats || '—'})  ${r.file}`)
  }

  console.log('\nTop boundary-width offenders (exports):')
  for (const r of [...rows].sort((a, b) => b.exports - a.exports).slice(0, 10)) {
    console.log(`  ${String(r.exports).padStart(3)} exports  ${r.file}`)
  }
}

await dumpCommunity('graph-db-server/data', `${ROOT}/packages/systems/graph-db-server/src/data`)
await dumpCommunity('graph-db-server/application', `${ROOT}/packages/systems/graph-db-server/src/application`)
