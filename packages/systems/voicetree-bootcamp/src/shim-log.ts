/**
 * Pure parsing for the PATH-shim JSONL log. No file I/O — the runner reads
 * the file and passes content here.
 */
import type {ShimLogEntry} from './types.ts'

/**
 * Parse the raw JSONL contents of a shim log file. Malformed lines are
 * silently skipped (the shim writes line-at-a-time, so a partial write at
 * process death produces one bad trailing line).
 */
export function parseShimLog(raw: string): readonly ShimLogEntry[] {
    const entries: ShimLogEntry[] = []
    for (const line of raw.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        const parsed = tryParseEntry(trimmed)
        if (parsed) entries.push(parsed)
    }
    return entries
}

/**
 * Test whether a shim log entry matches a CLI surface pattern. `verb` is
 * matched as a contiguous subsequence anywhere in argv. So "graph create"
 * matches `vt graph create --foo bar` and also `vt --port 4001 graph create`,
 * but not `vt graph --foo create` (verb words must be adjacent).
 *
 * False matches on flag values (e.g. `--label create rename` looking like
 * "create rename") are theoretically possible but vanishingly rare on the
 * real vt surface, where flag values are rarely also command verbs.
 */
export function matchesVerb(entry: ShimLogEntry, verb: string): boolean {
    const verbWords = verb.split(/\s+/).filter((w) => w.length > 0)
    if (verbWords.length === 0) return false
    if (entry.argv.length < verbWords.length) return false

    const maxStart = entry.argv.length - verbWords.length
    for (let start = 0; start <= maxStart; start++) {
        let matched = true
        for (let i = 0; i < verbWords.length; i++) {
            if (entry.argv[start + i] !== verbWords[i]) {
                matched = false
                break
            }
        }
        if (matched) return true
    }
    return false
}

function tryParseEntry(line: string): ShimLogEntry | undefined {
    try {
        const obj: unknown = JSON.parse(line)
        if (!isShimLogEntry(obj)) return undefined
        return obj
    } catch {
        return undefined
    }
}

function isShimLogEntry(value: unknown): value is ShimLogEntry {
    if (typeof value !== 'object' || value === null) return false
    const v = value as Record<string, unknown>
    return (
        typeof v.timestampMs === 'number' &&
        Array.isArray(v.argv) &&
        v.argv.every((a) => typeof a === 'string') &&
        typeof v.cwd === 'string' &&
        typeof v.exitCode === 'number' &&
        typeof v.stderr === 'string' &&
        typeof v.durationMs === 'number'
    )
}
