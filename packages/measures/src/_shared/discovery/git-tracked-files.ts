import {existsSync} from 'node:fs'
import {join} from 'node:path'
import {runGitWorktreeCommand} from '../run-git'

export function listGitTrackedFiles(repoRoot: string): readonly string[] {
    const stdout = runGitWorktreeCommand(['ls-files', '-z'], repoRoot, {
        maxBuffer: 256 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    return stdout
        .split('\0')
        .filter(path => path.length > 0)
        .filter(path => existsSync(join(repoRoot, path)))
}
