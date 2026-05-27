// Tier-0 post-edit measure: agent-instructions-sync.
//
// Conforms to the per-edit-hook contract `checkFile({filePath, content, env})
// → {message, severity?} | null`. Fires only when the agent has just
// saved one of the two top-level instruction files (CLAUDE.md or
// AGENTS.md); reads the *other* file from disk and compares bytes.
//
// Catching this on save is much faster than waiting until `git commit`:
// once the agent has updated CLAUDE.md and moved on, every later edit
// has to be discarded if AGENTS.md isn't kept in lockstep.
//
// All impure capabilities (fs / path / git) come through `env`
// (FP pattern 3 — Reader-env) so this file imports no node:fs/path/
// child_process and the impurity boundary lives in the runner. The
// pre-commit safety net for the same invariant lives in
// `packages/measures/scripts/agent-instructions-sync.mjs`; the byte
// comparison is one line in each, so each wrapper carries its own copy
// rather than crossing a community boundary.
//
// Warn-mode escalation: the measure ships in warn-only for the first
// 7 days post-merge. On WARN_MODE_UNTIL we flip the constant to false
// and start exit-2-blocking.

// Narrow Reader-env: only the impure capabilities this measure needs.
// Structurally compatible with the runner's full Env.
type Env = {
    readonly readFile: (absPath: string) => Promise<string | null>
    readonly basename: (absPath: string) => string
    readonly resolve: (...parts: readonly string[]) => string
    readonly gitToplevel: () => string | null
}

// Flip to false on or after WARN_MODE_UNTIL to escalate from warn to block.
// First merged: 2026-05-27; escalate: 2026-06-03.
const WARN_MODE = true
const WARN_MODE_UNTIL = '2026-06-03'

const FILE_A = 'CLAUDE.md'
const FILE_B = 'AGENTS.md'
const PAIR_NAMES: ReadonlySet<string> = new Set([FILE_A, FILE_B])

type PostEditResult = {readonly message: string; readonly severity?: 'block' | 'warn'} | null

function resolvePairContext(args: {
    readonly filePath: string
    readonly env: Env
}): {readonly filename: string; readonly root: string} | null {
    const filename = args.env.basename(args.filePath)
    if (!PAIR_NAMES.has(filename)) return null
    const root = args.env.gitToplevel()
    if (root === null) return null
    if (args.env.resolve(args.filePath) !== args.env.resolve(root, filename)) return null
    return {filename, root}
}

async function loadOtherSide(args: {
    readonly editedName: string
    readonly root: string
    readonly env: Env
}): Promise<string | null> {
    const otherName = args.editedName === FILE_A ? FILE_B : FILE_A
    return args.env.readFile(args.env.resolve(args.root, otherName))
}

function describeMismatch(args: {readonly aLen: number; readonly bLen: number}): string {
    return [
        `${FILE_A} and ${FILE_B} differ. They must be byte-identical.`,
        `Reconcile them (e.g. \`cp ${FILE_A} ${FILE_B}\`).`,
        `  ${FILE_A}: ${args.aLen} bytes`,
        `  ${FILE_B}: ${args.bLen} bytes`,
    ].join('\n')
}

function decorate(body: string): PostEditResult {
    const bar = '═'.repeat(60)
    if (WARN_MODE) {
        const message = ['', `\x1b[0;33m${bar}\x1b[0m`,
            `\x1b[0;33m⚠ AGENT-INSTRUCTIONS-SYNC WARNING (warn-mode until ${WARN_MODE_UNTIL})\x1b[0m`,
            `\x1b[0;33m${bar}\x1b[0m`, body, ''].join('\n')
        return {message, severity: 'warn'}
    }
    const message = ['', `\x1b[0;31m${bar}\x1b[0m`,
        `\x1b[0;31m❌ AGENT-INSTRUCTIONS-SYNC VIOLATION\x1b[0m`,
        `\x1b[0;31m${bar}\x1b[0m`, body, ''].join('\n')
    return {message}
}

export async function checkFile(args: {
    readonly filePath: string
    readonly content: string
    readonly env: Env
}): Promise<PostEditResult> {
    const ctx = resolvePairContext({filePath: args.filePath, env: args.env})
    if (ctx === null) return null
    const otherContent = await loadOtherSide({editedName: ctx.filename, root: ctx.root, env: args.env})
    if (otherContent === null) return null
    const aContent = ctx.filename === FILE_A ? args.content : otherContent
    const bContent = ctx.filename === FILE_B ? args.content : otherContent
    const aBuf = Buffer.from(aContent, 'utf8')
    const bBuf = Buffer.from(bContent, 'utf8')
    if (aBuf.equals(bBuf)) return null
    return decorate(describeMismatch({aLen: aBuf.length, bLen: bBuf.length}))
}
