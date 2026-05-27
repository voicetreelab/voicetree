import {spawn} from 'node:child_process'

const TMUX: string = 'tmux'

export function formatMissingTmuxMessage(platform: NodeJS.Platform): string {
    const header: string = 'tmux is required but was not found on PATH.'
    if (platform === 'darwin') {
        return `${header} Install with: brew install tmux`
    }
    if (platform === 'linux') {
        return `${header} Install with: sudo apt install tmux (Debian/Ubuntu/WSL) or sudo dnf install tmux (Fedora/RHEL).`
    }
    if (platform === 'win32') {
        return `${header} Voicetree on Windows is supported only inside WSL2. Install WSL2 + a Linux distro (e.g. Ubuntu), launch Voicetree from inside WSL, and run: sudo apt install tmux`
    }
    return `${header} Install tmux via your system package manager (platform: ${platform}).`
}

export interface TmuxPreflightDeps {
    spawnFn: typeof spawn
    platform: NodeJS.Platform
}

const defaultDeps: TmuxPreflightDeps = {
    spawnFn: spawn,
    platform: process.platform,
}

let preflightCache: Promise<void> | null = null

export function resetTmuxPreflightCache(): void {
    preflightCache = null
}

export function ensureTmuxAvailable(deps: TmuxPreflightDeps = defaultDeps): Promise<void> {
    if (preflightCache) return preflightCache
    preflightCache = runPreflight(deps).catch((err: Error) => {
        preflightCache = null
        throw err
    })
    return preflightCache
}

function runPreflight(deps: TmuxPreflightDeps): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const child = deps.spawnFn(TMUX, ['-V'], {stdio: ['ignore', 'pipe', 'pipe']})
        const stderrChunks: Buffer[] = []
        child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk))
        child.on('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'ENOENT') {
                reject(new Error(formatMissingTmuxMessage(deps.platform)))
                return
            }
            reject(err)
        })
        child.on('close', (code: number | null) => {
            if (code === 0) {
                resolve()
                return
            }
            const stderr: string = Buffer.concat(stderrChunks).toString('utf8').trim()
            reject(new Error(`tmux -V failed with exit code ${code}: ${stderr}`))
        })
    })
}
