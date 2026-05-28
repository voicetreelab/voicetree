import {existsSync, mkdirSync, readdirSync, renameSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'

import {getRecoveryMetadataDir} from './paths'

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

function moveOne(legacyDir: string, canonicalDir: string, jsonEntry: string): void {
    renameSync(join(legacyDir, jsonEntry), join(canonicalDir, jsonEntry))
    for (const sibling of siblingNamesFor(jsonEntry)) {
        const legacySibling: string = join(legacyDir, sibling)
        if (!existsSync(legacySibling)) continue
        try {
            renameSync(legacySibling, join(canonicalDir, sibling))
        } catch {
            // best-effort sibling move; absence is non-fatal per spec
        }
    }
}

function writeMigratedStub(legacyDir: string, canonicalDir: string): void {
    try {
        writeFileSync(
            join(legacyDir, MIGRATED_STUB_NAME),
            `Recovery metadata moved to ${canonicalDir}.\nWriters now use <projectRoot>/.voicetree/terminals/ exclusively.\n`,
        )
    } catch {
        // best-effort: failure to write the stub never blocks the migration
    }
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
export function migrateLegacyTerminalDir(args: MigrateLegacyTerminalDirArgs): MigrateLegacyTerminalDirResult {
    const moved: string[] = []
    const conflicts: string[] = []
    const skipped: string[] = []

    if (args.writeFolder === args.projectRoot) return {moved, conflicts, skipped}

    const legacyDir: string = getRecoveryMetadataDir(args.writeFolder)
    const canonicalDir: string = getRecoveryMetadataDir(args.projectRoot)

    if (!existsSync(legacyDir)) return {moved, conflicts, skipped}

    let entries: readonly string[]
    try {
        entries = readdirSync(legacyDir).filter((entry: string) => entry.endsWith('.json'))
    } catch {
        return {moved, conflicts, skipped}
    }

    if (entries.length === 0) return {moved, conflicts, skipped}

    mkdirSync(canonicalDir, {recursive: true})

    for (const entry of entries) {
        const canonicalTarget: string = join(canonicalDir, entry)
        if (existsSync(canonicalTarget)) {
            conflicts.push(entry)
            args.logger?.warn?.(
                `[migrate-legacy-terminal-dir] Conflict for ${entry}: canonical copy at ${canonicalTarget} kept; legacy copy at ${legacyDir} left in place.`,
            )
            continue
        }
        try {
            moveOne(legacyDir, canonicalDir, entry)
            moved.push(entry)
        } catch {
            skipped.push(entry)
        }
    }

    if (moved.length > 0) writeMigratedStub(legacyDir, canonicalDir)

    return {moved, conflicts, skipped}
}
