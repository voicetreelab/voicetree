// Sample graph for the mockup harness — covers most cytoscape element shapes
// the real renderer cares about:
//
//   - expanded folders (compound nodes, isFolderNode + descendants)
//   - collapsed folder pills (isFolderNode + collapsed=true, no descendants)
//   - regular leaf nodes (markdown-style ids with file extensions)
//   - cross-folder edges
//   - a free leaf at the top level (not inside any folder)
//
// Mockups override `extendGraph` on mountHarness to add their own elements
// (presentation nodes, image nodes, etc.) without re-deriving the boilerplate.

import type cytoscape from 'cytoscape'

export interface SampleGraphOptions {
    initialCollapsed?: ReadonlySet<string>
}

export function buildSampleGraph(opts: SampleGraphOptions = {}): cytoscape.ElementDefinition[] {
    const collapsedFolderIds: ReadonlySet<string> = opts.initialCollapsed ?? new Set<string>()

    const folderData = (id: string, label: string, childCount: number, extra: Record<string, unknown> = {}): Record<string, unknown> => {
        const collapsed: boolean = collapsedFolderIds.has(id)
        return collapsed
            ? { id, isFolderNode: true, folderLabel: label, collapsed: true, childCount, ...extra }
            : { id, isFolderNode: true, folderLabel: label, ...extra }
    }

    const elements: cytoscape.ElementDefinition[] = []

    // /notes folder + 3 leaves
    elements.push({ data: folderData('notes', '/notes', 3) as cytoscape.NodeDataDefinition })
    if (!collapsedFolderIds.has('notes')) {
        elements.push({ data: { id: 'notes/architecture.md', parent: 'notes', label: 'architecture' }, position: { x: 220, y: 220 } })
        elements.push({ data: { id: 'notes/auth.md',          parent: 'notes', label: 'auth flow' },     position: { x: 400, y: 220 } })
        elements.push({ data: { id: 'notes/openq.md',         parent: 'notes', label: 'open questions' }, position: { x: 310, y: 340 } })
    }

    // /diagrams folder + 2 leaves
    elements.push({ data: folderData('diagrams', '/diagrams', 2) as cytoscape.NodeDataDefinition })
    if (!collapsedFolderIds.has('diagrams')) {
        elements.push({ data: { id: 'diagrams/system.md',   parent: 'diagrams', label: 'system' },    position: { x: 600, y: 230 } })
        elements.push({ data: { id: 'diagrams/sequence.md', parent: 'diagrams', label: 'sequence' }, position: { x: 720, y: 330 } })
    }

    // /retros folder — collapsed by default in the seed set (childCount appears on pill)
    elements.push({ data: folderData('retros', '/retros', 4) as cytoscape.NodeDataDefinition, position: { x: 880, y: 220 } })

    // Free leaf
    elements.push({ data: { id: 'inbox.md', label: 'inbox' }, position: { x: 110, y: 110 } })

    // Cross-folder edges (only valid when both ends exist)
    if (!collapsedFolderIds.has('notes') && !collapsedFolderIds.has('diagrams')) {
        elements.push({ data: { id: 'e1', source: 'notes/architecture.md', target: 'notes/auth.md' } })
        elements.push({ data: { id: 'e2', source: 'notes/auth.md',         target: 'diagrams/system.md' } })
    }
    return elements
}
