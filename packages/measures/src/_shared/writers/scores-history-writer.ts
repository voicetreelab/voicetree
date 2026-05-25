/**
 * Git-tracked append-only history of measure scores.
 *
 * Every time a health metric or CI check is recorded, we append a single row
 * to `health-dashboard/reports/scores-history.csv` so a regression can be
 * blamed on a specific commit. The CSV uses `merge=union` (.gitattributes) so
 * two branches appending rows do not conflict on rebase / cherry-pick.
 *
 * Schema:
 *
 *   commit,measure,score
 *   29d57290,hypergraph-bci,50.60
 *   29d57290,check/npm-test,135282
 *   working-tree,hypergraph-bci,50.67
 *
 * The CSV is intentionally schemaless beyond `(commit, measure, score)` so it
 * stays append-friendly under union merge — adding columns would break that.
 *
 * Concurrency: many test workers can append to this file in parallel. We rely
 * on POSIX `O_APPEND` atomicity for sub-PIPE_BUF writes (each row is well
 * below 4KB) so rows never interleave.
 */
import {appendFile, stat} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const CI_REPORTING_SRC_ROOT: string = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT: string = resolve(CI_REPORTING_SRC_ROOT, '..', '..', '..', '..', '..')
const SCORES_HISTORY_PATH: string = join(REPO_ROOT, 'health-dashboard', 'reports', 'scores-history.csv')

const CSV_HEADER = 'commit,measure,score\n'

function resolveCommitSha(): string {
    try {
        return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
            cwd: REPO_ROOT,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim() || 'working-tree'
    } catch {
        return 'working-tree'
    }
}

// Resolved once per process. The CSV captures *which commit observed the
// score*, not which commit produced it — for working-tree runs the SHA does
// not change mid-process, so caching is safe and avoids a fork per metric.
const COMMIT_SHA: string = resolveCommitSha()

function escapeCsvField(value: string): string {
    if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
    return value
}

function formatScore(score: number): string {
    if (!Number.isFinite(score)) return ''
    // Preserve precision but strip trailing zeros that JSON.stringify keeps.
    // Integers stay integers; floats keep up to ~15 significant digits.
    if (Number.isInteger(score)) return score.toString()
    return score.toString()
}

async function ensureHeader(): Promise<void> {
    try {
        const stats = await stat(SCORES_HISTORY_PATH)
        if (stats.size > 0) return
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
    // File is missing or empty — write the header. If two writers race here,
    // the worst case is a duplicate header row which any reader can filter.
    await appendFile(SCORES_HISTORY_PATH, CSV_HEADER, 'utf8')
}

export async function appendScore(input: {readonly measure: string; readonly score: number}): Promise<void> {
    if (!Number.isFinite(input.score)) return
    await ensureHeader()
    const row = `${escapeCsvField(COMMIT_SHA)},${escapeCsvField(input.measure)},${formatScore(input.score)}\n`
    await appendFile(SCORES_HISTORY_PATH, row, 'utf8')
}
