import {existsSync, readdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs'
import {basename, dirname, join, relative, resolve} from 'node:path'
import {homedir} from 'node:os'
import {error, output} from '../output.ts'

const BRAIN = resolve(join(homedir(), 'brain'))

type RenameResult = {
    oldPath: string
    newPath: string
    dryRun: boolean
    filesScanned: number
    filesChanged: string[]
    referencesUpdated: number
    details: Array<{file: string; count: number}>
}

function findMdFiles(dir: string): string[] {
    const results: string[] = []

    function walk(currentDir: string): void {
        let entries
        try {
            entries = readdirSync(currentDir, {withFileTypes: true})
        } catch {
            return
        }

        for (const entry of entries) {
            const fullPath = join(currentDir, entry.name)
            if (fullPath.includes('/.voicetree/') || fullPath.includes('/node_modules/')) continue
            if (entry.isDirectory()) {
                walk(fullPath)
                continue
            }
            if (entry.isFile() && entry.name.endsWith('.md')) results.push(fullPath)
        }
    }

    walk(dir)
    return results
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildReferencePatterns(
    oldAbsPath: string,
    newAbsPath: string,
    vaultRoot: string
): Array<{pattern: RegExp; replacement: string}> {
    const patterns: Array<{pattern: RegExp; replacement: string}> = []

    const oldBasename = basename(oldAbsPath, '.md')
    const oldBasenameWithExt = basename(oldAbsPath)
    const newBasename = basename(newAbsPath, '.md')
    const newBasenameWithExt = basename(newAbsPath)

    const oldRelFromVault = relative(vaultRoot, oldAbsPath)
    const newRelFromVault = relative(vaultRoot, newAbsPath)

    const oldTildePath = `~/brain/${oldRelFromVault}`
    const newTildePath = `~/brain/${newRelFromVault}`

    // 1. Wikilinks with path: [[path/to/file.md]] or [[path/to/file]]
    if (oldRelFromVault.includes('/')) {
        const oldRelNoExt = oldRelFromVault.replace(/\.md$/, '')
        const newRelNoExt = newRelFromVault.replace(/\.md$/, '')

        // [[path/to/file.md]]
        patterns.push({
            pattern: new RegExp(`\\[\\[${escapeRegex(oldRelFromVault)}(\\|[^\\]]*)?\\]\\]`, 'g'),
            replacement: `[[${newRelFromVault}$1]]`,
        })
        // [[path/to/file]] (no .md)
        patterns.push({
            pattern: new RegExp(`\\[\\[${escapeRegex(oldRelNoExt)}(\\|[^\\]]*)?\\]\\]`, 'g'),
            replacement: `[[${newRelNoExt}$1]]`,
        })
    }

    // 2. Wikilinks with basename only: [[basename.md]] or [[basename]]
    //    Only replace if the basename actually changed
    if (oldBasename !== newBasename) {
        // [[basename.md|alias]]
        patterns.push({
            pattern: new RegExp(`\\[\\[${escapeRegex(oldBasenameWithExt)}(\\|[^\\]]*)?\\]\\]`, 'g'),
            replacement: `[[${newBasenameWithExt}$1]]`,
        })
        // [[basename|alias]]
        patterns.push({
            pattern: new RegExp(`\\[\\[${escapeRegex(oldBasename)}(\\|[^\\]]*)?\\]\\]`, 'g'),
            replacement: `[[${newBasename}$1]]`,
        })
    }

    // 3. Tilde paths: ~/brain/path/to/file.md
    patterns.push({
        pattern: new RegExp(escapeRegex(oldTildePath), 'g'),
        replacement: newTildePath,
    })

    // 4. Absolute paths: /Users/.../brain/path/to/file.md
    patterns.push({
        pattern: new RegExp(escapeRegex(oldAbsPath), 'g'),
        replacement: newAbsPath,
    })

    // 5. Relative paths from vault root: path/to/file.md (not inside wikilinks)
    //    Be careful: only match if it looks like a standalone path reference
    if (oldRelFromVault.includes('/')) {
        patterns.push({
            pattern: new RegExp(`(?<!\\[\\[)${escapeRegex(oldRelFromVault)}(?!.*\\]\\])`, 'g'),
            replacement: newRelFromVault,
        })
    }

    return patterns
}

function resolveFilePath(inputPath: string, vaultRoot: string): string {
    if (inputPath.startsWith('~/brain/')) {
        return join(vaultRoot, inputPath.slice('~/brain/'.length))
    }
    if (inputPath.startsWith('~/')) {
        return join(homedir(), inputPath.slice(2))
    }
    if (inputPath.startsWith('/')) {
        return inputPath
    }
    return resolve(inputPath)
}

export async function graphRename(
    _port: number,
    _terminalId: string | undefined,
    args: string[]
): Promise<void> {
    let dryRun = false
    let vaultRoot = BRAIN
    const positionals: string[] = []

    for (let i = 0; i < args.length; i++) {
        const arg = args[i]
        if (arg === '--dry-run') {
            dryRun = true
            continue
        }
        if (arg === '--vault') {
            const val = args[i + 1]
            if (!val) error('--vault requires a value')
            vaultRoot = resolve(val)
            i++
            continue
        }
        positionals.push(arg)
    }

    if (positionals.length !== 2) {
        error('Usage: vt graph rename <old-path> <new-path> [--dry-run] [--vault PATH]')
    }

    const oldAbsPath = resolveFilePath(positionals[0], vaultRoot)
    const newAbsPath = resolveFilePath(positionals[1], vaultRoot)

    if (!existsSync(oldAbsPath)) {
        error(`Old path does not exist: ${oldAbsPath}`)
    }
    if (existsSync(newAbsPath)) {
        error(`New path already exists: ${newAbsPath}`)
    }

    const newDir = dirname(newAbsPath)
    if (!existsSync(newDir)) {
        error(`Target directory does not exist: ${newDir}`)
    }

    const patterns = buildReferencePatterns(oldAbsPath, newAbsPath, vaultRoot)
    const mdFiles = findMdFiles(vaultRoot)

    const result: RenameResult = {
        oldPath: relative(vaultRoot, oldAbsPath),
        newPath: relative(vaultRoot, newAbsPath),
        dryRun,
        filesScanned: mdFiles.length,
        filesChanged: [],
        referencesUpdated: 0,
        details: [],
    }

    for (const filePath of mdFiles) {
        // Don't update references in the file being renamed itself
        if (filePath === oldAbsPath) continue

        const originalContent = readFileSync(filePath, 'utf8')
        let updatedContent = originalContent
        let fileRefCount = 0

        for (const {pattern, replacement} of patterns) {
            // Reset lastIndex for global regexes
            pattern.lastIndex = 0
            const matches = updatedContent.match(pattern)
            if (matches) {
                fileRefCount += matches.length
                updatedContent = updatedContent.replace(pattern, replacement)
            }
        }

        if (updatedContent !== originalContent) {
            result.filesChanged.push(relative(vaultRoot, filePath))
            result.referencesUpdated += fileRefCount
            result.details.push({
                file: relative(vaultRoot, filePath),
                count: fileRefCount,
            })

            if (!dryRun) {
                writeFileSync(filePath, updatedContent, 'utf8')
            }
        }
    }

    if (!dryRun) {
        renameSync(oldAbsPath, newAbsPath)
    }

    output(result, (data: unknown) => {
        const r = data as RenameResult
        const prefix = r.dryRun ? '[DRY RUN] ' : ''
        const lines: string[] = [
            `${prefix}Renamed: ${r.oldPath} -> ${r.newPath}`,
            `Scanned: ${r.filesScanned} files`,
            `Changed: ${r.filesChanged.length} files (${r.referencesUpdated} references)`,
        ]
        if (r.details.length > 0) {
            lines.push('')
            lines.push('Files updated:')
            for (const d of r.details) {
                lines.push(`  ${d.file} (${d.count} refs)`)
            }
        }
        return lines.join('\n')
    })
}
