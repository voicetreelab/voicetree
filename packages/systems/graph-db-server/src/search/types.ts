export type NodeSearchHit = {
    nodePath: string
    title: string
    score: number
    snippet: string
}

export interface SearchBackend {
    buildIndex(projectRoot: string): Promise<void>
    search(projectRoot: string, query: string, topK: number): Promise<readonly NodeSearchHit[]>
    upsertNode(projectRoot: string, nodePath: string, content: string, title: string): Promise<void>
    deleteNode(projectRoot: string, nodePath: string): Promise<void>
}

export class SearchIndexNotFoundError extends Error {
    readonly projectRoot: string
    readonly indexPath: string

    constructor(projectRoot: string, indexPath: string) {
        super(`No search index found for project "${projectRoot}" at "${indexPath}"`)
        this.name = 'SearchIndexNotFoundError'
        this.projectRoot = projectRoot
        this.indexPath = indexPath
    }
}
