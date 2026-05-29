// Real domain-layer fixture for the playground.
//
// Produces a real @vt/graph-model `Graph` (built via the actual
// buildGraphFromFiles parser) plus a real `FolderTreeNode` tree and a
// `ProjectState`. These feed the in-browser daemon stub, which runs the real
// graph-state `project()` to produce the ProjectedGraph the renderer consumes.
//
// No cytoscape element definitions here — those are the OUTPUT of the
// projection pipeline, not the input.

import { buildGraphFromFiles, type Graph } from '@vt/graph-model'
import type { FolderTreeNode } from '@vt/graph-model/folders'
import { toAbsolutePath } from '@vt/graph-model/folders'
import type { ProjectState } from '@vt/graph-db-protocol'

export interface PlaygroundFixture {
    readonly project: ProjectState
    readonly graph: Graph
    readonly folderTree: FolderTreeNode
    readonly initialCollapsedFolderIds: ReadonlySet<string>
    /** Suggested cytoscape positions keyed by file-node absolute path. */
    readonly positions: ReadonlyMap<string, { readonly x: number; readonly y: number }>
}

const PROJECT_PATH: string = '/project'

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
        absolutePath: `${PROJECT_PATH}/inbox.md`,
        content: '# inbox\nfree-floating note at project root',
        position: { x: 110, y: 110 },
    },
    {
        absolutePath: `${PROJECT_PATH}/notes/index.md`,
        content: '# notes\nfolder note for the notes/ directory.\n\nholds [[architecture]], [[auth flow]], [[open questions]].',
        position: { x: 220, y: 110 },
    },
    {
        absolutePath: `${PROJECT_PATH}/notes/architecture.md`,
        content: '# architecture\nlinks to [[auth flow]]',
        position: { x: 220, y: 220 },
    },
    {
        absolutePath: `${PROJECT_PATH}/notes/auth flow.md`,
        content: '# auth flow\nrefers to [[system]]',
        position: { x: 400, y: 220 },
    },
    {
        absolutePath: `${PROJECT_PATH}/notes/open questions.md`,
        content: '# open questions\nopen items',
        position: { x: 310, y: 340 },
    },
    {
        absolutePath: `${PROJECT_PATH}/diagrams/index.md`,
        content: '# diagrams\nfolder note for the diagrams/ directory.\n\nholds [[system]] and [[sequence]].',
        position: { x: 660, y: 110 },
    },
    {
        absolutePath: `${PROJECT_PATH}/diagrams/system.md`,
        content: '# system\nsystem diagram',
        position: { x: 600, y: 230 },
    },
    {
        absolutePath: `${PROJECT_PATH}/diagrams/sequence.md`,
        content: '# sequence\nsequence diagram',
        position: { x: 720, y: 330 },
    },
    {
        absolutePath: `${PROJECT_PATH}/retros/index.md`,
        content: '# retros\nfolder note for the retros/ directory.\n\nq1-q4 retrospectives.',
        position: { x: 880, y: 110 },
    },
    {
        absolutePath: `${PROJECT_PATH}/retros/q1.md`,
        content: '# q1 retro',
        position: { x: 880, y: 160 },
    },
    {
        absolutePath: `${PROJECT_PATH}/retros/q2.md`,
        content: '# q2 retro',
        position: { x: 880, y: 240 },
    },
    {
        absolutePath: `${PROJECT_PATH}/retros/q3.md`,
        content: '# q3 retro',
        position: { x: 880, y: 320 },
    },
    {
        absolutePath: `${PROJECT_PATH}/retros/q4.md`,
        content: '# q4 retro',
        position: { x: 880, y: 400 },
    },

    // Nested: projects/ → web/ → auth/  (3 levels deep, handful of notes each)
    {
        absolutePath: `${PROJECT_PATH}/projects/index.md`,
        content: '# projects\nfolder note for projects/.\n\ntop-level container for [[alpha]], [[beta]], and the [[web]] subfolder.',
        position: { x: 1100, y: 110 },
    },
    {
        absolutePath: `${PROJECT_PATH}/projects/alpha.md`,
        content: '# alpha\nfirst project — links to [[architecture]]',
        position: { x: 1040, y: 220 },
    },
    {
        absolutePath: `${PROJECT_PATH}/projects/beta.md`,
        content: '# beta\nsecond project',
        position: { x: 1160, y: 220 },
    },
    {
        absolutePath: `${PROJECT_PATH}/projects/web/index.md`,
        content: '# web\nfolder note for projects/web/.\n\nholds [[api]], [[ui]], and the [[auth]] subfolder.',
        position: { x: 1340, y: 110 },
    },
    {
        absolutePath: `${PROJECT_PATH}/projects/web/api.md`,
        content: '# api\nrest + graphql surface',
        position: { x: 1280, y: 220 },
    },
    {
        absolutePath: `${PROJECT_PATH}/projects/web/ui.md`,
        content: '# ui\nreact + cytoscape',
        position: { x: 1400, y: 220 },
    },
    {
        absolutePath: `${PROJECT_PATH}/projects/web/auth/index.md`,
        content: '# auth\nfolder note for projects/web/auth/.\n\ncovers [[login]], [[signup]], [[tokens]].',
        position: { x: 1580, y: 110 },
    },
    {
        absolutePath: `${PROJECT_PATH}/projects/web/auth/login.md`,
        content: '# login\npassword + sso',
        position: { x: 1520, y: 220 },
    },
    {
        absolutePath: `${PROJECT_PATH}/projects/web/auth/signup.md`,
        content: '# signup\nemail verification flow',
        position: { x: 1640, y: 220 },
    },
    {
        absolutePath: `${PROJECT_PATH}/projects/web/auth/tokens.md`,
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

    return folder(PROJECT_PATH, 'project', [
        fileChild(`${PROJECT_PATH}/inbox.md`),
        folder(`${PROJECT_PATH}/notes`, 'notes', [
            fileChild(`${PROJECT_PATH}/notes/index.md`),
            fileChild(`${PROJECT_PATH}/notes/architecture.md`),
            fileChild(`${PROJECT_PATH}/notes/auth flow.md`),
            fileChild(`${PROJECT_PATH}/notes/open questions.md`),
        ]),
        folder(`${PROJECT_PATH}/diagrams`, 'diagrams', [
            fileChild(`${PROJECT_PATH}/diagrams/index.md`),
            fileChild(`${PROJECT_PATH}/diagrams/system.md`),
            fileChild(`${PROJECT_PATH}/diagrams/sequence.md`),
        ]),
        folder(`${PROJECT_PATH}/retros`, 'retros', [
            fileChild(`${PROJECT_PATH}/retros/index.md`),
            fileChild(`${PROJECT_PATH}/retros/q1.md`),
            fileChild(`${PROJECT_PATH}/retros/q2.md`),
            fileChild(`${PROJECT_PATH}/retros/q3.md`),
            fileChild(`${PROJECT_PATH}/retros/q4.md`),
        ]),
        folder(`${PROJECT_PATH}/projects`, 'projects', [
            fileChild(`${PROJECT_PATH}/projects/index.md`),
            fileChild(`${PROJECT_PATH}/projects/alpha.md`),
            fileChild(`${PROJECT_PATH}/projects/beta.md`),
            folder(`${PROJECT_PATH}/projects/web`, 'web', [
                fileChild(`${PROJECT_PATH}/projects/web/index.md`),
                fileChild(`${PROJECT_PATH}/projects/web/api.md`),
                fileChild(`${PROJECT_PATH}/projects/web/ui.md`),
                folder(`${PROJECT_PATH}/projects/web/auth`, 'auth', [
                    fileChild(`${PROJECT_PATH}/projects/web/auth/index.md`),
                    fileChild(`${PROJECT_PATH}/projects/web/auth/login.md`),
                    fileChild(`${PROJECT_PATH}/projects/web/auth/signup.md`),
                    fileChild(`${PROJECT_PATH}/projects/web/auth/tokens.md`),
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
    const project: ProjectState = {
        projectRoot: PROJECT_PATH,
        writeFolderPath: PROJECT_PATH,
        readPaths: [],
    }
    const positions: Map<string, { x: number; y: number }> = new Map(
        seeds.map((s): readonly [string, { x: number; y: number }] => [s.absolutePath, s.position] as const),
    )
    const initialCollapsedFolderIds: Set<string> = new Set<string>([`${PROJECT_PATH}/retros/`])
    return { project, graph, folderTree, initialCollapsedFolderIds, positions }
}
