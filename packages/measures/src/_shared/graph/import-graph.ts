import {readdir, readFile, stat} from 'node:fs/promises'
import {dirname, join, relative, resolve} from 'node:path'
import * as ts from 'typescript'
import {DEFAULT_REPO_ROOT, type PackageInfo} from '../discovery/discover-packages.ts'

export type SourceFile = {
    readonly absolutePath: string
    readonly relativePath: string
    readonly relToSrc: string
    readonly packageName: string
}

export type Edge = {
    readonly from: SourceFile
    readonly to: SourceFile
}

type ImportGraph = {
    readonly files: readonly SourceFile[]
    readonly edges: readonly Edge[]
}

async function pathExists(p: string): Promise<boolean> {
    try { await stat(p); return true } catch { return false }
}

export async function listProductionSources(root: string): Promise<string[]> {
    if (!(await pathExists(root))) return []
    const entries = await readdir(root, {withFileTypes: true})
    const nested = await Promise.all(entries.map(async entry => {
        const path = join(root, entry.name)
        if (entry.isDirectory()) return listProductionSources(path)
        if (
            entry.isFile()
            && path.endsWith('.ts')
            && !path.endsWith('.test.ts')
            && !path.endsWith('.spec.ts')
            && !path.endsWith('.d.ts')
            && !path.endsWith('.config.ts')
            && !path.endsWith('/__audit_seed__.ts')
            && !path.includes('/__tests__/')
            && !path.includes('/__generated__/')
        )
            return [path]
        return []
    }))
    return nested.flat().sort()
}

export async function scanSourceFiles(packages: readonly PackageInfo[], repoRoot: string = DEFAULT_REPO_ROOT): Promise<SourceFile[]> {
    const nested = await Promise.all(packages.map(async pkg => {
        const files = await listProductionSources(pkg.srcRoot)
        return files.map(file => ({
            absolutePath: resolve(file),
            relativePath: relative(repoRoot, file),
            relToSrc: relative(pkg.srcRoot, file),
            packageName: pkg.dirName,
        }))
    }))
    return nested.flat().sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

export function extractImportSpecifiers(filePath: string, text: string): string[] {
    const sf = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true)
    const specs: string[] = []
    for (const stmt of sf.statements) {
        if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier))
            specs.push(stmt.moduleSpecifier.text)
        else if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier))
            specs.push(stmt.moduleSpecifier.text)
    }
    return specs
}

export function resolveFileCandidate(basePath: string, knownPaths: ReadonlySet<string>): string | null {
    const resolved = resolve(basePath)
    const candidates = resolved.endsWith('.ts') ? [resolved] : [resolved, `${resolved}.ts`, join(resolved, 'index.ts')]
    return candidates.find(c => knownPaths.has(c)) ?? null
}

export async function buildImportGraph(packages: readonly PackageInfo[], repoRoot: string = DEFAULT_REPO_ROOT): Promise<ImportGraph> {
    const files = await scanSourceFiles(packages, repoRoot)
    const filesByPath = new Map(files.map(f => [f.absolutePath, f]))
    const knownPaths = new Set(filesByPath.keys())
    const packagesByNpmName = new Map(packages.map(pkg => [pkg.name, pkg]))
    const dedupedEdges = new Set<string>()

    for (const file of files) {
        const text = await readFile(file.absolutePath, 'utf8')
        for (const specifier of extractImportSpecifiers(file.absolutePath, text)) {
            let toPath: string | null = null
            if (specifier.startsWith('.')) {
                toPath = resolveFileCandidate(join(dirname(file.absolutePath), specifier), knownPaths)
            } else {
                for (const [npmName, pkg] of packagesByNpmName) {
                    if (specifier !== npmName && !specifier.startsWith(npmName + '/')) continue
                    const subPath = specifier === npmName ? 'index' : specifier.slice(npmName.length + 1)
                    toPath = resolveFileCandidate(join(pkg.srcRoot, subPath), knownPaths)
                    break
                }
            }
            if (!toPath || toPath === file.absolutePath) continue
            dedupedEdges.add(`${file.absolutePath}\0${toPath}`)
        }
    }

    const edges = [...dedupedEdges].sort().map(key => {
        const [fromPath, toPath] = key.split('\0')
        return {from: filesByPath.get(fromPath)!, to: filesByPath.get(toPath)!}
    })

    return {files, edges}
}
