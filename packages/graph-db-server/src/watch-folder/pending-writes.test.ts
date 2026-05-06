import { EventEmitter } from 'node:events'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import type { FSWatcher } from 'chokidar'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../graph/handleFSEvent', () => ({
    handleFSEventWithStateAndUISides: vi.fn(),
}))

vi.mock('./broadcast-folder-tree', () => ({
    broadcastFolderTree: vi.fn(),
}))

import { handleFSEventWithStateAndUISides } from '../graph/handleFSEvent'
import { clearWatchFolderState, setWatcher } from '../state/watch-folder-store'
import { setupWatcherListeners } from './file-watcher-setup'
import { markPendingWrite, markPendingDelete, isPendingWrite, clearPendingWrite } from './pending-writes'

const mockedHandleFSEvent = vi.mocked(handleFSEventWithStateAndUISides)

class FakeWatcher extends EventEmitter {
    async close(): Promise<void> {
        this.removeAllListeners()
    }
}

async function flushWatcherHandlers(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 25))
}

describe('pending writes watcher suppression', () => {
    let tmpDir: string
    let watchedDir: string
    let watcher: FakeWatcher

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pending-writes-'))
        watchedDir = path.join(tmpDir, 'vault')
        await fs.mkdir(watchedDir, { recursive: true })

        watcher = new FakeWatcher()
        clearWatchFolderState()
        setWatcher(watcher as unknown as FSWatcher)
        setupWatcherListeners(watchedDir)
        mockedHandleFSEvent.mockClear()
    })

    afterEach(async () => {
        vi.useRealTimers()
        clearWatchFolderState()
        watcher.removeAllListeners()
        mockedHandleFSEvent.mockClear()
        await fs.rm(tmpDir, { recursive: true, force: true })
    })

    it('does not re-process a file change caused by the daemon CRUD write path', async () => {
        const filePath = path.join(watchedDir, 'own-write.md')

        markPendingWrite(filePath)
        await fs.writeFile(filePath, '# Own write\n', 'utf8')
        watcher.emit('change', filePath)

        await flushWatcherHandlers()

        expect(mockedHandleFSEvent).not.toHaveBeenCalled()
        expect(isPendingWrite(filePath)).toBe(false)
    })

    it('does process an external file change that was not marked pending', async () => {
        const filePath = path.join(watchedDir, 'external-write.md')
        await fs.writeFile(filePath, '# External write\n', 'utf8')

        watcher.emit('change', filePath)

        await vi.waitFor(() => {
            expect(mockedHandleFSEvent).toHaveBeenCalledWith(
                {
                    absolutePath: filePath,
                    content: '# External write\n',
                    eventType: 'Changed',
                },
                watchedDir,
            )
        })
    })

    it('clears a pending write after one chokidar event so a later external write is processed', async () => {
        const filePath = path.join(watchedDir, 'one-shot.md')

        markPendingWrite(filePath)
        await fs.writeFile(filePath, '# Daemon write\n', 'utf8')
        watcher.emit('change', filePath)
        await flushWatcherHandlers()

        expect(mockedHandleFSEvent).not.toHaveBeenCalled()
        expect(isPendingWrite(filePath)).toBe(false)

        await fs.writeFile(filePath, '# External follow-up\n', 'utf8')
        watcher.emit('change', filePath)

        await vi.waitFor(() => {
            expect(mockedHandleFSEvent).toHaveBeenCalledTimes(1)
            expect(mockedHandleFSEvent).toHaveBeenCalledWith(
                {
                    absolutePath: filePath,
                    content: '# External follow-up\n',
                    eventType: 'Changed',
                },
                watchedDir,
            )
        })
    })

    it('expires stale pending writes after the safety timeout when chokidar never fires', () => {
        vi.useFakeTimers()
        const filePath = path.join(watchedDir, 'stale.md')

        markPendingWrite(filePath)

        expect(isPendingWrite(filePath)).toBe(true)
        vi.advanceTimersByTime(4999)
        expect(isPendingWrite(filePath)).toBe(true)
        vi.advanceTimersByTime(2)
        expect(isPendingWrite(filePath)).toBe(false)
    })

    it('suppresses unlink events caused by daemon CRUD deletes', async () => {
        const filePath = path.join(watchedDir, 'deleted-by-daemon.md')
        await fs.writeFile(filePath, '# Delete me\n', 'utf8')

        markPendingDelete(filePath)
        await fs.unlink(filePath)
        watcher.emit('unlink', filePath)

        await flushWatcherHandlers()

        expect(mockedHandleFSEvent).not.toHaveBeenCalled()
        expect(isPendingWrite(filePath)).toBe(false)
    })

    it('suppresses rapid successive daemon writes to the same file one event per mark', async () => {
        const filePath = path.join(watchedDir, 'rapid.md')

        markPendingWrite(filePath)
        await fs.writeFile(filePath, '# Daemon write 1\n', 'utf8')
        markPendingWrite(filePath)
        await fs.writeFile(filePath, '# Daemon write 2\n', 'utf8')

        watcher.emit('change', filePath)
        watcher.emit('change', filePath)
        await flushWatcherHandlers()

        expect(mockedHandleFSEvent).not.toHaveBeenCalled()
        expect(isPendingWrite(filePath)).toBe(false)

        await fs.writeFile(filePath, '# External write\n', 'utf8')
        watcher.emit('change', filePath)

        await vi.waitFor(() => {
            expect(mockedHandleFSEvent).toHaveBeenCalledTimes(1)
            expect(mockedHandleFSEvent).toHaveBeenCalledWith(
                {
                    absolutePath: filePath,
                    content: '# External write\n',
                    eventType: 'Changed',
                },
                watchedDir,
            )
        })
    })

    it('does not let a pending write on one file suppress a different file', async () => {
        const pendingPath = path.join(watchedDir, 'pending-a.md')
        const externalPath = path.join(watchedDir, 'external-b.md')
        await fs.writeFile(pendingPath, '# Pending A\n', 'utf8')
        await fs.writeFile(externalPath, '# External B\n', 'utf8')

        markPendingWrite(pendingPath)
        watcher.emit('change', externalPath)

        await vi.waitFor(() => {
            expect(mockedHandleFSEvent).toHaveBeenCalledWith(
                {
                    absolutePath: externalPath,
                    content: '# External B\n',
                    eventType: 'Changed',
                },
                watchedDir,
            )
        })

        watcher.emit('change', pendingPath)
        await flushWatcherHandlers()

        expect(mockedHandleFSEvent).toHaveBeenCalledTimes(1)
        expect(isPendingWrite(pendingPath)).toBe(false)
    })
})
