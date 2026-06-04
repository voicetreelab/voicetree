/**
 * Browser VoiceTree — git worktree gateway (daemon round-trip).
 *
 * Proves the no-Electron worktree operations end-to-end against the REAL daemons
 * booted by globalSetup: Chrome → window.hostAPI (browserRuntime.ts) → VTD
 * `worktree.*` routes → git. The daemon resolves the repo root from its OWN
 * loaded project (never a client path), so a worktree test needs that project to
 * be a real git repo. globalSetup seeds a plain temp dir, so `beforeAll` turns it
 * into a git repo with one commit — legitimate fixture setup for the operation
 * under test, done on disk where the daemon already reads.
 *
 * Covered HostAPI surface (main.*): generateWorktreeName, createWorktree,
 * listWorktrees, getRemoveWorktreeCommand, removeWorktree. Assertions are
 * observable: the RPC result AND the on-disk worktree directory git created,
 * which must exist after create and be gone after remove.
 */

import {execFileSync} from 'node:child_process'
import {existsSync} from 'node:fs'
import {test, expect} from '@playwright/test'
import {loadDaemonConfig, injectConfig, waitForHostApiReady} from './vt-e2e-helpers.ts'

interface WorktreeInfoView {
    readonly path: string
    readonly branch: string
    readonly head: string
    readonly name: string
}
interface WorktreeMain {
    readonly generateWorktreeName: (nodeTitle: string) => Promise<string>
    readonly createWorktree: (repoRoot: string, worktreeName: string) => Promise<string>
    readonly listWorktrees: () => Promise<readonly WorktreeInfoView[]>
    readonly getRemoveWorktreeCommand: (worktreePath: string, force?: boolean) => Promise<string>
    readonly removeWorktree: (repoRoot: string, worktreePath: string, force?: boolean) =>
        Promise<{success: boolean; command: string; error?: string}>
}
type WorktreeWindow = {hostAPI: {main: WorktreeMain}}

// Worktree branch names created in this run, for best-effort afterAll cleanup of
// anything a failing test left behind (the gateway remove is the happy path).
const createdBranches: string[] = []

function git(cwd: string, args: string[]): void {
    execFileSync('git', args, {
        cwd,
        stdio: 'pipe',
        env: {
            ...process.env,
            GIT_AUTHOR_NAME: 'VT E2E',
            GIT_AUTHOR_EMAIL: 'e2e@voicetree.test',
            GIT_COMMITTER_NAME: 'VT E2E',
            GIT_COMMITTER_EMAIL: 'e2e@voicetree.test',
        },
    })
}

test.describe('Browser VoiceTree — worktree gateway (daemon round-trip)', () => {
    const cfg = loadDaemonConfig()

    test.beforeAll(() => {
        // Make the daemon's loaded project a real git repo with one commit so
        // `git worktree add` has a base commit to branch from.
        git(cfg.projectPath, ['init', '-b', 'main'])
        git(cfg.projectPath, ['add', '-A'])
        git(cfg.projectPath, ['commit', '-m', 'seed', '--no-gpg-sign'])
    })

    test.afterAll(() => {
        // Best-effort: prune any worktree dirs a failed test left behind. The repo
        // itself lives under the temp project that globalTeardown removes wholesale.
        for (const branch of createdBranches) {
            try {
                git(cfg.projectPath, ['worktree', 'remove', '--force', branch])
            } catch { /* already removed by the test, or never created */ }
        }
        try { git(cfg.projectPath, ['worktree', 'prune']) } catch { /* no-op */ }
    })

    test('generateWorktreeName sanitizes a node title to a wt- branch name', async ({page}) => {
        await injectConfig(page, cfg)
        await page.goto('/')
        await waitForHostApiReady(page)

        const name = await page.evaluate(
            () => (window as unknown as WorktreeWindow).hostAPI.main.generateWorktreeName('My Cool Feature!'),
        )
        // generateWorktreeName: `wt-<slug>-<3 base36 chars>` (gitWorktreeCommands.ts).
        expect(name).toMatch(/^wt-my-cool-feature-[a-z0-9]{3}$/)
    })

    test('create → list → remove a worktree (on-disk dir appears then is gone)', async ({page}) => {
        await injectConfig(page, cfg)
        await page.goto('/')
        await waitForHostApiReady(page)

        const worktreeName = `wt-e2e-${Date.now()}`
        createdBranches.push(worktreeName)

        const created = await page.evaluate(async ({worktreeName, repoRoot}) => {
            const main = (window as unknown as WorktreeWindow).hostAPI.main
            // repoRoot is ignored daemon-side (resolved from the loaded project),
            // but the contract takes it — pass the real path for honesty.
            const path = await main.createWorktree(repoRoot, worktreeName)
            const list = await main.listWorktrees()
            const removeCommand = await main.getRemoveWorktreeCommand(path, true)
            return {path, list, removeCommand}
        }, {worktreeName, repoRoot: cfg.projectPath})

        // CREATE: git returns an absolute path that exists on disk.
        expect(typeof created.path).toBe('string')
        expect(created.path.length).toBeGreaterThan(0)
        expect(existsSync(created.path), 'worktree directory must exist on disk after create').toBe(true)

        // LIST: the new worktree appears with its branch.
        const listed = created.list.find((w) => w.path === created.path)
        expect(listed, 'created worktree must appear in listWorktrees()').toBeTruthy()
        expect(listed!.branch).toContain(worktreeName)

        // PREVIEW: the un-run remove command string references the worktree path.
        expect(created.removeCommand).toContain('git worktree remove')
        expect(created.removeCommand).toContain(created.path)

        // REMOVE: gateway removes it; the directory is gone and it leaves the list.
        const removed = await page.evaluate(async ({path, repoRoot}) => {
            const main = (window as unknown as WorktreeWindow).hostAPI.main
            const result = await main.removeWorktree(repoRoot, path, true)
            const list = await main.listWorktrees()
            return {result, list}
        }, {path: created.path, repoRoot: cfg.projectPath})

        expect(removed.result.success, `removeWorktree failed: ${removed.result.error ?? ''}`).toBe(true)
        expect(existsSync(created.path), 'worktree directory must be gone after remove').toBe(false)
        expect(removed.list.find((w) => w.path === created.path), 'removed worktree must leave the list').toBeFalsy()
    })

})
