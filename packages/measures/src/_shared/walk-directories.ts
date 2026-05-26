import {readdir} from 'node:fs/promises'
import {join} from 'node:path'

type WalkDirectoryEntryKind = 'directory' | 'file' | 'other'

type WalkDirectoryEntry = {
    readonly name: string
    readonly absolutePath: string
    readonly kind: WalkDirectoryEntryKind
}

type WalkedDirectory = {
    readonly absolutePath: string
    readonly entries: readonly WalkDirectoryEntry[]
}

type WalkDirectoriesOptions = {
    readonly includeEntry?: (entry: WalkDirectoryEntry) => boolean
}

export async function walkDirectories(
    root: string,
    options: WalkDirectoriesOptions = {},
): Promise<readonly WalkedDirectory[]> {
    const entries = (await readdir(root, {withFileTypes: true}))
        .map(entry => ({
            name: entry.name,
            absolutePath: join(root, entry.name),
            kind: walkDirectoryEntryKind(entry),
        }))
        .filter(options.includeEntry ?? (() => true))
        .sort((a, b) => a.name.localeCompare(b.name))

    const nested = await Promise.all(entries.map(entry => {
        if (entry.kind !== 'directory') return Promise.resolve([])
        return walkDirectories(entry.absolutePath, options)
    }))

    return [{absolutePath: root, entries}, ...nested.flat()]
}

function walkDirectoryEntryKind(entry: {isDirectory(): boolean; isFile(): boolean}): WalkDirectoryEntryKind {
    if (entry.isDirectory()) return 'directory'
    if (entry.isFile()) return 'file'
    return 'other'
}
