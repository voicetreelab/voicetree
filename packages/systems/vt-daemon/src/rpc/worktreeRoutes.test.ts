// Black-box round-trip test for the worktree.* gateway routes. Builds the
// routes via the factory with a `getRepoRoot` pinned at a throwaway git repo,
// invokes each route exactly as POST /rpc would (parse args → handler → unwrap
// the JSON envelope), and asserts the create → list → remove LIFECYCLE through
// its observable side effects on disk and in `git worktree list` — no internal
// mocks, no "was called". The underlying git functions have their own unit
// coverage in workspace/worktree/gitWorktreeCommands.test.ts; this proves the
// gateway wiring: method names, request parsing, response shapes, and that the
// repo root is taken from the daemon's deps, not the client.

import {execFileSync} from 'node:child_process'
import {existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {afterEach, beforeEach, describe, expect, test} from 'vitest'

import {WORKTREE_METHODS, type WorktreeInfo} from '@vt/vt-daemon-protocol'

import {buildWorktreeRoutes} from './worktreeRoutes.ts'
import type {RpcRoute} from './RpcRoute.ts'
import {gitEnv} from '../workspace/worktree/gitWorktreeInternals.ts'

const M = WORKTREE_METHODS

// Strip any GIT_DIR/GIT_WORK_TREE/GIT_COMMON_DIR leaked into the test process by
// an enclosing git hook — as the production `gitEnv` does — so the throwaway
// repo resolves from `cwd` and never operates on the real repo.
function git(repoRoot: string, args: readonly string[]): string {
    return execFileSync('git', args, {cwd: repoRoot, stdio: 'pipe', encoding: 'utf-8', env: gitEnv()})
}

function makeRepo(parent: string): string {
    const repoRoot: string = path.join(parent, 'repo')
    mkdirSync(repoRoot, {recursive: true})
    git(repoRoot, ['init', '-q', '-b', 'main'])
    git(repoRoot, ['config', 'user.email', 'test@example.com'])
    git(repoRoot, ['config', 'user.name', 'Test'])
    git(repoRoot, ['config', 'commit.gpgsign', 'false'])
    writeFileSync(path.join(repoRoot, 'seed.md'), '# seed\n')
    git(repoRoot, ['add', '.'])
    git(repoRoot, ['commit', '-q', '-m', 'seed'])
    return repoRoot
}

describe('worktree.* gateway routes (real git roundtrip)', () => {
    let root: string
    let repoRoot: string
    let invoke: (method: string, args?: Record<string, unknown>) => Promise<unknown>
    const savedEnv: Record<string, string | undefined> = {}

    function setEnv(key: string, value: string): void {
        if (!(key in savedEnv)) savedEnv[key] = process.env[key]
        process.env[key] = value
    }

    beforeEach(() => {
        root = realpathSync(mkdtempSync(path.join(tmpdir(), 'worktree-routes-')))
        repoRoot = makeRepo(root)

        // Hermetic placement + no hooks: a git-gate-free HOME pins app-owned
        // placement; VT_WORKTREE_ROOT keeps worktrees in a known sibling dir;
        // an empty settings home means createWorktreeWithHooks fires no hooks.
        const gitGateFreeHome: string = realpathSync(mkdtempSync(path.join(tmpdir(), 'worktree-home-')))
        setEnv('HOME', gitGateFreeHome)
        setEnv('VT_WORKTREE_ROOT', path.join(root, 'wts'))
        const settingsHome: string = realpathSync(mkdtempSync(path.join(tmpdir(), 'worktree-settings-')))
        writeFileSync(path.join(settingsHome, 'settings.json'), JSON.stringify({}), 'utf-8')
        setEnv('VOICETREE_HOME_PATH', settingsHome)

        const routes: readonly RpcRoute[] = buildWorktreeRoutes({getRepoRoot: async (): Promise<string> => repoRoot})
        const byName: Map<string, RpcRoute> = new Map(routes.map((r): [string, RpcRoute] => [r.name, r]))
        invoke = async (method: string, args: Record<string, unknown> = {}): Promise<unknown> => {
            const route: RpcRoute | undefined = byName.get(method)
            if (!route) throw new Error(`no worktree route for ${method}`)
            const res = await route.handler(args)
            const text: string = res.content[0]?.text ?? ''
            return text === '' ? null : JSON.parse(text)
        }
    })

    afterEach(() => {
        for (const key of Object.keys(savedEnv)) {
            const original: string | undefined = savedEnv[key]
            if (original === undefined) delete process.env[key]
            else process.env[key] = original
            delete savedEnv[key]
        }
        rmSync(root, {recursive: true, force: true})
    })

    test('generateName derives a sanitized wt- branch name from a title', async () => {
        const {name} = await invoke(M.generateName, {nodeTitle: 'Fix Auth Bug'}) as {name: string}
        expect(name).toMatch(/^wt-fix-auth-bug-[a-z0-9]{1,3}$/)
    })

    test('create → list → remove lifecycle has the observable side effects', async () => {
        // CREATE: the worktree exists on disk and git agrees the branch lives there.
        const {path: wtPath} = await invoke(M.create, {worktreeName: 'wt-rt-alpha'}) as {path: string}
        expect(existsSync(wtPath)).toBe(true)
        expect(git(repoRoot, ['worktree', 'list', '--porcelain'])).toContain(`worktree ${wtPath}`)

        // LIST: the gateway surfaces the new worktree with its parsed fields.
        const listed = await invoke(M.list) as WorktreeInfo[]
        const found: WorktreeInfo | undefined = listed.find((w: WorktreeInfo) => w.path === wtPath)
        expect(found).toBeDefined()
        expect(found?.branch).toBe('wt-rt-alpha')
        expect(found?.name).toBe('rt-alpha') // "wt-" prefix stripped for display

        // REMOVE-COMMAND: preview string references the path, runs nothing.
        const {command} = await invoke(M.removeCommand, {worktreePath: wtPath}) as {command: string}
        expect(command).toContain(wtPath)
        expect(existsSync(wtPath)).toBe(true) // preview did not remove anything

        // REMOVE: succeeds and the worktree is gone from disk and from git.
        const removed = await invoke(M.remove, {worktreePath: wtPath}) as {success: boolean}
        expect(removed.success).toBe(true)
        expect(existsSync(wtPath)).toBe(false)
        expect(git(repoRoot, ['worktree', 'list', '--porcelain'])).not.toContain(`worktree ${wtPath}`)
    })

    test('remove reports failure (not throw) for a path that is not a worktree', async () => {
        const bogus: string = path.join(root, 'not-a-worktree')
        const result = await invoke(M.remove, {worktreePath: bogus}) as {success: boolean; error?: string}
        expect(result.success).toBe(false)
        expect(result.error).toBeTruthy()
    })
})
