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
 * Real sibling-layout git repo: <parent>/repo with one commit, so the core's
 * `git worktree add` lands at <parent>/vt-wts/<name> (both under one tmp dir).
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
    // Pin the sibling-dir role so the test never reads ~/.env (resolveDevRole).
    setEnv('VT_DEV_ROLE', 'mac')
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
