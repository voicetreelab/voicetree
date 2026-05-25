import {readFile} from 'node:fs/promises'
import {dirname, join, relative, resolve} from 'node:path'
import * as ts from 'typescript'
import type {PackageInfo} from '../../../_shared/discovery/discover-packages'
import {discoverSourceFiles} from '../../../_shared/discovery/function-discovery'
import {REPO_ROOT} from './repo-root.test'
import type {GraphEdge, SystemFile, SystemGraph} from './types.test'

function subdirectoryOf(absolutePath: string, srcRoot: string): string {
    const srcRelative = relative(srcRoot, absolutePath)
    const firstSlash = srcRelative.indexOf('/')
    return firstSlash >= 0 ? srcRelative.slice(0, firstSlash) : '.'
}

async function materializeSystemFiles(packages: readonly PackageInfo[]): Promise<SystemFile[]> {
    const nested = await Promise.all(packages.map(async pkg => {
        const sourceFiles = await discoverSourceFiles([pkg], REPO_ROOT)
        return sourceFiles.map(sf => ({
            absolutePath: sf.absolutePath,
            relativePath: sf.relativePath,
            packageName: sf.packageName,
            npmName: pkg.name,
            subdirectory: subdirectoryOf(sf.absolutePath, pkg.srcRoot),
        }))
    }))
    return nested.flat()
}

function extractImportDeclarations(filePath: string, text: string): {specifier: string; isTypeOnly: boolean; text: string}[] {
    const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true)
    const declarations: {specifier: string; isTypeOnly: boolean; text: string}[] = []

    for (const statement of sourceFile.statements) {
        if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
            declarations.push({
                specifier: statement.moduleSpecifier.text,
                isTypeOnly: statement.importClause?.isTypeOnly ?? false,
                text: statement.getText(sourceFile),
            })
        }
        if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
            declarations.push({
                specifier: statement.moduleSpecifier.text,
                isTypeOnly: statement.isTypeOnly,
                text: statement.getText(sourceFile),
            })
        }
    }

    return declarations
}

function resolveFileCandidate(basePath: string, knownFiles: ReadonlySet<string>): string | null {
    const resolved = resolve(basePath)
    const candidates = resolved.endsWith('.ts')
        ? [resolved]
        : [resolved, `${resolved}.ts`, join(resolved, 'index.ts')]
    return candidates.find(candidate => knownFiles.has(candidate)) ?? null
}

function resolveSpecifier(
    fromAbsPath: string,
    specifier: string,
    packagesByNpmName: ReadonlyMap<string, PackageInfo>,
    knownFiles: ReadonlySet<string>,
): string | null {
    if (specifier.startsWith('.')) return resolveFileCandidate(join(dirname(fromAbsPath), specifier), knownFiles)

    for (const [npmName, pkg] of packagesByNpmName) {
        if (specifier !== npmName && !specifier.startsWith(`${npmName}/`)) continue
        const subPath = specifier === npmName ? 'index' : specifier.slice(npmName.length + 1)
        return resolveFileCandidate(join(pkg.srcRoot, subPath), knownFiles)
    }

    return null
}

function collectRuntimeSymbols(declaration: {isTypeOnly: boolean; text: string}): string[] {
    if (declaration.isTypeOnly) return []
    const match = declaration.text.match(/(?:import|export)\s*(?:type\s*)?\{([^}]*)\}/)
    if (!match) return declaration.text.includes('* as ') ? ['*'] : []

    return match[1]
        .split(',')
        .map(part => part.trim())
        .filter(Boolean)
        .filter(part => !part.startsWith('type '))
        .map(part => part.split(/\s+as\s+/)[0].trim())
        .filter(Boolean)
}

export async function buildSystemGraph(packages: readonly PackageInfo[]): Promise<SystemGraph> {
    const materialized = await materializeSystemFiles(packages)
    const filesByPkg = new Map<string, SystemFile[]>()
    for (const file of materialized) {
        const bucket = filesByPkg.get(file.packageName) ?? []
        bucket.push(file)
        filesByPkg.set(file.packageName, bucket)
    }
    const files: SystemFile[] = packages.flatMap(pkg => {
        const bucket = filesByPkg.get(pkg.dirName) ?? []
        return [...bucket].sort((a, b) => a.absolutePath < b.absolutePath ? -1 : a.absolutePath > b.absolutePath ? 1 : 0)
    })

    const filesByPath = new Map(files.map(file => [file.absolutePath, file]))
    const knownFiles = new Set(filesByPath.keys())
    const packagesByNpmName = new Map(packages.map(pkg => [pkg.name, pkg]))
    const edges: GraphEdge[] = []
    const runtimeSymbolsByTarget = new Map<string, Map<string, Set<string>>>()
    const seenFileEdges = new Set<string>()

    for (const fromFile of files) {
        const text = await readFile(fromFile.absolutePath, 'utf8')
        for (const declaration of extractImportDeclarations(fromFile.absolutePath, text)) {
            const toPath = resolveSpecifier(fromFile.absolutePath, declaration.specifier, packagesByNpmName, knownFiles)
            const toFile = toPath ? filesByPath.get(toPath) : null
            if (toFile && toFile.absolutePath !== fromFile.absolutePath) {
                const edgeKey = `${fromFile.relativePath}\0${toFile.relativePath}`
                if (!seenFileEdges.has(edgeKey)) {
                    seenFileEdges.add(edgeKey)
                    edges.push({
                        from: fromFile.relativePath,
                        to: toFile.relativePath,
                        fromPackage: fromFile.packageName,
                        toPackage: toFile.packageName,
                        fromSubdirectory: fromFile.subdirectory,
                        toSubdirectory: toFile.subdirectory,
                    })
                }
            }

            const targetPkg = packages.find(pkg => declaration.specifier === pkg.name || declaration.specifier.startsWith(`${pkg.name}/`))
            if (!targetPkg || targetPkg.dirName === fromFile.packageName) continue
            const targetSymbols = runtimeSymbolsByTarget.get(targetPkg.dirName) ?? new Map<string, Set<string>>()
            runtimeSymbolsByTarget.set(targetPkg.dirName, targetSymbols)
            for (const symbol of collectRuntimeSymbols(declaration)) {
                const filesForSymbol = targetSymbols.get(symbol) ?? new Set<string>()
                filesForSymbol.add(fromFile.relativePath)
                targetSymbols.set(symbol, filesForSymbol)
            }
        }
    }

    return {files, edges, runtimeSymbolsByTarget}
}
