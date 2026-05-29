import {error} from '../cliDeps'
import {parseGraphIndexArgs, parseGraphSearchArgs} from '../core/args'

/**
 * Semantic graph indexing is not yet implemented. The backend `buildIndex`
 * (graph-db-server/search/index-backend.ts) only logs a TODO and writes no
 * index, so reporting success here — or printing an index path that does not
 * exist on disk — would be dishonest. We parse args for early validation, then
 * fail with an explicit "not yet available" message so an agent can tell
 * "unimplemented" apart from "no matches".
 */
export async function graphIndex(terminalId: string | undefined, args: string[]): Promise<void> {
    void terminalId

    const projectRoot: string = parseGraphIndexArgs(args)
    void projectRoot

    error(
        'vt graph index is not yet available: the semantic search index is unimplemented (the backend writes no index). ' +
            'No index was built.',
    )
}

/**
 * Semantic graph search is not yet implemented. The backend `search`
 * (graph-db-server/search/index-backend.ts) returns an empty array for every
 * query regardless of project contents, so emitting `hits: []` would be
 * indistinguishable from a genuine no-match result. We fail with an explicit
 * "not yet available" message instead. For the daemon-backed semantic search
 * surface, use the top-level `vt search` command.
 */
export async function graphSearch(terminalId: string | undefined, args: string[]): Promise<void> {
    void terminalId

    const {projectRoot, query, topK} = parseGraphSearchArgs(args)
    void projectRoot
    void query
    void topK

    error(
        'vt graph search is not yet available: the semantic search index is unimplemented (the backend returns no hits for any query). ' +
            'Use `vt search` for the daemon-backed search surface.',
    )
}
