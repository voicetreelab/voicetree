import {readFile} from 'node:fs/promises'
import * as ts from 'typescript'
import type {PackageInfo} from '../discovery/discover-packages'
import type {SourceFileInfo} from '../discovery/function-discovery'

type ImportDeclarationInfo = {
    readonly specifier: string
    readonly isTypeOnly: boolean
    readonly text: string
}

type RuntimeFanInRow = {
    readonly packageName: string
    readonly runtimeSymbols: number
    readonly top: readonly string[]
}

function extractImportDeclarations(filePath: string, text: string): ImportDeclarationInfo[] {
    const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true)
    const declarations: ImportDeclarationInfo[] = []

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

function collectRuntimeSymbols(declaration: ImportDeclarationInfo): string[] {
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

export async function buildRuntimeSymbolsByTarget(
    packages: readonly PackageInfo[],
    files: readonly SourceFileInfo[],
): Promise<Map<string, Map<string, Set<string>>>> {
    const runtimeSymbolsByTarget = new Map<string, Map<string, Set<string>>>()

    for (const fromFile of files) {
        const text = await readFile(fromFile.absolutePath, 'utf8')
        for (const declaration of extractImportDeclarations(fromFile.absolutePath, text)) {
            const targetPkg = packages.find(pkg => declaration.specifier === pkg.name || declaration.specifier.startsWith(`${pkg.name}/`))
            if (!targetPkg || targetPkg.dirName === fromFile.packageName) continue

            const targetSymbols = runtimeSymbolsByTarget.get(targetPkg.dirName) ?? new Map<string, Set<string>>()
            for (const symbol of collectRuntimeSymbols(declaration)) {
                const importers = targetSymbols.get(symbol) ?? new Set<string>()
                importers.add(fromFile.relativePath)
                targetSymbols.set(symbol, importers)
            }
            runtimeSymbolsByTarget.set(targetPkg.dirName, targetSymbols)
        }
    }

    return runtimeSymbolsByTarget
}

export function runtimeFanInRows(runtimeSymbolsByTarget: ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<string>>>): RuntimeFanInRow[] {
    return [...runtimeSymbolsByTarget.entries()].map(([packageName, symbols]) => ({
        packageName,
        runtimeSymbols: symbols.size,
        top: [...symbols.entries()]
            .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
            .slice(0, 6)
            .map(([symbol, files]) => `${symbol}(${files.size})`),
    })).sort((a, b) => b.runtimeSymbols - a.runtimeSymbols || a.packageName.localeCompare(b.packageName))
}
