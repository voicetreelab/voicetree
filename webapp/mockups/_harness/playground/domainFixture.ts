// Real domain-layer fixture for the playground.
//
// Produces a real @vt/graph-model `Graph` (built via the actual
// buildGraphFromFiles parser) plus a real `FolderTreeNode` tree and a
// `VaultState`. These feed the in-browser daemon stub, which runs the real
// graph-state `project()` to produce the ProjectedGraph the renderer consumes.
//
// No cytoscape element definitions here — those are the OUTPUT of the
// projection pipeline, not the input.

import { buildGraphFromFiles, type Graph } from '@vt/graph-model'
import type { FolderTreeNode } from '@vt/graph-model/folders'
import { toAbsolutePath } from '@vt/graph-model/folders'
import type { VaultState } from '@vt/graph-db-protocol'

export interface PlaygroundFixture {
    readonly vault: VaultState
    readonly graph: Graph
    readonly folderTree: FolderTreeNode
    readonly initialCollapsedFolderIds: ReadonlySet<string>
    /** Suggested cytoscape positions keyed by file-node absolute path. */
    readonly positions: ReadonlyMap<string, { readonly x: number; readonly y: number }>
}

const VAULT_PATH: string = '/vault'

interface Seed {
    readonly absolutePath: string
    readonly content: string
    readonly position: { readonly x: number; readonly y: number }
}

// Each folder gets an `index.md` "folder note" so production's
// `getFolderNotePath(graph, folderId)` resolves to real content. Without this,
// hover/click on a folder pill silently returns (HoverEditor.ts:255 / the
// daemon `getNode` stub for the raw folder ID returns undefined).
const seeds: readonly Seed[] = [
    {
        absolutePath: `${VAULT_PATH}/inbox.md`,
        content: '# inbox\nfree-floating note at vault root',
        position: { x: 110, y: 110 },
    },
    {
        absolutePath: `${VAULT_PATH}/notes/index.md`,
        content: '# notes\nfolder note for the notes/ directory.\n\nholds [[architecture]], [[auth flow]], [[open questions]].',
        position: { x: 220, y: 110 },
    },
    {
        absolutePath: `${VAULT_PATH}/notes/architecture.md`,
        content: '# architecture\nlinks to [[auth flow]]',
        position: { x: 220, y: 220 },
    },
    {
        absolutePath: `${VAULT_PATH}/notes/auth flow.md`,
        content: '# auth flow\nrefers to [[system]]',
        position: { x: 400, y: 220 },
    },
    {
        absolutePath: `${VAULT_PATH}/notes/open questions.md`,
        content: '# open questions\nopen items',
        position: { x: 310, y: 340 },
    },
    {
        absolutePath: `${VAULT_PATH}/diagrams/index.md`,
        content: '# diagrams\nfolder note for the diagrams/ directory.\n\nholds [[system]] and [[sequence]].',
        position: { x: 660, y: 110 },
    },
    {
        absolutePath: `${VAULT_PATH}/diagrams/system.md`,
        content: '# system\nsystem diagram',
        position: { x: 600, y: 230 },
    },
    {
        absolutePath: `${VAULT_PATH}/diagrams/sequence.md`,
        content: '# sequence\nsequence diagram',
        position: { x: 720, y: 330 },
    },
    {
        absolutePath: `${VAULT_PATH}/retros/index.md`,
        content: '# retros\nfolder note for the retros/ directory.\n\nq1-q4 retrospectives.',
        position: { x: 880, y: 110 },
    },
    {
        absolutePath: `${VAULT_PATH}/retros/q1.md`,
        content: '# q1 retro',
        position: { x: 880, y: 160 },
    },
    {
        absolutePath: `${VAULT_PATH}/retros/q2.md`,
        content: '# q2 retro',
        position: { x: 880, y: 240 },
    },
    {
        absolutePath: `${VAULT_PATH}/retros/q3.md`,
        content: '# q3 retro',
        position: { x: 880, y: 320 },
    },
    {
        absolutePath: `${VAULT_PATH}/retros/q4.md`,
        content: '# q4 retro',
        position: { x: 880, y: 400 },
    },

    // Nested: projects/ → web/ → auth/  (3 levels deep, handful of notes each)
    {
        absolutePath: `${VAULT_PATH}/projects/index.md`,
        content: '# projects\nfolder note for projects/.\n\ntop-level container for [[alpha]], [[beta]], and the [[web]] subfolder.',
        position: { x: 1100, y: 110 },
    },
    {
        absolutePath: `${VAULT_PATH}/projects/alpha.md`,
        content: '# alpha\nfirst project — links to [[architecture]]',
        position: { x: 1040, y: 220 },
    },
    {
        absolutePath: `${VAULT_PATH}/projects/beta.md`,
        content: '# beta\nsecond project',
        position: { x: 1160, y: 220 },
    },
    {
        absolutePath: `${VAULT_PATH}/projects/web/index.md`,
        content: '# web\nfolder note for projects/web/.\n\nholds [[api]], [[ui]], and the [[auth]] subfolder.',
        position: { x: 1340, y: 110 },
    },
    {
        absolutePath: `${VAULT_PATH}/projects/web/api.md`,
        content: '# api\nrest + graphql surface',
        position: { x: 1280, y: 220 },
    },
    {
        absolutePath: `${VAULT_PATH}/projects/web/ui.md`,
        content: '# ui\nreact + cytoscape',
        position: { x: 1400, y: 220 },
    },
    {
        absolutePath: `${VAULT_PATH}/projects/web/auth/index.md`,
        content: '# auth\nfolder note for projects/web/auth/.\n\ncovers [[login]], [[signup]], [[tokens]].',
        position: { x: 1580, y: 110 },
    },
    {
        absolutePath: `${VAULT_PATH}/projects/web/auth/login.md`,
        content: '# login\npassword + sso',
        position: { x: 1520, y: 220 },
    },
    {
        absolutePath: `${VAULT_PATH}/projects/web/auth/signup.md`,
        content: '# signup\nemail verification flow',
        position: { x: 1640, y: 220 },
    },
    {
        absolutePath: `${VAULT_PATH}/projects/web/auth/tokens.md`,
        content: '# tokens\nrefresh + revocation, links to [[auth flow]]',
        position: { x: 1580, y: 330 },
    },
]

function buildFolderTree(): FolderTreeNode {
    const fileChild = (absolutePath: string): { readonly name: string; readonly absolutePath: ReturnType<typeof toAbsolutePath>; readonly isInGraph: true } => {
        const lastSlash: number = absolutePath.lastIndexOf('/')
        const name: string = absolutePath.slice(lastSlash + 1)
        return { name, absolutePath: toAbsolutePath(absolutePath), isInGraph: true }
    }
    const folder = (
        absolutePath: string,
        name: string,
        children: readonly (FolderTreeNode | ReturnType<typeof fileChild>)[],
    ): FolderTreeNode => ({
        name,
        absolutePath: toAbsolutePath(absolutePath),
        children,
        loadState: 'loaded',
        isWriteTarget: false,
    })

    return folder(VAULT_PATH, 'vault', [
        fileChild(`${VAULT_PATH}/inbox.md`),
        folder(`${VAULT_PATH}/notes`, 'notes', [
            fileChild(`${VAULT_PATH}/notes/index.md`),
            fileChild(`${VAULT_PATH}/notes/architecture.md`),
            fileChild(`${VAULT_PATH}/notes/auth flow.md`),
            fileChild(`${VAULT_PATH}/notes/open questions.md`),
        ]),
        folder(`${VAULT_PATH}/diagrams`, 'diagrams', [
            fileChild(`${VAULT_PATH}/diagrams/index.md`),
            fileChild(`${VAULT_PATH}/diagrams/system.md`),
            fileChild(`${VAULT_PATH}/diagrams/sequence.md`),
        ]),
        folder(`${VAULT_PATH}/retros`, 'retros', [
            fileChild(`${VAULT_PATH}/retros/index.md`),
            fileChild(`${VAULT_PATH}/retros/q1.md`),
            fileChild(`${VAULT_PATH}/retros/q2.md`),
            fileChild(`${VAULT_PATH}/retros/q3.md`),
            fileChild(`${VAULT_PATH}/retros/q4.md`),
        ]),
        folder(`${VAULT_PATH}/projects`, 'projects', [
            fileChild(`${VAULT_PATH}/projects/index.md`),
            fileChild(`${VAULT_PATH}/projects/alpha.md`),
            fileChild(`${VAULT_PATH}/projects/beta.md`),
            folder(`${VAULT_PATH}/projects/web`, 'web', [
                fileChild(`${VAULT_PATH}/projects/web/index.md`),
                fileChild(`${VAULT_PATH}/projects/web/api.md`),
                fileChild(`${VAULT_PATH}/projects/web/ui.md`),
                folder(`${VAULT_PATH}/projects/web/auth`, 'auth', [
                    fileChild(`${VAULT_PATH}/projects/web/auth/index.md`),
                    fileChild(`${VAULT_PATH}/projects/web/auth/login.md`),
                    fileChild(`${VAULT_PATH}/projects/web/auth/signup.md`),
                    fileChild(`${VAULT_PATH}/projects/web/auth/tokens.md`),
                ]),
            ]),
        ]),
    ])
}

export function buildPlaygroundFixture(): PlaygroundFixture {
    const graph: Graph = buildGraphFromFiles(
        seeds.map(({ absolutePath, content }) => ({ absolutePath, content })),
    )
    const folderTree: FolderTreeNode = buildFolderTree()
    const vault: VaultState = {
        projectRoot: VAULT_PATH,
        writeFolderPath: VAULT_PATH,
        readPaths: [],
    }
    const positions: Map<string, { x: number; y: number }> = new Map(
        seeds.map((s): readonly [string, { x: number; y: number }] => [s.absolutePath, s.position] as const),
    )
    const initialCollapsedFolderIds: Set<string> = new Set<string>([`${VAULT_PATH}/retros/`])
    return { vault, graph, folderTree, initialCollapsedFolderIds, positions }
}
