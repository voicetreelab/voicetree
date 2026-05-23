import {existsSync, readFileSync} from 'node:fs'
import {basename, dirname, join, relative, resolve, sep} from 'node:path'

export type ResolvedFolderType = {
    readonly typeName: string
    readonly noteFilePath: string
}

const INLINE_TYPE_PATTERN: RegExp = /^## Type:\s*(.+?)\s*$/
const HEADING_TYPE_PATTERN: RegExp = /^## Type\s*$/
const ANY_HEADING_PATTERN: RegExp = /^#{1,6}\s/

function parseTypeFromFolderNote(markdown: string): string | undefined {
    const lines: string[] = markdown.split(/\r?\n/)

    for (let lineIndex: number = 0; lineIndex < lines.length; lineIndex += 1) {
        const line: string = lines[lineIndex]

        const inlineMatch: RegExpMatchArray | null = line.match(INLINE_TYPE_PATTERN)
        if (inlineMatch) {
            const value: string = inlineMatch[1].trim()
            return value.length > 0 ? value : undefined
        }

        if (HEADING_TYPE_PATTERN.test(line)) {
            for (let nextIndex: number = lineIndex + 1; nextIndex < lines.length; nextIndex += 1) {
                const candidate: string = lines[nextIndex].trim()
                if (candidate.length === 0) continue
                if (ANY_HEADING_PATTERN.test(candidate)) return undefined
                return candidate
            }
            return undefined
        }
    }

    return undefined
}

function isWithin(child: string, ancestor: string): boolean {
    const rel: string = relative(ancestor, child)
    return rel.length === 0 || (!rel.startsWith('..') && !rel.startsWith(`..${sep}`))
}

export function resolveTypeForTarget(
    targetPath: string,
    vaultRoot: string
): ResolvedFolderType | undefined {
    const absoluteTarget: string = resolve(targetPath)
    const absoluteVault: string = resolve(vaultRoot)

    if (!isWithin(absoluteTarget, absoluteVault)) {
        return undefined
    }

    let currentDir: string = dirname(absoluteTarget)

    while (isWithin(currentDir, absoluteVault)) {
        const candidate: ResolvedFolderType | undefined = inspectFolderNote(currentDir, absoluteTarget)
        if (candidate !== undefined) return candidate

        if (currentDir === absoluteVault) break

        const parentDir: string = dirname(currentDir)
        if (parentDir === currentDir) break
        currentDir = parentDir
    }

    return undefined
}

function inspectFolderNote(folderDir: string, absoluteTarget: string): ResolvedFolderType | undefined {
    // VT's folder-note convention prefers `<folder>/index.md`, falling back to
    // `<folder>/<basename>.md`. We mirror that order so this resolver stays in
    // sync with `getFolderNotePath` in graph-model.
    const candidates: readonly string[] = [
        join(folderDir, 'index.md'),
        join(folderDir, `${basename(folderDir)}.md`),
    ]

    for (const candidatePath of candidates) {
        if (candidatePath === absoluteTarget) continue
        if (!existsSync(candidatePath)) continue

        try {
            const markdown: string = readFileSync(candidatePath, 'utf8')
            const typeName: string | undefined = parseTypeFromFolderNote(markdown)
            if (typeName !== undefined) {
                return {typeName, noteFilePath: candidatePath}
            }
            // The folder note exists but does not declare a type; stop checking
            // this folder so we don't pick up a stale fallback from a different
            // convention in the same directory.
            return undefined
        } catch {
            // Unreadable folder note — fall through to the next candidate.
        }
    }

    return undefined
}
