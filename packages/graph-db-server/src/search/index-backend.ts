import type {NodeSearchHit} from './types'
import {SearchIndexNotFoundError} from './types'

void SearchIndexNotFoundError

export async function buildIndex(vaultPath: string): Promise<void> {
    void vaultPath
    console.log('vector search todo')
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
