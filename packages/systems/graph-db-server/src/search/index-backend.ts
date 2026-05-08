import type {NodeSearchHit} from './types'
import {SearchIndexNotFoundError} from './types'

void SearchIndexNotFoundError

type SearchLogger = {
    log(message: string): void
}

export async function buildIndex(vaultPath: string, logger: SearchLogger = console): Promise<void> {
    void vaultPath
    logger.log('vector search todo')
}

export async function search(vaultPath: string, query: string, topK: number): Promise<readonly NodeSearchHit[]> {
    void vaultPath
    void query
    void topK
    return []
}

export async function upsertNode(
    vaultPath: string,
    nodePath: string,
    content: string,
    title: string,
): Promise<void> {
    void vaultPath
    void nodePath
    void content
    void title
}

export async function deleteNode(vaultPath: string, nodePath: string): Promise<void> {
    void vaultPath
    void nodePath
}
