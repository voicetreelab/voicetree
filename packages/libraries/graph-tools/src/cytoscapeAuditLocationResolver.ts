import {readFileSync} from 'fs'
import path from 'path'

import type {LocationLookup} from './cytoscapeSurfaceEntries'

export type AuditLocation = {
    readonly relativePath: string
    readonly absolutePath: string
    readonly lineNumber: number
    readonly snippet: string
}

const COMMENT_ONLY_RATCHET_PATTERN: RegExp = /^\/\/\s*(cy|this\.cy)\./

export function trimSnippet(snippet: string, maxLength: number = 140): string {
    const trimmed: string = snippet.trim()
    if (trimmed.length <= maxLength) {
        return trimmed
    }
    return `${trimmed.slice(0, maxLength - 3)}...`
}

export function splitLines(content: string): readonly string[] {
    return content.split(/\r?\n/)
}

export function collectTextMatches(
    repoRoot: string,
    relativePath: string,
    pattern: RegExp,
    options: {
        readonly skipBlockComments?: boolean
    } = {},
): readonly AuditLocation[] {
    const absolutePath: string = path.join(repoRoot, relativePath)
    const lines: readonly string[] = splitLines(readFileSync(absolutePath, 'utf-8'))
    const matches: AuditLocation[] = []
    let inBlockComment: boolean = false
    for (let index: number = 0; index < lines.length; index += 1) {
        const line: string = lines[index]
        const trimmed: string = line.trim()

        if (options.skipBlockComments === true) {
            if (inBlockComment) {
                if (trimmed.includes('*/')) {
                    inBlockComment = false
                }
                continue
            }
            if (trimmed.startsWith('/*')) {
                if (!trimmed.includes('*/')) {
                    inBlockComment = true
                }
                continue
            }
        }

        if (
            options.skipBlockComments === true
            && trimmed.startsWith('//')
            && COMMENT_ONLY_RATCHET_PATTERN.test(trimmed) === false
        ) {
            continue
        }

        pattern.lastIndex = 0
        if (!pattern.test(line)) {
            continue
        }

        matches.push({
            relativePath,
            absolutePath,
            lineNumber: index + 1,
            snippet: trimSnippet(line),
        })
    }
    return matches
}

export function resolveLocation(repoRoot: string, lookup: LocationLookup): AuditLocation {
    const absolutePath: string = path.join(repoRoot, lookup.relativePath)
    const lines: readonly string[] = splitLines(readFileSync(absolutePath, 'utf-8'))
    const targetOccurrence: number = lookup.occurrence ?? 1
    let currentOccurrence: number = 0
    for (let index: number = 0; index < lines.length; index += 1) {
        if (!lines[index].includes(lookup.contains)) {
            continue
        }
        currentOccurrence += 1
        if (currentOccurrence !== targetOccurrence) {
            continue
        }
        return {
            relativePath: lookup.relativePath,
            absolutePath,
            lineNumber: index + 1,
            snippet: trimSnippet(lines[index]),
        }
    }
    throw new Error(`Could not resolve ${lookup.relativePath} containing "${lookup.contains}"`)
}

export function sortLocations(locations: readonly AuditLocation[]): readonly AuditLocation[] {
    return [...locations].sort((left: AuditLocation, right: AuditLocation) => {
        const pathCompare: number = left.relativePath.localeCompare(right.relativePath)
        if (pathCompare !== 0) {
            return pathCompare
        }
        return left.lineNumber - right.lineNumber
    })
}
