/**
 * Regression coverage for the settings-aware `createWorktree` wrapper —
 * the exact code reached by `api.main.createWorktree` (renderer IPC →
 * preload → main → api.ts → here → gitWorktreeCommands).
 *
 * WHY THIS EXISTS:
 * `createWorktree` once threw `ReferenceError: getMcpPort is not defined` on
 * EVERY call, so spawning an agent in a worktree always failed — yet the whole
 * suite was green. The crashing line lived in the api.ts *wrapper*, but:
 *   - the unit test only exercised the *core* `gitWorktreeCommands`, not the
 *     wrapper, so the broken line never ran; and
 *   - the only test that did drive the wrapper end-to-end
 *     (e2e-tests/.../electron-worktree-hook.spec.ts) sits in
 *     `for_feature_development_not_LT_verification/`, a directory no gating (or
 *     even non-gating CI) Playwright tier runs.
 *
 * This black-box test calls the real wrapper against a throwaway git repo and
 * asserts the observable side effects (worktree created, hook executed). It
 * needs no Electron, no daemon, and no fixed ports, so it runs in the gating
 * vitest tier (webapp-unit) and is parallel-safe without the Electron flock.
 */

import {afterEach, describe, expect, it} from 'vitest'
import {execFileSync} from 'node:child_process'
import {
    chmodSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {createWorktreeWithHooks} from './createWorktreeWithHooks'

// Per-test teardown: restore env and delete temp dirs so each case is hermetic.
const cleanups: Array<() => void> = []
const savedEnv: Record<string, string | undefined> = {}

function setEnv(key: string, value: string): void {
    if (!(key in savedEnv)) savedEnv[key] = process.env[key]
    process.env[key] = value
}

afterEach(() => {
    for (const key of Object.keys(savedEnv)) {
        const original: string | undefined = savedEnv[key]
        if (original === undefined) delete process.env[key]
        else process.env[key] = original
        delete savedEnv[key]
    }
    while (cleanups.length > 0) cleanups.pop()!()
})

function git(repoRoot: string, args: readonly string[]): void {
    execFileSync('git', args, {cwd: repoRoot, stdio: 'pipe'})
}

function trackTempDir(prefix: string): string {
    const dir: string = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
    cleanups.push(() => rmSync(dir, {recursive: true, force: true}))
    return dir
}

/**
 * Real git repo with one commit. With plain git (no git-gate wrapper on PATH),
 * the core's `git worktree add <bare-name>` lands the worktree nested under the
 * repo; the wrapper rewrites placement in production. Either way the test
 * asserts against the path `createWorktree` reads back from git, so it does not
 * depend on where the worktree lands.
 */
function makeRepo(): string {
    const repoRoot: string = join(trackTempDir('vt-wt-wrapper-'), 'repo')
    mkdirSync(repoRoot, {recursive: true})
    git(repoRoot, ['init', '-q', '-b', 'main'])
    git(repoRoot, ['config', 'user.email', 'test@example.com'])
    git(repoRoot, ['config', 'user.name', 'Test'])
    git(repoRoot, ['config', 'commit.gpgsign', 'false'])
    writeFileSync(join(repoRoot, 'seed.md'), '# seed\n')
    git(repoRoot, ['add', '.'])
    git(repoRoot, ['commit', '-q', '-m', 'seed'])
    return repoRoot
}

/** Point VOICETREE_HOME_PATH at a fresh temp home holding the given settings. */
function withSettings(settings: Record<string, unknown>): void {
    const home: string = trackTempDir('vt-wt-home-')
    writeFileSync(join(home, 'settings.json'), JSON.stringify(settings), 'utf-8')
    setEnv('VOICETREE_HOME_PATH', home)
}

/** A hook script that records its two positional args ($1 $2) to a marker. */
function makeMarkerHook(): {command: string; readMarker: () => string} {
    const dir: string = trackTempDir('vt-wt-hook-')
    const markerPath: string = join(dir, 'marker.txt')
    const hookPath: string = join(dir, 'hook.sh')
    writeFileSync(hookPath, `#!/bin/sh\necho "$1 $2" > "${markerPath}"\n`, 'utf-8')
    chmodSync(hookPath, 0o755)
    return {command: hookPath, readMarker: () => readFileSync(markerPath, 'utf-8').trim()}
}

/**
 * A marker hook written INTO the repo at `relPath` (e.g. `scripts/hook.sh`) and
 * referenced by the repo-relative command `./<relPath>` — mirroring the real
 * settings default `./scripts/git/worktree/on-created-blocking.sh`. The marker
 * file lives outside the repo so its absolute path is cwd-independent; only the
 * COMMAND is relative, so the hook resolves iff cwd is the repo's main checkout.
 */
function makeRepoRelativeHook(repoRoot: string, relPath: string): {command: string; readMarker: () => string} {
    const markerPath: string = join(trackTempDir('vt-wt-marker-'), 'marker.txt')
    const hookPath: string = join(repoRoot, relPath)
    mkdirSync(join(repoRoot, relPath, '..'), {recursive: true})
    writeFileSync(hookPath, `#!/bin/sh\necho "$1 $2" > "${markerPath}"\n`, 'utf-8')
    chmodSync(hookPath, 0o755)
    return {command: `./${relPath}`, readMarker: () => readFileSync(markerPath, 'utf-8').trim()}
}

describe('createWorktreeWithHooks (the real api.main.createWorktree path)', () => {
    it('creates the worktree and runs the configured blocking hook with (worktreePath, worktreeName)', async () => {
        const repoRoot: string = makeRepo()
        const hook: {command: string; readMarker: () => string} = makeMarkerHook()
        withSettings({hooks: {onWorktreeCreatedBlocking: hook.command}})

        const worktreeName: string = 'wt-wrapper-hook'
        const worktreePath: string = await createWorktreeWithHooks(repoRoot, worktreeName)

        // Worktree exists on disk...
        expect(statSync(worktreePath).isDirectory()).toBe(true)
        // ...and the blocking hook ran (awaited before return) with the right args.
        expect(hook.readMarker()).toBe(`${worktreePath} ${worktreeName}`)
    })

    it('resolves a repo-relative hook command when repoRoot is a nested subdirectory', async () => {
        // Regression: the worktree-created hooks fired with cwd = `repoRoot`,
        // which is the WATCHED directory — often a subfolder nested deep inside
        // the checkout (e.g. a markdown project). A repo-relative command like
        // `./scripts/git/worktree/on-created-blocking.sh` then resolved against
        // that subfolder and failed with "No such file or directory". Hooks now
        // run from the repo's MAIN CHECKOUT, so the relative path resolves.
        const repoRoot: string = makeRepo()
        const hook: {command: string; readMarker: () => string} = makeRepoRelativeHook(repoRoot, 'scripts/git/worktree/on-created-blocking.sh')
        withSettings({hooks: {onWorktreeCreatedBlocking: hook.command}})

        // Watch a nested subdirectory of the checkout, NOT the repo root itself.
        const watchedDir: string = join(repoRoot, 'graph', 'ctx-nodes')
        mkdirSync(watchedDir, {recursive: true})

        const worktreeName: string = 'wt-wrapper-nested'
        const worktreePath: string = await createWorktreeWithHooks(watchedDir, worktreeName)

        expect(statSync(worktreePath).isDirectory()).toBe(true)
        // The hook ran (cwd anchored at the main checkout) with the right args.
        expect(hook.readMarker()).toBe(`${worktreePath} ${worktreeName}`)
    })

    it('creates the worktree when no hook is configured', async () => {
        // This is the case that crashed under the `getMcpPort` regression: the
        // wrapper threw BEFORE any hook logic, so even hook-less creation failed.
        const repoRoot: string = makeRepo()
        withSettings({})

        const worktreeName: string = 'wt-wrapper-nohook'
        const worktreePath: string = await createWorktreeWithHooks(repoRoot, worktreeName)

        expect(worktreePath).toContain(worktreeName)
        expect(statSync(worktreePath).isDirectory()).toBe(true)
    })
})
