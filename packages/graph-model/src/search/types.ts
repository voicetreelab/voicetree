export type NodeSearchHit = {
    nodePath: string
    title: string
    score: number
    snippet: string
}

export interface SearchBackend {
    buildIndex(vaultPath: string): Promise<void>
    search(vaultPath: string, query: string, topK: number): Promise<readonly NodeSearchHit[]>
    upsertNode(vaultPath: string, nodePath: string, content: string, title: string): Promise<void>
    deleteNode(vaultPath: string, nodePath: string): Promise<void>
}

export class SearchIndexNotFoundError extends Error {
    readonly vaultPath: string
    readonly indexPath: string

    constructor(vaultPath: string, indexPath: string) {
        super(`No search index found for vault "${vaultPath}" at "${indexPath}"`)
        this.name = 'SearchIndexNotFoundError'
        this.vaultPath = vaultPath
        this.indexPath = indexPath
    }
}
