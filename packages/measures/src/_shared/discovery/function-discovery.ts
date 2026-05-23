import {readdir, stat} from 'node:fs/promises'
import {join, relative, resolve} from 'node:path'
import {DEFAULT_REPO_ROOT, type PackageInfo} from './discover-packages'

export type SourceFileInfo = {
    readonly absolutePath: string
    readonly relativePath: string
    readonly packageName: string
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await stat(path)
        return true
    } catch {
        return false
    }
}

function isProductionSource(path: string): boolean {
    return path.endsWith('.ts')
        && !path.endsWith('/__audit_seed__.ts')
        && !path.endsWith('.test.ts')
        && !path.endsWith('.spec.ts')
        && !path.endsWith('.d.ts')
        && !path.includes('/__tests__/')
        && !path.includes('/__generated__/')
}

async function listProductionSources(root: string): Promise<string[]> {
    if (!(await pathExists(root))) return []
    const entries = await readdir(root, {withFileTypes: true})
    const nested = await Promise.all(entries.map(async entry => {
        const path = join(root, entry.name)
        if (entry.isDirectory()) return listProductionSources(path)
        if (entry.isFile() && isProductionSource(path)) return [path]
        return []
    }))
    return nested.flat().sort()
}

export async function discoverSourceFiles(
    packages: readonly PackageInfo[],
    repoRoot: string = DEFAULT_REPO_ROOT,
): Promise<SourceFileInfo[]> {
    const nested = await Promise.all(packages.map(async pkg => {
        const files = await listProductionSources(pkg.srcRoot)
        return files.map(file => ({
            absolutePath: resolve(file),
            relativePath: relative(repoRoot, file),
            packageName: pkg.dirName,
        }))
    }))
    return nested.flat().sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}
