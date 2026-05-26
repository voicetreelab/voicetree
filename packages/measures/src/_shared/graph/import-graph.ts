import {readdir, readFile, stat} from 'node:fs/promises'
import {dirname, join, relative, resolve} from 'node:path'
import * as ts from 'typescript'
import {DEFAULT_REPO_ROOT, type PackageInfo} from '../discovery/discover-packages.ts'
import {resolveWorkspaceBasePath} from '../discovery/package-exports'

const SOURCE_EXTENSIONS: readonly string[] = ['.ts', '.tsx']

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

export type ImportGraph = {
    readonly files: readonly SourceFile[]
    readonly edges: readonly Edge[]
}

async function sourceRootStatOrNull(p: string) {
    try {
        return await stat(p)
    } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw cause
    }
}

function isSourceFile(path: string, extensions: readonly string[] = SOURCE_EXTENSIONS): boolean {
    return extensions.some(ext => path.endsWith(ext))
        && !path.endsWith('.test.ts')
        && !path.endsWith('.test.tsx')
        && !path.endsWith('.spec.ts')
        && !path.endsWith('.spec.tsx')
        && !path.endsWith('.d.ts')
        && !path.endsWith('.config.ts')
        && !path.endsWith('.config.tsx')
        && !path.endsWith('/__audit_seed__.ts')
}

function isProductionSource(path: string): boolean {
    return isSourceFile(path, ['.ts'])
        && !path.includes('/__tests__/')
        && !path.includes('/__generated__/')
}

export async function listProductionSources(root: string): Promise<string[]> {
    const rootStat = await sourceRootStatOrNull(root)
    if (!rootStat) return []

    if (rootStat.isFile()) {
        return isSourceFile(root) ? [root] : []
    }
    if (!rootStat.isDirectory()) return []

    async function walk(absDir: string): Promise<string[]> {
        const entries = await readdir(absDir, {withFileTypes: true})
        const nested = await Promise.all(entries.map(async entry => {
            const path = join(absDir, entry.name)
            if (entry.isDirectory()) return walk(path)
            if (entry.isFile() && isProductionSource(path)) return [path]
            return []
        }))
        return nested.flat()
    }

    return (await walk(root)).sort()
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

function scriptKindForPath(filePath: string): ts.ScriptKind {
    if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX
    return ts.ScriptKind.TS
}

export function extractImportSpecifiers(filePath: string, text: string): string[] {
    const sf = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, scriptKindForPath(filePath))
    const specs: string[] = []
    for (const stmt of sf.statements) {
        if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier))
            specs.push(stmt.moduleSpecifier.text)
        else if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier))
            specs.push(stmt.moduleSpecifier.text)
    }
    return specs
}

export function resolveFileCandidate(
    basePath: string,
    knownPaths: ReadonlySet<string>,
    extensions: readonly string[] = SOURCE_EXTENSIONS,
): string | null {
    const resolved = resolve(basePath)
    const candidates = [
        resolved,
        ...extensions.map(ext => `${resolved}${ext}`),
        ...extensions.map(ext => join(resolved, `index${ext}`)),
    ]
    return candidates.find(c => knownPaths.has(c)) ?? null
}

function resolveImportTarget(
    file: SourceFile,
    specifier: string,
    knownPaths: ReadonlySet<string>,
    packagesByNpmName: ReadonlyMap<string, PackageInfo>,
): string | null {
    if (specifier.startsWith('.')) {
        return resolveFileCandidate(join(dirname(file.absolutePath), specifier), knownPaths)
    }
    for (const [npmName, pkg] of packagesByNpmName) {
        if (specifier !== npmName && !specifier.startsWith(npmName + '/')) continue
        return resolveFileCandidate(resolveWorkspaceBasePath(pkg, specifier), knownPaths)
    }
    return null
}

async function buildImportGraphFromFiles(
    files: readonly SourceFile[],
    packages: readonly PackageInfo[],
): Promise<ImportGraph> {
    const filesByPath = new Map(files.map(f => [f.absolutePath, f]))
    const knownPaths = new Set(filesByPath.keys())
    const packagesByNpmName = new Map(packages.map(pkg => [pkg.name, pkg]))
    const dedupedEdges = new Set<string>()

    for (const file of files) {
        const text = await readFile(file.absolutePath, 'utf8')
        for (const specifier of extractImportSpecifiers(file.absolutePath, text)) {
            const toPath = resolveImportTarget(file, specifier, knownPaths, packagesByNpmName)
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

export async function buildImportGraph(packages: readonly PackageInfo[], repoRoot: string = DEFAULT_REPO_ROOT): Promise<ImportGraph> {
    const files = await scanSourceFiles(packages, repoRoot)
    return buildImportGraphFromFiles(files, packages)
}
