import {execFileSync} from 'node:child_process'

export function listGitTrackedFiles(repoRoot: string): readonly string[] {
    const stdout = execFileSync('git', ['ls-files', '-z'], {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    return stdout.split('\0').filter(path => path.length > 0)
}
