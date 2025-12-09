import { describe, it, expect } from 'vitest'
import { createRecentActionStore, type RecentActionStore } from './recent-action-store'

describe('recent-action-store', () => {
    describe('mark + isRecent', () => {
        it('should return true for recently marked key+content', () => {
            const store: RecentActionStore = createRecentActionStore()
            store.mark('key1', 'content1')
            expect(store.isRecent('key1', 'content1')).toBe(true)
        })

        it('should return false for different content', () => {
            const store: RecentActionStore = createRecentActionStore()
            store.mark('key1', 'content1')
            expect(store.isRecent('key1', 'content2')).toBe(false)
        })

        it('should return false for unknown key', () => {
            const store: RecentActionStore = createRecentActionStore()
            expect(store.isRecent('unknown', 'content')).toBe(false)
        })
    })

    describe('built-in normalization (strips brackets + whitespace)', () => {
        it('should match content ignoring whitespace differences', () => {
            const store: RecentActionStore = createRecentActionStore()
            store.mark('key1', 'hello world')
            expect(store.isRecent('key1', 'hello  world')).toBe(true)
            expect(store.isRecent('key1', 'helloworld')).toBe(true)
            expect(store.isRecent('key1', 'hello\nworld')).toBe(true)
        })

        it('should match content ignoring bracket content', () => {
            const store: RecentActionStore = createRecentActionStore()
            store.mark('key1', 'text [link.md] more')
            expect(store.isRecent('key1', 'text  more')).toBe(true)
            expect(store.isRecent('key1', 'text [other.md] more')).toBe(true)
        })

        it('should match when both have different brackets', () => {
            const store: RecentActionStore = createRecentActionStore()
            store.mark('key1', 'start [a.md] middle [b.md] end')
            expect(store.isRecent('key1', 'start [x.md] middle [y.md] end')).toBe(true)
        })

        it('should not match when non-bracket content differs', () => {
            const store: RecentActionStore = createRecentActionStore()
            store.mark('key1', 'hello [link.md] world')
            expect(store.isRecent('key1', 'goodbye [link.md] world')).toBe(false)
        })
    })

    describe('TTL expiration', () => {
        it('should return false after TTL expires', async () => {
            const shortTTLStore: RecentActionStore = createRecentActionStore(50)
            shortTTLStore.mark('key1', 'content')
            await new Promise(r => setTimeout(r, 100))
            expect(shortTTLStore.isRecent('key1', 'content')).toBe(false)
        })

        it('should return true within TTL window', async () => {
            const shortTTLStore: RecentActionStore = createRecentActionStore(200)
            shortTTLStore.mark('key1', 'content')
            await new Promise(r => setTimeout(r, 50))
            expect(shortTTLStore.isRecent('key1', 'content')).toBe(true)
        })
    })

    describe('multiple events handling (no consume on match)', () => {
        it('should allow multiple isRecent calls to match same mark', () => {
            const store: RecentActionStore = createRecentActionStore()
            store.mark('key1', 'content')
            expect(store.isRecent('key1', 'content')).toBe(true)
            expect(store.isRecent('key1', 'content')).toBe(true)
            expect(store.isRecent('key1', 'content')).toBe(true)
        })
    })

    describe('array accumulation within TTL', () => {
        it('should track multiple marks for same key', () => {
            const store: RecentActionStore = createRecentActionStore()
            store.mark('key1', 'first')
            store.mark('key1', 'second')
            expect(store.isRecent('key1', 'first')).toBe(true)
            expect(store.isRecent('key1', 'second')).toBe(true)
        })
    })

    describe('multiple keys', () => {
        it('should track keys independently', () => {
            const store: RecentActionStore = createRecentActionStore()
            store.mark('key1', 'content1')
            store.mark('key2', 'content2')
            expect(store.isRecent('key1', 'content1')).toBe(true)
            expect(store.isRecent('key2', 'content2')).toBe(true)
        })

        it('should not cross-match keys', () => {
            const store: RecentActionStore = createRecentActionStore()
            store.mark('key1', 'content')
            expect(store.isRecent('key2', 'content')).toBe(false)
        })
    })

    describe('deleteKey', () => {
        it('should remove entries for specific key only', () => {
            const store: RecentActionStore = createRecentActionStore()
            store.mark('key1', 'content1')
            store.mark('key2', 'content2')
            store.deleteKey('key1')
            expect(store.isRecent('key1', 'content1')).toBe(false)
            expect(store.isRecent('key2', 'content2')).toBe(true)
        })
    })

    describe('clear', () => {
        it('should remove all entries', () => {
            const store: RecentActionStore = createRecentActionStore()
            store.mark('key1', 'content1')
            store.mark('key2', 'content2')
            store.clear()
            expect(store.isRecent('key1', 'content1')).toBe(false)
            expect(store.isRecent('key2', 'content2')).toBe(false)
        })
    })

    describe('debugging helpers', () => {
        it('getCount should return number of tracked keys', () => {
            const store: RecentActionStore = createRecentActionStore()
            expect(store.getCount()).toBe(0)
            store.mark('key1', 'content')
            expect(store.getCount()).toBe(1)
            store.mark('key2', 'content')
            expect(store.getCount()).toBe(2)
        })

        it('getEntriesForKey should return entries', () => {
            const store: RecentActionStore = createRecentActionStore()
            store.mark('key1', 'content1')
            store.mark('key1', 'content2')
            const entries: readonly { readonly timestamp: number; readonly content: string }[] | undefined =
                store.getEntriesForKey('key1')
            expect(entries).toHaveLength(2)
            expect(entries?.[0].content).toBe('content1')
            expect(entries?.[1].content).toBe('content2')
        })

        it('getEntriesForKey should return undefined for unknown key', () => {
            const store: RecentActionStore = createRecentActionStore()
            expect(store.getEntriesForKey('unknown')).toBeUndefined()
        })
    })
})
