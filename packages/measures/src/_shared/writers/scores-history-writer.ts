/**
 * Git-tracked append-only history of measure scores.
 *
 * Every recordHealthReport / recordCheckReport appends one row to the
 * scores-history CSV so a regression can be blamed to a specific commit.
 *
 * Two sibling files, selected by working-tree cleanliness at process start:
 *
 *   scores-history.csv         tracked  | clean tree (CI, or local after commit)
 *   scores-history.local.csv   gitignored | dirty tree (mid-edit, peer-agent WIP)
 *
 * Clean-tree rows are safe to share: the row's `commit` matches the source
 * tree that was actually scored. Dirty-tree rows route to the local sibling
 * so they never contaminate the shared history with mislabelled scores.
 *
 * The tracked CSV uses `merge=union` (.gitattributes) so two branches
 * appending rows never conflict on rebase or cherry-pick.
 *
 * Schema:
 *
 *   commit,measure,score,status
 *   29d57290,hypergraph-bci,50.60,pass
 *   29d57290,check/root-lint,2642,pass
 *   c4192b93,check/blackbox-tests-lint,1332,fail
 *
 *   status ∈ {pass, fail, ''}   ('' when the measure has no pass/fail concept)
 *
 * Schema is intentionally narrow so rows stay row-independent and
 * union-merge stays safe. Skip rows emit no entry.
 *
 * Concurrency: many vitest workers append in parallel. We rely on POSIX
 * O_APPEND atomicity for sub-PIPE_BUF writes (each row is well below
 * 4KB) so rows never interleave.
 */
import {appendFile, stat} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const CI_REPORTING_SRC_ROOT: string = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT: string = resolve(CI_REPORTING_SRC_ROOT, '..', '..', '..', '..', '..')

const CSV_HEADER = 'commit,measure,score,status\n'

type RowStatus = 'pass' | 'fail' | ''

function gitOutput(args: readonly string[]): string {
    return execFileSync('git', args, {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
    })
}

function resolveCommitSha(): string {
    try {
        return gitOutput(['rev-parse', '--short', 'HEAD']).trim() || 'working-tree'
    } catch {
        return 'working-tree'
    }
}

function resolveCleanTree(): boolean {
    try {
        return gitOutput(['status', '--porcelain']).trim() === ''
    } catch {
        // No git, or git failed. Safe default: treat as dirty so we never
        // contaminate the tracked file from a non-git context.
        return false
    }
}

// Resolved once per process. Both values are stable for a typical
// measures run (one process, one repo). Caching avoids forking git
// per metric. Clean tree → tracked CSV; dirty tree → gitignored sibling.
const COMMIT_SHA: string = resolveCommitSha()
const TARGET_PATH: string = join(
    REPO_ROOT,
    'health-dashboard',
    'reports',
    resolveCleanTree() ? 'scores-history.csv' : 'scores-history.local.csv',
)

function escapeCsvField(value: string): string {
    if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
    return value
}

function formatScore(score: number): string {
    if (!Number.isFinite(score)) return ''
    return score.toString()
}

async function ensureHeader(path: string): Promise<void> {
    try {
        const stats = await stat(path)
        if (stats.size > 0) return
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
    // File missing or empty. If two writers race here the worst case is a
    // duplicate header row which any reader can filter.
    await appendFile(path, CSV_HEADER, 'utf8')
}

export async function appendScore(input: {
    readonly measure: string
    readonly score: number
    readonly status?: RowStatus
}): Promise<void> {
    if (!Number.isFinite(input.score)) return
    await ensureHeader(TARGET_PATH)
    const fields = [
        escapeCsvField(COMMIT_SHA),
        escapeCsvField(input.measure),
        formatScore(input.score),
        escapeCsvField(input.status ?? ''),
    ]
    await appendFile(TARGET_PATH, `${fields.join(',')}\n`, 'utf8')
}
