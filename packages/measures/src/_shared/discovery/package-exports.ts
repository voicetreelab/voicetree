import {join} from 'node:path'
import type {ConditionalExport, PackageExports, PackageInfo} from './discover-packages'

// Picks the runtime file from a conditional-export value, preferring 'import' > 'default' > 'require'.
// The 'types' condition is intentionally ignored — .d.ts files have no runtime presence.
function pickConditional(value: ConditionalExport): string | null {
    if (typeof value === 'string') return value
    return value.import ?? value.default ?? value.require ?? null
}

function isSubpathExportsMap(
    exports: Exclude<PackageExports, string>,
): exports is {readonly [subpath: string]: ConditionalExport} {
    const keys = Object.keys(exports)
    return keys.length > 0 && keys.every(k => k.startsWith('.'))
}

// Returns the relative file path (e.g. "./src/agents/index.ts") that the package's `exports`
// declares for the given subpath, or null if the subpath is not exported.
// `subpath` is "." for the root export or "./<segment>..." for a subpath import.
export function resolveExportsSubpath(exports: PackageExports, subpath: string): string | null {
    if (typeof exports === 'string') return subpath === '.' ? exports : null
    if (!isSubpathExportsMap(exports)) {
        // Conditional-only object (no subpath keys) — treat as the value for the root export.
        return subpath === '.' ? pickConditional(exports as ConditionalExport) : null
    }
    const exact = exports[subpath]
    if (exact !== undefined) return pickConditional(exact)

    // Pattern match against "./prefix/*" keys; the longest prefix wins.
    let bestPrefixLen = -1
    let bestTarget: string | null = null
    for (const [key, value] of Object.entries(exports)) {
        if (!key.endsWith('/*')) continue
        const prefix = key.slice(0, -1) // includes trailing '/'
        if (!subpath.startsWith(prefix) || prefix.length <= bestPrefixLen) continue
        const target = pickConditional(value)
        if (target === null) continue
        const remainder = subpath.slice(prefix.length)
        bestPrefixLen = prefix.length
        bestTarget = target.includes('*') ? target.replace('*', remainder) : target
    }
    return bestTarget
}

// Resolves a workspace-package import specifier (e.g. "@vt/foo" or "@vt/foo/bar") to an absolute
// base path on disk, honoring the package's `exports` and `main` fields. The returned path is
// extension-less when it falls back to the implicit `<srcRoot>/<sub>` shape; callers should pass
// it through a file-resolution step that probes `.ts` / `index.ts` candidates.
export function resolveWorkspaceBasePath(pkg: PackageInfo, specifier: string): string {
    const isRoot = specifier === pkg.name
    const rawSubpath = isRoot ? '' : specifier.slice(pkg.name.length + 1)
    const exportKey = isRoot ? '.' : `./${rawSubpath}`

    if (pkg.exports !== undefined) {
        const target = resolveExportsSubpath(pkg.exports, exportKey)
        if (target !== null) return join(pkg.absDir, target)
    }
    if (isRoot && pkg.main !== undefined) return join(pkg.absDir, pkg.main)
    return isRoot ? join(pkg.srcRoot, 'index') : join(pkg.srcRoot, rawSubpath)
}
