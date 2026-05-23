// End-to-end black-box test of chokidar → vault-state topic → subscriber
// receives, via a test daemon. Verifies the daemon bootstrap wires the
// watcher correctly so 9e's renderer-side subscription will work against
// the same wire.

import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'

import {createEventSubscriptionHub, type EventSubscriptionHub, type Subscriber} from '../eventSubscriptionHub.ts'
import {startVaultStateWatcher, type VaultStateWatcherHandle} from '../vaultStateWatcher.ts'

const watchers: VaultStateWatcherHandle[] = []
const dirs: string[] = []

afterEach(async (): Promise<void> => {
    while (watchers.length > 0) await watchers.pop()!.stop().catch((): void => {})
    while (dirs.length > 0) await rm(dirs.pop()!, {recursive: true, force: true}).catch((): void => {})
})

function makeSubscriber(): {received: Array<{event: string; data: {path: string}}>; subscriber: Subscriber} {
    const received: Array<{event: string; data: {path: string}}> = []
    return {
        received,
        subscriber: {
            send: (frame: string): void => {
                const parsed = JSON.parse(frame) as {event: string; data: {path: string}}
                received.push({event: parsed.event, data: parsed.data})
            },
            overflow: (): void => {},
        },
    }
}

async function delay(ms: number): Promise<void> {
    return new Promise<void>((r): void => { setTimeout((): void => r(), ms) })
}

describe('chokidar → vault-state topic', (): void => {
    it('publishes file-added when a new markdown file appears', async (): Promise<void> => {
        const vault: string = await mkdtemp(join(tmpdir(), 'vt-watcher-add-'))
        dirs.push(vault)
        await mkdir(join(vault, '.voicetree'), {recursive: true})

        const hub: EventSubscriptionHub = createEventSubscriptionHub()
        const {subscriber, received} = makeSubscriber()
        const handle = hub.addSubscriber(subscriber)
        handle.subscribe([{topic: 'vault-state'}])

        const watcher = startVaultStateWatcher({vaultPath: vault, hub, usePolling: true})
        watchers.push(watcher)
        // Give chokidar a moment to start its initial scan.
        await delay(300)

        await writeFile(join(vault, 'note.md'), '# hi\n', 'utf8')
        // Wait for the watcher to coalesce + emit.
        await delay(500)

        expect(received.length).toBeGreaterThanOrEqual(1)
        const addEvt = received.find((r): boolean => r.event === 'file-added')
        expect(addEvt).toBeDefined()
        expect(addEvt?.data.path).toContain('note.md')
    }, 10_000)

    it('publishes file-changed when a markdown file is updated', async (): Promise<void> => {
        const vault: string = await mkdtemp(join(tmpdir(), 'vt-watcher-change-'))
        dirs.push(vault)
        await mkdir(join(vault, '.voicetree'), {recursive: true})
        const target: string = join(vault, 'note.md')
        await writeFile(target, '# hi\n', 'utf8')

        const hub: EventSubscriptionHub = createEventSubscriptionHub()
        const {subscriber, received} = makeSubscriber()
        const handle = hub.addSubscriber(subscriber)
        handle.subscribe([{topic: 'vault-state'}])

        const watcher = startVaultStateWatcher({vaultPath: vault, hub, usePolling: true})
        watchers.push(watcher)
        await delay(300)

        await writeFile(target, '# updated\n', 'utf8')
        await delay(500)

        const changeEvt = received.find((r): boolean => r.event === 'file-changed')
        expect(changeEvt).toBeDefined()
        expect(changeEvt?.data.path).toContain('note.md')
    }, 10_000)
})
