import {Project, ts} from 'ts-morph'
import type {PackageInfo} from '../discovery/discover-packages'

export function createRepoTsMorphProject(repoRoot: string, packages: readonly PackageInfo[]): Project {
    return new Project({
        compilerOptions: repoTsMorphCompilerOptions(repoRoot, packages),
    })
}

function repoTsMorphCompilerOptions(repoRoot: string, packages: readonly PackageInfo[]): ts.CompilerOptions {
    return {
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        allowJs: false,
        allowImportingTsExtensions: true,
        skipLibCheck: true,
        jsx: ts.JsxEmit.Preserve,
        baseUrl: repoRoot,
        paths: workspacePackagePaths(packages),
    }
}

function workspacePackagePaths(packages: readonly PackageInfo[]): Record<string, string[]> {
    const paths: Record<string, string[]> = {}
    for (const pkg of packages) {
        addPackagePaths(paths, pkg)
    }
    return paths
}

function addPackagePaths(paths: Record<string, string[]>, pkg: PackageInfo): void {
    const relPackageDir = normalizePath(pkg.relDir)
    const mainTarget = pkg.main ?? './src/index.ts'
    addPath(paths, pkg.name, packageTarget(relPackageDir, mainTarget))

    for (const [exportKey, exportValue] of exportEntries(pkg.exports)) {
        const specifier = exportSpecifier(pkg.name, exportKey)
        if (!specifier) continue
        for (const target of exportStringTargets(exportValue)) {
            addPath(paths, specifier, packageTarget(relPackageDir, target))
        }
    }

    addPath(paths, `${pkg.name}/*`, `${relPackageDir}/src/*`)
}

function exportEntries(exportsField: unknown): readonly (readonly [string, unknown])[] {
    if (!exportsField || typeof exportsField !== 'object' || Array.isArray(exportsField)) return []
    return Object.entries(exportsField)
}

function exportSpecifier(packageName: string, exportKey: string): string | null {
    if (exportKey === '.') return packageName
    if (!exportKey.startsWith('./')) return null
    return `${packageName}/${exportKey.slice(2)}`
}

function exportStringTargets(value: unknown): readonly string[] {
    if (typeof value === 'string') return [value]
    if (Array.isArray(value)) return value.flatMap(exportStringTargets)
    if (!value || typeof value !== 'object') return []
    return Object.values(value).flatMap(exportStringTargets)
}

function packageTarget(relPackageDir: string, target: string): string | null {
    if (!target.startsWith('./')) return null
    return normalizePath(`${relPackageDir}/${target.slice(2)}`)
}

function addPath(paths: Record<string, string[]>, specifier: string, target: string | null): void {
    if (!target) return
    const targets = paths[specifier] ?? []
    if (targets.includes(target)) return
    paths[specifier] = [...targets, target]
}

function normalizePath(path: string): string {
    return path.replaceAll('\\', '/')
}
