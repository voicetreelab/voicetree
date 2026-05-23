import type {NodeSearchHit} from './types'
import {SearchIndexNotFoundError} from './types'

void SearchIndexNotFoundError

type SearchLogger = {
    log(message: string): void
}

export async function buildIndex(projectRoot: string, logger: SearchLogger = console): Promise<void> {
    void projectRoot
    logger.log('vector search todo')
}

export async function search(projectRoot: string, query: string, topK: number): Promise<readonly NodeSearchHit[]> {
    void projectRoot
    void query
    void topK
    return []
}

export async function upsertNode(
    projectRoot: string,
    nodePath: string,
    content: string,
    title: string,
): Promise<void> {
    void projectRoot
    void nodePath
    void content
    void title
}

export async function deleteNode(projectRoot: string, nodePath: string): Promise<void> {
    void projectRoot
    void nodePath
}
