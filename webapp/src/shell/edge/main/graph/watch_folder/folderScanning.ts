import { promises as fs } from 'fs'
import type { Dirent, Stats } from 'fs'
import path from 'path'
import normalizePath from 'normalize-path'
import type { AbsolutePath } from '@vt/graph-model/folders'
import { toAbsolutePath } from '@vt/graph-model/folders'
import type { DirectoryEntry } from '@vt/graph-model/folders'

const IGNORED_DIRS: ReadonlySet<string> = new Set([
    'node_modules', '.git', '.next', 'dist', '.cache', '__pycache__',
    '.tox', '.venv', 'venv',
    // TODO: drop once migrate-worktrees-to-sibling.sh has run and .worktrees/ is empty.
    '.worktrees',
])

export async function isValidSubdirectory(
    projectRoot: string,
    targetPath: string,
): Promise<boolean> {
    try {
        const realProjectRoot: string = await fs.realpath(projectRoot)
        const realTargetPath: string = await fs.realpath(targetPath)
        if (!realTargetPath.startsWith(realProjectRoot + '/') && realTargetPath !== realProjectRoot) {
            return false
        }
        const stat: Stats = await fs.stat(realTargetPath)
        return stat.isDirectory()
    } catch {
        return false
    }
}

export async function getSubfoldersWithModifiedAt(
    projectRoot: AbsolutePath,
): Promise<readonly { path: AbsolutePath; modifiedAt: number }[]> {
    const results: { path: AbsolutePath; modifiedAt: number }[] = []

    try {
        const rootStat: Stats = await fs.stat(projectRoot)
        results.push({ path: projectRoot, modifiedAt: rootStat.mtime.getTime() })

        const entries: Dirent[] = await fs.readdir(projectRoot, { withFileTypes: true })
        for (const entry of entries) {
            if (!entry.isDirectory() || entry.name.startsWith('.')) {
                continue
            }
            const fullPath: string = normalizePath(path.join(projectRoot, entry.name))
            try {
                const stat: Stats = await fs.stat(fullPath)
                results.push({
                    path: toAbsolutePath(fullPath),
                    modifiedAt: stat.mtime.getTime(),
                })
            } catch {
                // Skip folders we cannot stat.
            }
        }

        results.sort((a, b) => b.modifiedAt - a.modifiedAt)
        return results
    } catch {
        return []
    }
}

export async function getDirectoryTree(
    rootPath: string,
    maxDepth: number = 10,
): Promise<DirectoryEntry> {
    async function scan(dirPath: string, depth: number): Promise<DirectoryEntry> {
        const dirName: string = path.basename(dirPath)
        const absDirPath: AbsolutePath = toAbsolutePath(normalizePath(dirPath))
        const children: DirectoryEntry[] = []

        if (depth < maxDepth) {
            try {
                const entries: Dirent[] = await fs.readdir(dirPath, { withFileTypes: true })
                for (const entry of entries) {
                    if (entry.name.startsWith('.')) {
                        continue
                    }

                    const fullPath: string = normalizePath(path.join(dirPath, entry.name))
                    const absPath: AbsolutePath = toAbsolutePath(fullPath)

                    if (entry.isDirectory()) {
                        if (IGNORED_DIRS.has(entry.name)) {
                            continue
                        }
                        children.push(await scan(fullPath, depth + 1))
                    } else {
                        children.push({
                            absolutePath: absPath,
                            name: entry.name,
                            isDirectory: false,
                        })
                    }
                }
            } catch {
                // Permission denied or path gone; return an empty directory entry.
            }
        }

        children.sort((left, right) => {
            if (left.isDirectory !== right.isDirectory) {
                return left.isDirectory ? -1 : 1
            }
            return left.name.localeCompare(right.name)
        })

        return {
            absolutePath: absDirPath,
            name: dirName,
            isDirectory: true,
            children,
        }
    }

    return scan(rootPath, 0)
}
