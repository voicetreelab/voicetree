import {execFileSync} from 'node:child_process'
import {existsSync} from 'node:fs'
import {join} from 'node:path'

export function listGitTrackedFiles(repoRoot: string): readonly string[] {
    const stdout = execFileSync('git', ['ls-files', '-z'], {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    return stdout
        .split('\0')
        .filter(path => path.length > 0)
        .filter(path => existsSync(join(repoRoot, path)))
}
