import {EventEmitter} from 'node:events'
import {Readable} from 'node:stream'
import {afterEach, describe, expect, it} from 'vitest'
import {
    ensureTmuxAvailable,
    formatMissingTmuxMessage,
    resetTmuxPreflightCache,
    type TmuxPreflightDeps,
} from '../../tmux/tmux-preflight.ts'

type FakeChildOpts = {
    exitCode?: number | null
    spawnError?: NodeJS.ErrnoException
    stderr?: string
}

function makeFakeChild(opts: FakeChildOpts) {
    const emitter = new EventEmitter() as EventEmitter & {stderr: Readable | null}
    emitter.stderr = opts.stderr !== undefined ? Readable.from([Buffer.from(opts.stderr)]) : null
    queueMicrotask(() => {
        if (opts.spawnError) {
            emitter.emit('error', opts.spawnError)
            return
        }
        emitter.emit('close', opts.exitCode ?? 0)
    })
    return emitter
}

function fakeSpawn(opts: FakeChildOpts): TmuxPreflightDeps['spawnFn'] {
    return (() => makeFakeChild(opts)) as unknown as TmuxPreflightDeps['spawnFn']
}

describe('formatMissingTmuxMessage', () => {
    it('returns brew install hint on darwin', () => {
        expect(formatMissingTmuxMessage('darwin')).toContain('brew install tmux')
    })

    it('returns apt + dnf hint on linux', () => {
        const msg: string = formatMissingTmuxMessage('linux')
        expect(msg).toContain('apt install tmux')
        expect(msg).toContain('dnf install tmux')
    })

    it('points win32 users to WSL', () => {
        const msg: string = formatMissingTmuxMessage('win32')
        expect(msg).toContain('WSL')
        expect(msg).toContain('apt install tmux')
    })

    it('falls back with platform name for unknown platforms', () => {
        const msg: string = formatMissingTmuxMessage('freebsd' as NodeJS.Platform)
        expect(msg).toContain('freebsd')
    })
})

describe('ensureTmuxAvailable', () => {
    afterEach(() => {
        resetTmuxPreflightCache()
    })

    it('resolves when tmux exits with code 0', async () => {
        await expect(
            ensureTmuxAvailable({spawnFn: fakeSpawn({exitCode: 0}), platform: 'linux'}),
        ).resolves.toBeUndefined()
    })

    it('rejects with platform-specific install message on ENOENT', async () => {
        const enoent: NodeJS.ErrnoException = Object.assign(new Error('spawn tmux ENOENT'), {code: 'ENOENT'})
        await expect(
            ensureTmuxAvailable({spawnFn: fakeSpawn({spawnError: enoent}), platform: 'darwin'}),
        ).rejects.toThrow('brew install tmux')
    })

    it('caches success so subsequent calls do not re-spawn', async () => {
        let spawnCount: number = 0
        const countingSpawn = ((..._args: unknown[]) => {
            spawnCount += 1
            return makeFakeChild({exitCode: 0})
        }) as unknown as TmuxPreflightDeps['spawnFn']
        await ensureTmuxAvailable({spawnFn: countingSpawn, platform: 'linux'})
        await ensureTmuxAvailable({spawnFn: countingSpawn, platform: 'linux'})
        expect(spawnCount).toBe(1)
    })

    it('does not cache failures so a later install can succeed', async () => {
        const enoent: NodeJS.ErrnoException = Object.assign(new Error('spawn tmux ENOENT'), {code: 'ENOENT'})
        await expect(
            ensureTmuxAvailable({spawnFn: fakeSpawn({spawnError: enoent}), platform: 'linux'}),
        ).rejects.toThrow('tmux is required')
        await expect(
            ensureTmuxAvailable({spawnFn: fakeSpawn({exitCode: 0}), platform: 'linux'}),
        ).resolves.toBeUndefined()
    })
})
