import type {RecoveryEnv} from '@vt/agent-runtime/runtime/runtime-config'

import {getRecoveryMetadataDir} from '../paths'

type Logger = {
    readonly warn?: (message: string) => void
}

export type MigrateLegacyTerminalDirArgs = {
    readonly projectRoot: string
    readonly writeFolder: string
    readonly logger?: Logger
}

export type MigrateLegacyTerminalDirResult = {
    readonly moved: readonly string[]
    readonly conflicts: readonly string[]
    readonly skipped: readonly string[]
}

const SIBLING_SUFFIXES: readonly string[] = ['.log', '-prompt.txt', '.exitcode'] as const
const MIGRATED_STUB_NAME: string = 'MIGRATED.txt'

function siblingNamesFor(jsonEntry: string): readonly string[] {
    const base: string = jsonEntry.slice(0, -'.json'.length)
    return SIBLING_SUFFIXES.map((suffix: string) => `${base}${suffix}`)
}

function moveOne(env: RecoveryEnv, legacyDir: string, canonicalDir: string, jsonEntry: string): void {
    env.fs.renameSync(env.path.join(legacyDir, jsonEntry), env.path.join(canonicalDir, jsonEntry))
    for (const sibling of siblingNamesFor(jsonEntry)) {
        const legacySibling: string = env.path.join(legacyDir, sibling)
        if (!env.fs.existsSync(legacySibling)) continue
        try {
            env.fs.renameSync(legacySibling, env.path.join(canonicalDir, sibling))
        } catch {
            // best-effort sibling move; absence is non-fatal per spec
        }
    }
}

function writeMigratedStub(env: RecoveryEnv, legacyDir: string, canonicalDir: string): void {
    // env.fs.writeFileUtf8 already swallows errors per its contract; failure
    // to write the stub never blocks the migration.
    env.fs.writeFileUtf8(
        env.path.join(legacyDir, MIGRATED_STUB_NAME),
        `Recovery metadata moved to ${canonicalDir}.\nWriters now use <projectRoot>/.voicetree/terminals/ exclusively.\n`,
    )
}

/**
 * One-time, synchronous, idempotent migration of legacy
 * `<writeFolder>/.voicetree/terminals/*.json` records into the canonical
 * `<projectRoot>/.voicetree/terminals/`.
 *
 * Must be invoked from `onVaultOpened` BEFORE reconciliation runs, so the
 * reconciler sees the post-move state. No-op when `writeFolder === projectRoot`
 * or the legacy directory does not exist. Conflicts keep the canonical copy
 * and leave the legacy entry untouched.
 */
export function migrateLegacyTerminalDir(
    env: RecoveryEnv,
    args: MigrateLegacyTerminalDirArgs,
): MigrateLegacyTerminalDirResult {
    const moved: string[] = []
    const conflicts: string[] = []
    const skipped: string[] = []

    if (args.writeFolder === args.projectRoot) return {moved, conflicts, skipped}

    const legacyDir: string = getRecoveryMetadataDir(args.writeFolder)
    const canonicalDir: string = getRecoveryMetadataDir(args.projectRoot)

    if (!env.fs.existsSync(legacyDir)) return {moved, conflicts, skipped}

    let entries: readonly string[]
    try {
        entries = env.fs.readdirSync(legacyDir).filter((entry: string) => entry.endsWith('.json'))
    } catch {
        return {moved, conflicts, skipped}
    }

    if (entries.length === 0) return {moved, conflicts, skipped}

    env.fs.mkdirSync(canonicalDir, {recursive: true})

    for (const entry of entries) {
        const canonicalTarget: string = env.path.join(canonicalDir, entry)
        if (env.fs.existsSync(canonicalTarget)) {
            conflicts.push(entry)
            args.logger?.warn?.(
                `[migrate-legacy-terminal-dir] Conflict for ${entry}: canonical copy at ${canonicalTarget} kept; legacy copy at ${legacyDir} left in place.`,
            )
            continue
        }
        try {
            moveOne(env, legacyDir, canonicalDir, entry)
            moved.push(entry)
        } catch {
            skipped.push(entry)
        }
    }

    if (moved.length > 0) writeMigratedStub(env, legacyDir, canonicalDir)

    return {moved, conflicts, skipped}
}
