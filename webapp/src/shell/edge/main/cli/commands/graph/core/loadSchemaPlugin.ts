import {realpathSync, statSync, type Stats} from 'node:fs'
import {createRequire} from 'node:module'
import {join, relative, resolve, sep} from 'node:path'
import type {Validator, ValidatorMap} from './types'

type CacheEntry = {
    readonly mtimeMs: number
    readonly pluginResult: ValidatorMap | undefined
}

// Plugin file is CJS to allow it to be loaded synchronously via createRequire
// from Node's native loader, bypassing any bundler/transformer in the toolchain
// (Vite/vitest's loader doesn't support dynamic `import()` of files outside its
// module graph). Plugin authors write `module.exports = { typeName: { validate }}`.
const SCHEMAS_FILENAME: string = 'schemas.cjs'
const VOICETREE_DIRNAME: string = '.voicetree'

const requireFromHere: NodeJS.Require = createRequire(import.meta.url)

const cacheByVaultRoot: Map<string, CacheEntry> = new Map<string, CacheEntry>()

function isWithin(child: string, ancestor: string): boolean {
    const rel: string = relative(ancestor, child)
    return rel.length === 0 || (!rel.startsWith('..') && !rel.startsWith(`..${sep}`))
}

function statSafely(targetPath: string): Stats | undefined {
    try {
        return statSync(targetPath)
    } catch {
        return undefined
    }
}

function isValidatorMap(candidate: unknown): candidate is ValidatorMap {
    if (candidate === null || typeof candidate !== 'object') return false

    for (const value of Object.values(candidate as Record<string, unknown>)) {
        if (value === null || typeof value !== 'object') return false
        const validateFn: unknown = (value as Record<string, unknown>).validate
        if (typeof validateFn !== 'function') return false
    }

    return true
}

export function clearLoadSchemaPluginCacheForTest(): void {
    cacheByVaultRoot.clear()
}

export async function loadSchemaPlugin(vaultRoot: string): Promise<ValidatorMap | undefined> {
    const absoluteVault: string = resolve(vaultRoot)
    const schemasPath: string = join(absoluteVault, VOICETREE_DIRNAME, SCHEMAS_FILENAME)

    const stats: Stats | undefined = statSafely(schemasPath)
    if (stats === undefined || !stats.isFile()) {
        cacheByVaultRoot.delete(absoluteVault)
        return undefined
    }

    const realSchemasPath: string = realpathSync(schemasPath)
    if (!isWithin(realSchemasPath, absoluteVault)) {
        throw new Error(
            `Refusing to load schema plugin from outside vault: ${realSchemasPath} is not within ${absoluteVault}`
        )
    }

    const cached: CacheEntry | undefined = cacheByVaultRoot.get(absoluteVault)
    if (cached && cached.mtimeMs === stats.mtimeMs) {
        return cached.pluginResult
    }

    // Drop the module from Node's require cache to honor mtime-driven reloads.
    delete requireFromHere.cache[realSchemasPath]
    const exported: unknown = requireFromHere(realSchemasPath)

    const pluginResult: ValidatorMap | undefined = isValidatorMap(exported) ? exported : undefined
    cacheByVaultRoot.set(absoluteVault, {mtimeMs: stats.mtimeMs, pluginResult})
    return pluginResult
}

export type {Validator, ValidatorMap}
