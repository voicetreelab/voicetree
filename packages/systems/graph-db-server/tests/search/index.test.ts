import {describe, expect, it, vi} from 'vitest'
import {buildIndex, deleteNode, search, upsertNode} from '../../src/search/index-backend'

describe('SearchBackend stub contract', () => {
    it('logs the vector search todo message when building an index', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

        try {
            await buildIndex('/tmp/project')
            expect(logSpy).toHaveBeenCalledWith('vector search todo')
        } finally {
            logSpy.mockRestore()
        }
    })

    it('returns no search results while vector search is unavailable', async () => {
        await expect(search('/tmp/project', 'anything', 10)).resolves.toEqual([])
    })

    it('treats incremental index updates as no-ops', async () => {
        await expect(upsertNode('/tmp/project', '/tmp/project/node.md', '# Node', 'Node')).resolves.toBeUndefined()
        await expect(deleteNode('/tmp/project', '/tmp/project/node.md')).resolves.toBeUndefined()
    })
})
