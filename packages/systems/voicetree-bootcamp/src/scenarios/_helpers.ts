/**
 * Shared fixture + post-state helpers for the B1–B6 scenario modules.
 *
 * All functions are deliberately small and pure-or-near-pure: fixture writers
 * touch the filesystem (shell), parsers/scanners do not.
 */
import {promises as fs} from 'node:fs'
import * as path from 'node:path'
import {getProjectDotVoicetreePath} from '@vt/paths'
import type {ShimLogEntry} from '../types.ts'
import {parseShimLog} from '../shim-log.ts'

export async function writeFile(filePath: string, content: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), {recursive: true})
    await fs.writeFile(filePath, content, 'utf8')
}

export async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.stat(filePath)
        return true
    } catch {
        return false
    }
}

export async function listMarkdownFiles(dir: string): Promise<readonly string[]> {
    const out: string[] = []
    await walk(dir, out)
    return out.filter((p) => p.endsWith('.md'))
}

async function walk(dir: string, out: string[]): Promise<void> {
    let entries: import('node:fs').Dirent[]
    try {
        entries = await fs.readdir(dir, {withFileTypes: true})
    } catch {
        return
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
            await walk(full, out)
        } else if (entry.isFile()) {
            out.push(full)
        }
    }
}

/**
 * Extract `[[wikilink]]` targets from a markdown body. Anchor (`#section`)
 * and alias (`|label`) suffixes are stripped; the basename only is returned.
 */
export function parseWikilinks(body: string): readonly string[] {
    const out: string[] = []
    const re = /\[\[([^\]\n]+)\]\]/g
    let match: RegExpExecArray | null
    while ((match = re.exec(body)) !== null) {
        const raw = match[1]
        const noAlias = raw.split('|')[0]
        const noAnchor = noAlias.split('#')[0]
        const trimmed = noAnchor.trim()
        if (trimmed.length > 0) out.push(trimmed)
    }
    return out
}

/**
 * Parse a YAML-ish frontmatter block at the top of a markdown file. Returns
 * an empty record if no frontmatter is present. Only string/number scalars
 * and one level of `- value` arrays are recognised — sufficient for the
 * frontmatter shapes we write in fixtures and read back in successCriteria.
 */
export function parseFrontmatter(raw: string): Readonly<Record<string, string | readonly string[]>> {
    const lines = raw.split('\n')
    if (lines[0] !== '---') return {}
    const end = lines.indexOf('---', 1)
    if (end < 0) return {}
    const out: Record<string, string | string[]> = {}
    let currentKey: string | undefined
    for (let i = 1; i < end; i++) {
        const line = lines[i]
        const listMatch = line.match(/^\s*-\s+(.*)$/)
        if (listMatch && currentKey !== undefined) {
            const existing = out[currentKey]
            const arr = Array.isArray(existing) ? existing : []
            arr.push(unquote(listMatch[1].trim()))
            out[currentKey] = arr
            continue
        }
        const kvMatch = line.match(/^([A-Za-z0-9_]+)\s*:\s*(.*)$/)
        if (kvMatch) {
            const key = kvMatch[1]
            const valueRaw = kvMatch[2].trim()
            currentKey = key
            if (valueRaw === '') {
                out[key] = []
            } else {
                out[key] = unquote(valueRaw)
            }
        }
    }
    return out
}

function unquote(s: string): string {
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
        return s.slice(1, -1)
    }
    return s
}

/**
 * Extract the markdown body after the frontmatter block. If no frontmatter is
 * present, the full input is returned.
 */
export function stripFrontmatter(raw: string): string {
    const lines = raw.split('\n')
    if (lines[0] !== '---') return raw
    const end = lines.indexOf('---', 1)
    if (end < 0) return raw
    return lines.slice(end + 1).join('\n')
}

/**
 * Strip a trailing `.md` extension from a wikilink target or filename, so
 * `[[Foo]]` and `[[Foo.md]]` both resolve to the same node basename.
 */
export function stripMdExt(s: string): string {
    return s.endsWith('.md') ? s.slice(0, -3) : s
}

/**
 * Read and parse the PATH-shim JSONL log for a vault. The shim path is the
 * `VT_BOOTCAMP_SHIM_LOG_PATH` override or `<vaultDir>/.voicetree/shim-log.jsonl`.
 * Returns an empty list if the file is absent/unreadable.
 */
export async function loadShimLog(vaultDir: string): Promise<readonly ShimLogEntry[]> {
    const shimLogPath = process.env.VT_BOOTCAMP_SHIM_LOG_PATH
        ?? path.join(getProjectDotVoicetreePath(vaultDir), 'shim-log.jsonl')
    try {
        const raw = await fs.readFile(shimLogPath, 'utf8')
        return parseShimLog(raw)
    } catch {
        return []
    }
}

/**
 * Daemon-handle sidecar persistence for B5: the `setup` hook spawns the
 * daemon and writes the pid here; `teardown` reads it and kills the process.
 * Sidecar lives inside the vault so a single vaultDir argument carries the
 * full lifecycle state.
 */
export type DaemonHandle = {
    readonly pid: number
    readonly port: number
}

const DAEMON_SIDECAR_FILENAME = '.bootcamp-daemon.json'

export async function writeDaemonHandle(vaultDir: string, handle: DaemonHandle): Promise<void> {
    await writeFile(path.join(vaultDir, DAEMON_SIDECAR_FILENAME), JSON.stringify(handle))
}

export async function readDaemonHandle(vaultDir: string): Promise<DaemonHandle | undefined> {
    try {
        const raw = await fs.readFile(path.join(vaultDir, DAEMON_SIDECAR_FILENAME), 'utf8')
        const parsed: unknown = JSON.parse(raw)
        if (
            typeof parsed === 'object' &&
            parsed !== null &&
            typeof (parsed as DaemonHandle).pid === 'number' &&
            typeof (parsed as DaemonHandle).port === 'number'
        ) {
            return parsed as DaemonHandle
        }
        return undefined
    } catch {
        return undefined
    }
}

export async function removeDaemonHandle(vaultDir: string): Promise<void> {
    try {
        await fs.unlink(path.join(vaultDir, DAEMON_SIDECAR_FILENAME))
    } catch {
        /* best-effort */
    }
}
