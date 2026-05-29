import {realpathSync, statSync, type Stats} from 'node:fs'
import {createRequire} from 'node:module'
import {join, resolve} from 'node:path'
import {getProjectDotVoicetreePath} from '@vt/paths'
import type {Validator, ValidatorMap} from './types'
import {isWithin} from './pathWithin'

type CacheEntry = {
    readonly mtimeMs: number
    readonly pluginResult: ValidatorMap | undefined
}

// Plugin file is CJS to allow it to be loaded synchronously via createRequire
// from Node's native loader, bypassing any bundler/transformer in the toolchain
// (Vite/vitest's loader doesn't support dynamic `import()` of files outside its
// module graph). Plugin authors write `module.exports = { typeName: { validate }}`.
const SCHEMAS_FILENAME: string = 'schemas.cjs'

const requireFromHere: NodeJS.Require = createRequire(import.meta.url)

const cacheByProjectRoot: Map<string, CacheEntry> = new Map<string, CacheEntry>()

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
    cacheByProjectRoot.clear()
}

export async function loadSchemaPlugin(projectRoot: string): Promise<ValidatorMap | undefined> {
    const absoluteProject: string = resolve(projectRoot)
    const schemasPath: string = join(getProjectDotVoicetreePath(absoluteProject), SCHEMAS_FILENAME)

    const stats: Stats | undefined = statSafely(schemasPath)
    if (stats === undefined || !stats.isFile()) {
        cacheByProjectRoot.delete(absoluteProject)
        return undefined
    }

    const realSchemasPath: string = realpathSync(schemasPath)
    if (!isWithin(realSchemasPath, absoluteProject)) {
        throw new Error(
            `Refusing to load schema plugin from outside project: ${realSchemasPath} is not within ${absoluteProject}`
        )
    }

    const cached: CacheEntry | undefined = cacheByProjectRoot.get(absoluteProject)
    if (cached && cached.mtimeMs === stats.mtimeMs) {
        return cached.pluginResult
    }

    // Drop the module from Node's require cache to honor mtime-driven reloads.
    delete requireFromHere.cache[realSchemasPath]
    const exported: unknown = requireFromHere(realSchemasPath)

    const pluginResult: ValidatorMap | undefined = isValidatorMap(exported) ? exported : undefined
    cacheByProjectRoot.set(absoluteProject, {mtimeMs: stats.mtimeMs, pluginResult})
    return pluginResult
}

export type {Validator, ValidatorMap}
