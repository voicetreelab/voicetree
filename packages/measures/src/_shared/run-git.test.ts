import {execFileSync} from 'node:child_process'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {runGitWorktreeCommand} from './run-git'

// Reproduce the leak a git hook creates: GIT_DIR is exported into the hook
// environment without GIT_WORK_TREE, pointing at a git dir from which git cannot
// infer a work tree (the read-only base checkout is configured exactly this way —
// `git -C <base> rev-parse --show-toplevel` aborts with "must be run in a work
// tree"). We stand that in with a separate bare git dir; under it, working-tree
// commands abort regardless of cwd unless the override is stripped.
function withLeakedGitDir<T>(gitDir: string, run: () => T): T {
    const savedGitDir = process.env.GIT_DIR
    const savedWorkTree = process.env.GIT_WORK_TREE
    process.env.GIT_DIR = gitDir
    delete process.env.GIT_WORK_TREE
    try {
        return run()
    } finally {
        if (savedGitDir === undefined) delete process.env.GIT_DIR
        else process.env.GIT_DIR = savedGitDir
        if (savedWorkTree === undefined) delete process.env.GIT_WORK_TREE
        else process.env.GIT_WORK_TREE = savedWorkTree
    }
}

describe('runGitWorktreeCommand', () => {
    let repoRoot: string
    let leakedGitDir: string

    beforeEach(async () => {
        repoRoot = await mkdtemp(join(tmpdir(), 'run-git-'))
        execFileSync('git', ['init', '-q'], {cwd: repoRoot})
        await writeFile(join(repoRoot, 'tracked.txt'), 'hello\n')
        execFileSync('git', ['add', 'tracked.txt'], {cwd: repoRoot})
        // A git dir with no inferable work tree — stands in for the leaked base.
        leakedGitDir = await mkdtemp(join(tmpdir(), 'run-git-leak-'))
        execFileSync('git', ['init', '--bare', '-q', leakedGitDir])
    })

    afterEach(async () => {
        await rm(repoRoot, {recursive: true, force: true})
        await rm(leakedGitDir, {recursive: true, force: true})
    })

    it('lists working-tree files even when a hook leaked GIT_DIR without GIT_WORK_TREE', () => {
        withLeakedGitDir(leakedGitDir, () => {
            const stdout = runGitWorktreeCommand(['ls-files', '-co', '--exclude-standard'], repoRoot)
            expect(stdout.split('\n').filter(Boolean)).toContain('tracked.txt')
        })
    })

    it('documents the underlying break: raw git in the same leaked env fails', () => {
        withLeakedGitDir(leakedGitDir, () => {
            expect(() =>
                execFileSync('git', ['ls-files', '-co', '--exclude-standard'], {
                    cwd: repoRoot,
                    encoding: 'utf8',
                    stdio: ['ignore', 'pipe', 'ignore'],
                }),
            ).toThrow()
        })
    })

    it('resolves the repo from cwd in a clean environment too', () => {
        const stdout = runGitWorktreeCommand(['ls-files'], repoRoot)
        expect(stdout.split('\n').filter(Boolean)).toEqual(['tracked.txt'])
    })
})
