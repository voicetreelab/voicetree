import {access, mkdir, stat} from 'node:fs/promises'
import path from 'node:path'
import matter from 'gray-matter'
import {
    buildStemLookup,
    Embedder,
    extractWikiLinks,
    IndexPipeline,
    resolveConfig,
    resolveLink,
    Search as KnowledgeGraphSearch,
    type SearchResult,
    Store,
} from 'knowledge-graph'
import {scanMarkdownFiles} from '../graph/loadGraphFromDisk'
import {contentAfterTitle} from '../pure/graph/markdown-parsing/markdown-to-title'
import type {NodeSearchHit} from './types'
import {SearchIndexNotFoundError} from './types'

const SEARCH_DIRNAME = '.vt-search'
const SEARCH_FILENAME = 'kg.db'

let embedderPromise: Promise<Embedder> | undefined

function getIndexRoot(vaultPath: string): string {
    return path.join(vaultPath, SEARCH_DIRNAME)
}

function getIndexPath(vaultPath: string): string {
    return path.join(getIndexRoot(vaultPath), SEARCH_FILENAME)
}

function getConfig(vaultPath: string): {vaultPath: string; dataDir: string; dbPath: string} {
    return resolveConfig({
        vaultPath,
        dataDir: getIndexRoot(vaultPath),
    })
}

async function getEmbedder(): Promise<Embedder> {
    if (!embedderPromise) {
        embedderPromise = (async (): Promise<Embedder> => {
            const embedder = new Embedder()
            await embedder.init()
            return embedder
        })()
    }

    return embedderPromise
}

function openStore(vaultPath: string): Store {
    return new Store(getConfig(vaultPath).dbPath)
}

async function ensureIndexExists(vaultPath: string): Promise<void> {
    const indexPath = getIndexPath(vaultPath)

    try {
        await access(indexPath)
    } catch {
        throw new SearchIndexNotFoundError(vaultPath, indexPath)
    }
}

function toRelativeNodeId(vaultPath: string, nodePath: string): string {
    const relativePath = path.relative(vaultPath, nodePath)
    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        throw new Error(`Node path "${nodePath}" is not inside vault "${vaultPath}"`)
    }

    return relativePath.split(path.sep).join('/')
}

function toNodeSearchHit(vaultPath: string, result: SearchResult): NodeSearchHit {
    return {
        nodePath: path.resolve(vaultPath, result.nodeId),
        title: result.title,
        score: result.score,
        snippet: result.excerpt,
    }
}

function shouldUseExactTextSearch(query: string): boolean {
    return /[-_/]/.test(query)
}

function createExactSnippet(content: string, query: string): string {
    const normalizedContent = contentAfterTitle(content).replace(/\s+/g, ' ').trim()
    if (!normalizedContent) return ''

    const lowerContent = normalizedContent.toLowerCase()
    const lowerQuery = query.toLowerCase()
    const matchIndex = lowerContent.indexOf(lowerQuery)
    if (matchIndex < 0) {
        return normalizedContent.slice(0, 200)
    }

    const start = Math.max(0, matchIndex - 60)
    const end = Math.min(normalizedContent.length, matchIndex + query.length + 140)
    return normalizedContent.slice(start, end)
}

function searchExactText(store: Store, query: string, limit: number): readonly SearchResult[] {
    const normalizedQuery = query.trim().toLowerCase()
    const rows = store.db.prepare(`
        SELECT id, title, content
        FROM nodes
        ORDER BY title COLLATE NOCASE
    `).all() as Array<{
        id: string
        title: string
        content: string
    }>

    return rows
        .filter(row => contentAfterTitle(row.content ?? '').toLowerCase().includes(normalizedQuery))
        .slice(0, Math.max(0, limit))
        .map((row): SearchResult => ({
            nodeId: row.id,
            title: row.title,
            score: 1,
            excerpt: createExactSnippet(row.content ?? '', query),
        }))
}

function mergeSearchResults(
    vaultPath: string,
    semanticResults: readonly SearchResult[],
    fullTextResults: readonly SearchResult[],
    topK: number,
): readonly NodeSearchHit[] {
    const hitsByNodeId = new Map<string, NodeSearchHit>()

    for (const result of semanticResults) {
        hitsByNodeId.set(result.nodeId, toNodeSearchHit(vaultPath, result))
    }

    for (const result of fullTextResults) {
        if (!hitsByNodeId.has(result.nodeId)) {
            hitsByNodeId.set(result.nodeId, toNodeSearchHit(vaultPath, result))
        }
    }

    return Array.from(hitsByNodeId.values()).slice(0, Math.max(0, topK))
}

async function buildStemLookupForVault(vaultPath: string, nodeIdToInclude: string): Promise<Map<string, string[]>> {
    const markdownPaths = new Set(
        (await scanMarkdownFiles(vaultPath))
            .filter(relativePath => relativePath.endsWith('.md'))
            .map(relativePath => relativePath.split(path.sep).join('/'))
    )
    markdownPaths.add(nodeIdToInclude)
    return buildStemLookup(Array.from(markdownPaths))
}

function extractInlineTags(content: string): string[] {
    const tags = new Set<string>()
    const pattern = /(?<!\w)#([a-zA-Z][\w-/]*)/g
    let match: RegExpExecArray | null

    while ((match = pattern.exec(content)) !== null) {
        tags.add(match[1])
    }

    return Array.from(tags)
}

async function upsertKnowledgeGraphNode(
    vaultPath: string,
    nodePath: string,
    content: string,
    explicitTitle: string,
): Promise<void> {
    const nodeId = toRelativeNodeId(vaultPath, nodePath)
    const stemLookup = await buildStemLookupForVault(vaultPath, nodeId)
    const allPathsSet = new Set(Array.from(stemLookup.values()).flat())
    const store = openStore(vaultPath)

    try {
        let frontmatter: Record<string, unknown>
        let markdownContent: string

        try {
            const parsed = matter(content)
            frontmatter = parsed.data
            markdownContent = parsed.content
        } catch {
            frontmatter = {}
            markdownContent = content
        }

        const inlineTags = extractInlineTags(markdownContent)
        const normalizedFrontmatter = inlineTags.length > 0
            ? {...frontmatter, inline_tags: inlineTags}
            : frontmatter
        const title = explicitTitle.trim()
            || (typeof frontmatter.title === 'string' ? frontmatter.title : path.basename(nodeId, '.md'))

        store.upsertNode({
            id: nodeId,
            title,
            content: markdownContent,
            frontmatter: normalizedFrontmatter,
        })

        const tags = Array.isArray(frontmatter.tags)
            ? frontmatter.tags.filter((tag): tag is string => typeof tag === 'string')
            : []
        const embedding = await (await getEmbedder()).embed(
            Embedder.buildEmbeddingText(title, tags, markdownContent)
        )
        store.upsertEmbedding(nodeId, embedding)

        const paragraphs = markdownContent.split(/\n\n+/)
        const links = extractWikiLinks(markdownContent)
        store.deleteAllEdgesFrom(nodeId)

        for (const link of links) {
            const targetId = resolveLink(link.raw, stemLookup, allPathsSet) ?? `_stub/${link.raw}.md`

            if (!store.getNode(targetId)) {
                store.upsertNode({
                    id: targetId,
                    title: targetId.replace('_stub/', '').replace(/\.md$/, ''),
                    content: '',
                    frontmatter: {_stub: true},
                })
            }

            const context = paragraphs.find(paragraph => paragraph.includes(`[[${link.raw}`))
                ?? paragraphs.find(paragraph => paragraph.includes(link.display ?? link.raw))
                ?? ''

            store.insertEdge({
                sourceId: nodeId,
                targetId,
                context: context.trim(),
            })
        }

        const fileStat = await stat(nodePath).catch(() => undefined)
        store.upsertSync(nodeId, fileStat?.mtimeMs ?? Date.now())
    } finally {
        store.close()
    }
}

function closeStore(store: Store): void {
    try {
        store.close()
    } catch {
        // best effort close; better-sqlite3 throws on double-close
    }
}

export async function buildIndex(vaultPath: string): Promise<void> {
    const config = getConfig(vaultPath)
    await mkdir(config.dataDir, {recursive: true})

    const store = new Store(config.dbPath)
    try {
        const pipeline = new IndexPipeline(store, await getEmbedder())
        await pipeline.index(vaultPath)
    } finally {
        closeStore(store)
    }
}

export async function search(vaultPath: string, query: string, topK: number): Promise<readonly NodeSearchHit[]> {
    if (!query.trim()) return []

    await ensureIndexExists(vaultPath)

    const store = openStore(vaultPath)
    try {
        if (shouldUseExactTextSearch(query)) {
            return searchExactText(store, query, topK).map(result => toNodeSearchHit(vaultPath, result))
        }

        const searcher = new KnowledgeGraphSearch(store, await getEmbedder())
        const semanticResults = await searcher.semantic(query, topK)
        const fullTextResults = (() => {
            try {
                return store.searchFullText(query).slice(0, topK)
            } catch {
                return []
            }
        })()
        return mergeSearchResults(vaultPath, semanticResults, fullTextResults, topK)
    } finally {
        closeStore(store)
    }
}

export async function upsertNode(vaultPath: string, nodePath: string, content: string, title: string): Promise<void> {
    try {
        await ensureIndexExists(vaultPath)
    } catch (error: unknown) {
        if (error instanceof SearchIndexNotFoundError) return
        throw error
    }

    await upsertKnowledgeGraphNode(vaultPath, nodePath, content, title)
}

export async function deleteNode(vaultPath: string, nodePath: string): Promise<void> {
    try {
        await ensureIndexExists(vaultPath)
    } catch (error: unknown) {
        if (error instanceof SearchIndexNotFoundError) return
        throw error
    }

    const store = openStore(vaultPath)
    try {
        store.deleteNode(toRelativeNodeId(vaultPath, nodePath))
    } finally {
        closeStore(store)
    }
}
