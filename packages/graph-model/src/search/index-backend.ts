import {mkdir, readFile, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {scanMarkdownFiles} from '../graph/loadGraphFromDisk'
import {contentAfterTitle, markdownToTitle, stripMarkdownFormatting} from '../pure/graph/markdown-parsing/markdown-to-title'
import type {NodeSearchHit, SearchBackend} from './types'
import {SearchIndexNotFoundError} from './types'

const SEARCH_DIRNAME = '.vt-search'
const SEARCH_FILENAME = 'index.json'
const SEARCH_INDEX_VERSION = 1

type PersistedNodeRecord = {
    nodePath: string
    title: string
    body: string
    normalizedBody: string
}

type PersistedSearchIndex = {
    version: number
    nodes: Record<string, PersistedNodeRecord>
}

function getIndexRoot(vaultPath: string): string {
    return path.join(vaultPath, SEARCH_DIRNAME)
}

function getIndexPath(vaultPath: string): string {
    return path.join(getIndexRoot(vaultPath), SEARCH_FILENAME)
}

function normalizeSearchText(text: string): string {
    return stripMarkdownFormatting(text)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ')
}

function countOccurrences(text: string, query: string): number {
    if (!query) {
        return 0
    }

    let count = 0
    let startIndex = 0

    while (startIndex < text.length) {
        const matchIndex = text.indexOf(query, startIndex)
        if (matchIndex < 0) {
            break
        }

        count += 1
        startIndex = matchIndex + query.length
    }

    return count
}

function buildSearchRecord(nodePath: string, content: string, explicitTitle?: string): PersistedNodeRecord {
    const title: string = explicitTitle?.trim() || markdownToTitle(content, nodePath)
    const body: string = contentAfterTitle(content).trim()
    const normalizedBody: string = normalizeSearchText(body)

    return {
        nodePath,
        title,
        body,
        normalizedBody,
    }
}

function createEmptyIndex(): PersistedSearchIndex {
    return {
        version: SEARCH_INDEX_VERSION,
        nodes: {},
    }
}

function createSnippet(body: string, normalizedQuery: string): string {
    const trimmedBody: string = body.trim()
    if (!trimmedBody) {
        return ''
    }

    const queryTerms: readonly string[] = normalizedQuery.split(' ').filter(Boolean)
    const bodyLines: readonly string[] = trimmedBody.split('\n').map(line => line.trim()).filter(Boolean)

    for (const line of bodyLines) {
        const normalizedLine: string = normalizeSearchText(line)
        if (normalizedLine.includes(normalizedQuery) || queryTerms.some(term => normalizedLine.includes(term))) {
            return line.slice(0, 240)
        }
    }

    return bodyLines[0]?.slice(0, 240) ?? ''
}

function computeScore(record: PersistedNodeRecord, normalizedQuery: string): number {
    if (!normalizedQuery) {
        return 0
    }

    const exactPhraseMatches: number = countOccurrences(record.normalizedBody, normalizedQuery)
    const queryTerms: readonly string[] = normalizedQuery.split(' ').filter(Boolean)
    const termCounts: readonly number[] = queryTerms.map((term: string) => countOccurrences(record.normalizedBody, term))
    const hasEveryTerm: boolean = termCounts.every((count: number) => count > 0)
    const termMatches: number = termCounts.reduce((sum: number, count: number) => sum + count, 0)

    if (exactPhraseMatches === 0 && !hasEveryTerm) {
        return 0
    }

    return exactPhraseMatches * 100 + termMatches
}

async function saveIndex(vaultPath: string, index: PersistedSearchIndex): Promise<void> {
    const indexRoot: string = getIndexRoot(vaultPath)
    const indexPath: string = getIndexPath(vaultPath)

    await mkdir(indexRoot, {recursive: true})
    await writeFile(indexPath, JSON.stringify(index, null, 2), 'utf8')
}

async function loadIndex(vaultPath: string): Promise<PersistedSearchIndex> {
    const indexPath: string = getIndexPath(vaultPath)

    try {
        const rawIndex: string = await readFile(indexPath, 'utf8')
        const parsedIndex: unknown = JSON.parse(rawIndex)
        if (
            typeof parsedIndex !== 'object'
            || parsedIndex === null
            || !('nodes' in parsedIndex)
            || typeof parsedIndex.nodes !== 'object'
            || parsedIndex.nodes === null
        ) {
            return createEmptyIndex()
        }

        return parsedIndex as PersistedSearchIndex
    } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new SearchIndexNotFoundError(vaultPath, indexPath)
        }

        throw error
    }
}

async function loadIndexForMutation(vaultPath: string): Promise<PersistedSearchIndex> {
    try {
        return await loadIndex(vaultPath)
    } catch (error: unknown) {
        if (error instanceof SearchIndexNotFoundError) {
            return createEmptyIndex()
        }

        throw error
    }
}

export class SearchBackendImpl implements SearchBackend {
    async buildIndex(vaultPath: string): Promise<void> {
        const relativePaths: readonly string[] = await scanMarkdownFiles(vaultPath)
        const markdownPaths: readonly string[] = relativePaths.filter(relativePath => relativePath.endsWith('.md'))
        const entries: Array<[string, PersistedNodeRecord]> = await Promise.all(
            markdownPaths.map(async (relativePath: string) => {
                const nodePath: string = path.resolve(vaultPath, relativePath)
                const content: string = await readFile(nodePath, 'utf8')
                return [nodePath, buildSearchRecord(nodePath, content)]
            })
        )

        const index: PersistedSearchIndex = createEmptyIndex()
        index.nodes = Object.fromEntries(entries)

        await saveIndex(vaultPath, index)
    }

    async search(vaultPath: string, query: string, topK: number): Promise<readonly NodeSearchHit[]> {
        const normalizedQuery: string = normalizeSearchText(query)
        if (!normalizedQuery) {
            return []
        }

        const index: PersistedSearchIndex = await loadIndex(vaultPath)
        const hits: NodeSearchHit[] = Object.values(index.nodes)
            .map((record: PersistedNodeRecord) => {
                const score: number = computeScore(record, normalizedQuery)
                return {
                    nodePath: record.nodePath,
                    title: record.title,
                    score,
                    snippet: createSnippet(record.body, normalizedQuery),
                }
            })
            .filter((hit: NodeSearchHit) => hit.score > 0)
            .sort((left: NodeSearchHit, right: NodeSearchHit) => {
                if (right.score !== left.score) {
                    return right.score - left.score
                }

                return left.nodePath.localeCompare(right.nodePath)
            })

        return hits.slice(0, Math.max(0, topK))
    }

    async upsertNode(vaultPath: string, nodePath: string, content: string, title: string): Promise<void> {
        const index: PersistedSearchIndex = await loadIndexForMutation(vaultPath)
        index.nodes[nodePath] = buildSearchRecord(nodePath, content, title)
        await saveIndex(vaultPath, index)
    }

    async deleteNode(vaultPath: string, nodePath: string): Promise<void> {
        const index: PersistedSearchIndex = await loadIndexForMutation(vaultPath)
        delete index.nodes[nodePath]
        await saveIndex(vaultPath, index)
    }
}

export function createSearchBackend(): SearchBackend {
    return new SearchBackendImpl()
}

export const createSearchIndexBackend = createSearchBackend
export const createBackend = createSearchBackend
export const buildBackend = createSearchBackend
export const IndexBackend = SearchBackendImpl

export default createSearchBackend
