import { describe, it, expect } from 'vitest'
import { buildContainmentTree } from '../../../src/lint/graphLint'
import type { ContainmentTree } from '../../../src/lint/graphLint'

export const describeBuildContainmentTree = (): void => {
    describe('buildContainmentTree', () => {
        it('builds parent-child from explicit parent edges', () => {
            const nodeContents: Map<string, string> = new Map([
                ['root', '# Root'],
                ['child', '# Child\n- parent [[root]]'],
            ])
            const nodeIds: string[] = ['root', 'child']

            const tree: ContainmentTree = buildContainmentTree(nodeIds, nodeContents, new Map())
            expect(tree.parentOf.get('child')).toBe('root')
            expect(tree.childrenOf.get('root')).toEqual(['child'])
        })

        it('builds parent-child from canonical folder note hierarchy', () => {
            const nodeContents: Map<string, string> = new Map([
                ['topic/topic', '# Topic'],
                ['topic/subtopic', '# Subtopic'],
            ])
            const nodeIds: string[] = ['topic/topic', 'topic/subtopic']
            const folderIndexMap: Map<string, string> = new Map([['topic', 'topic/topic']])

            const tree: ContainmentTree = buildContainmentTree(nodeIds, nodeContents, folderIndexMap)
            expect(tree.parentOf.get('topic/subtopic')).toBe('topic/topic')
        })

        it('builds parent-child from directory hierarchy without a folder note', () => {
            const nodeContents: Map<string, string> = new Map([
                ['topic/subtopic', '# Subtopic'],
            ])
            const nodeIds: string[] = ['topic/subtopic']

            const tree: ContainmentTree = buildContainmentTree(nodeIds, nodeContents, new Map())
            const parentId: string | null | undefined = tree.parentOf.get('topic/subtopic')

            expect(parentId).toBeTruthy()
            expect(tree.childrenOf.get(parentId!) ?? []).toContain('topic/subtopic')
        })

        it('directory containment overrides explicit parent edges', () => {
            const nodeContents: Map<string, string> = new Map([
                ['topic/topic', '# Topic'],
                ['topic/subtopic', '# Subtopic\n- parent [[other]]'],
                ['other', '# Other'],
            ])
            const nodeIds: string[] = ['topic/topic', 'topic/subtopic', 'other']
            const folderIndexMap: Map<string, string> = new Map([['topic', 'topic/topic']])

            const tree: ContainmentTree = buildContainmentTree(nodeIds, nodeContents, folderIndexMap)
            expect(tree.parentOf.get('topic/subtopic')).toBe('topic/topic')
        })
    })
}
