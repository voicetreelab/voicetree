import * as E from 'fp-ts/lib/Either.js'
import * as O from 'fp-ts/lib/Option.js'
import {pipe} from 'fp-ts/lib/function.js'
import {applyGraphDeltaToGraph, rebaseStaleEdgeAdditionDeltas, type Env, type Graph, type GraphDelta} from '@vt/graph-model/graph'
import {resolveInitialPositionsForDelta} from '@vt/graph-model/spatial'
import {nodeLayoutIO} from '@vt/app-config/node-layout-io'
import {apply_graph_deltas_to_db} from './graphActionsToDBEffects'
import {recordUserActionAndSetDeltaHistoryState} from '@vt/graph-db-server/state/undo-store'
import type {Either} from "fp-ts/es6/Either";
import {getGraph, setGraph, getFolderLayout} from "@vt/graph-db-server/state/graph-store";
import {resolveAbsoluteLinkedNodes} from "../loading/loadGraphFromDisk";
import {getProjectRoot} from "@vt/graph-db-server/state/watch-folder-store";
import { loadSettings } from "@vt/app-config/settings";
import {getCallbacks} from '@vt/graph-model'
import { ProjectNotOpenError } from '@vt/graph-db-server/application/errors/projectNotOpen'
import { traceGraphdSpan } from "@vt/graph-db-server/watch-folder/paths/traceGraphdSpan";
import { markRecentDelta } from '@vt/graph-db-server/state/recent-deltas-store'

interface PreparedMemState {
    readonly graph: Graph
    readonly appliedDelta: GraphDelta
}

async function prepareGraphDeltaMemState(
    currentGraph: Graph,
    delta: GraphDelta,
): Promise<PreparedMemState> {
    let appliedDelta: GraphDelta = delta
    let newGraph: Graph = await traceGraphdSpan('daemon.apply-delta.mem.apply-to-graph', async span => {
        span.setAttribute('vt.graph.nodes.before', Object.keys(currentGraph.nodes).length)
        const next = applyGraphDeltaToGraph(currentGraph, appliedDelta);
        span.setAttribute('vt.graph.nodes.after', Object.keys(next.nodes).length)
        return next
    });

    // Resolution is delta-scoped: relative links are healed against loaded nodes
    // by the graph-model edge indexes during applyGraphDeltaToGraph above; the
    // only genuinely-new file loading left is following this delta's *absolute*
    // links (existsSync, loads from anywhere on disk). Skip delete-only deltas —
    // we don't want to re-add a deleted node via its own resolved links.
    const hasAddOrUpdate: boolean = appliedDelta.some(d => d.type === 'UpsertNode');

    if (hasAddOrUpdate) {
        const resolutionDelta: GraphDelta = await traceGraphdSpan('daemon.apply-delta.mem.resolve-links', async span => {
            span.setAttribute('vt.unresolved.size', newGraph.unresolvedLinksIndex.size)
            const r = await resolveAbsoluteLinkedNodes(newGraph, appliedDelta);
            span.setAttribute('vt.resolved.delta.size', r.length)
            return r
        });
        if (resolutionDelta.length > 0) {
            newGraph = applyGraphDeltaToGraph(newGraph, resolutionDelta);
            // Merge resolution delta into original for caller
            appliedDelta = [...appliedDelta, ...resolutionDelta];
        }
    }

    return { graph: newGraph, appliedDelta }
}

function commitGraphDeltaMemState(prepared: PreparedMemState): GraphDelta {
    setGraph(prepared.graph);

    // Fire onNewNode hook (fire-and-forget). Runs for both UI and FS-event paths.
    // The hook only ever fires for brand-new node upserts (UpsertNode with
    // previousNode=None) — the registered dispatcher itself filters to those, so
    // delete-only and edit-only deltas are already no-ops. Gate the settings
    // read on that condition FIRST: loadSettings() hits disk + parses on every
    // call by design, and in steady state edits/deletes/position-writes vastly
    // outnumber node creations, so reading settings on every commit just to
    // discover there is nothing to dispatch is wasted per-mutation IO.
    const introducesNewNode: boolean = prepared.appliedDelta.some(
        d => d.type === 'UpsertNode' && O.isNone(d.previousNode),
    )
    if (introducesNewNode) {
        void loadSettings().then(settings => {
            const hookPath: string | undefined = settings.hooks?.onNewNode
            if (!hookPath || hookPath.startsWith('#')) return
            const onNewNodeHook = getCallbacks().onNewNodeHook
            if (!onNewNodeHook) return
            // Dispatch for each new node upsert
            for (const d of prepared.appliedDelta) {
                if (d.type === 'UpsertNode' && O.isNone(d.previousNode)) {
                    onNewNodeHook(d.nodeToUpsert.absoluteFilePathIsID, prepared.appliedDelta)
                }
            }
        })
    }

    return prepared.appliedDelta
}

/**
 * Applies a delta to the in-memory graph state and resolves any new wikilinks.
 *
 * This is the unified path for both FS events and editor changes.
 * After applying the delta, it resolves any wikilinks that point to files
 * in the watched folder (lazy resolution).
 *
 * @param delta - The delta to apply
 * @returns The merged delta (original + any resolved links) for UI broadcast
 */
export async function applyGraphDeltaToMemState(delta: GraphDelta): Promise<GraphDelta> {
    const currentGraph: Graph = getGraph();
    delta = rebaseStaleEdgeAdditionDeltas(currentGraph, delta);
    const {delta: resolvedDelta, anyResolved} = resolveInitialPositionsForDelta(currentGraph, delta);
    const prepared = await prepareGraphDeltaMemState(currentGraph, resolvedDelta);
    const appliedDelta = commitGraphDeltaMemState(prepared);

    // Persist newly-computed positions synchronously so they survive a daemon
    // crash (without this, positions live only in memory until project-switch /
    // app-exit). Only fires when the resolver actually filled in at least one
    // position; user drags and unrelated updates take the no-op path.
    if (anyResolved) {
        const projectRoot: string | null = getProjectRoot();
        if (projectRoot) nodeLayoutIO.save(prepared.graph, getFolderLayout(), projectRoot);
    }

    return appliedDelta;
}

export function refreshGraphChangeSideEffects(): void {
    const callbacks = getCallbacks()
    callbacks.refreshBadge?.()
}


export async function applyGraphDeltaToDBThroughMemAndUI(
    delta: GraphDelta,
    recordForUndo: boolean = true
): Promise<void> {
    const currentGraph: Graph = getGraph()
    const deltaToApply: GraphDelta = await traceGraphdSpan(
        'daemon.apply-delta.rebase',
        async () => rebaseStaleEdgeAdditionDeltas(currentGraph, delta),
    )

    // Extract watched directory (fail fast at edge)
    const watchedDirectory: string = pipe(
        O.fromNullable(getProjectRoot()),
        O.getOrElseW(() => {
            throw new ProjectNotOpenError()
        })
    )

    const preparedMemState: PreparedMemState = await traceGraphdSpan(
        'daemon.apply-delta.prepare-mem-state',
        async () => await prepareGraphDeltaMemState(
            currentGraph,
            deltaToApply,
        ),
    )

    // Construct env and execute effect (only caller delta goes to DB; linked-node
    // resolution deltas are memory-only projections).
    const env: Env = {projectRoot: watchedDirectory}
    const result: Either<Error, GraphDelta> = await traceGraphdSpan(
        'daemon.apply-delta.db-write',
        async span => {
            span.setAttribute('vt.dbDelta.size', deltaToApply.length)
            return await apply_graph_deltas_to_db(deltaToApply)(env)()
        },
    )

    // Handle errors (fail fast)
    if (E.isLeft(result)) {
        throw result.left
    }

    // Record for undo after the filesystem write succeeds, but before mutating
    // memory, so failed writes do not create undo entries for changes that did
    // not commit.
    if (recordForUndo) {
        await traceGraphdSpan('daemon.apply-delta.record-undo', async () => {
            recordUserActionAndSetDeltaHistoryState(deltaToApply)
        })
    }

    commitGraphDeltaMemState(preparedMemState)

    for (const nodeDelta of deltaToApply) {
        markRecentDelta(nodeDelta)
    }

    refreshGraphChangeSideEffects()
}

/**
 * Apply delta to DB through memory and UI, plus notify floating editors.
 * The floating editor update is delegated to the onFloatingEditorUpdate callback.
 */
export async function applyGraphDeltaToDBThroughMemAndUIAndEditors(
    delta: GraphDelta,
    recordForUndo: boolean = true
): Promise<void> {
    await applyGraphDeltaToDBThroughMemAndUI(delta, recordForUndo)
    getCallbacks().onFloatingEditorUpdate?.(delta)
}
