/**
 * @vt/graph-state — contract types, fixture-loader helpers, and runtime state primitives.
 *
 * At this level, graph-state exports the BF-138 public contract TYPES, the
 * BF-141 fixture loader utilities, and the runtime state-machine pieces that
 * L1 command tasks add incrementally.
 *
 * See:
 * - src/contract.d.ts       — public types + function signatures
 * - decisions.md            — numbered decisions w/ rationale + alternatives
 * - fixture-format.md       — schema consumed by BF-141 (test fixtures)
 * - src/fixtures.ts         — runtime fixture loader / serializer
 * - src/applyCommand.ts     — runtime command application entrypoints
 */
export type {
    State,
    StateRoots,
    StateLayout,
    StateMetadata,
    Command,
    Collapse,
    Expand,
    Select,
    Deselect,
    AddNode,
    RemoveNode,
    AddEdge,
    RemoveEdge,
    Move,
    LoadRoot,
    UnloadRoot,
    SetZoom,
    SetPan,
    SetPositions,
    RequestFit,
    Delta,
    FolderId,
    RootPath,
    ElementSpec,
    NodeElement,
    EdgeElement,
    ChangeToken,
    Subscription,
    Unsubscribe,
    LiveTransport,
    GraphStateAPI,
} from './contract'

export {
    applyCommand,
    applyCommandWithDelta,
    emptyState,
} from './applyCommand'

export {
    FIXTURES_DIR,
    SNAPSHOTS_DIR,
    SEQUENCES_DIR,
    PROJECTIONS_DIR,
    REAL_VAULT_FIXTURE_ID,
    REAL_VAULT_CANONICAL_ROOT,
    collectLayoutPositions,
    serializeState,
    serializeCommand,
    hydrateState,
    hydrateCommand,
    readSnapshotDocument,
    readSequenceDocument,
    readProjectionDocument,
    listSnapshotDocuments,
    listSequenceDocuments,
    listProjectionDocuments,
    loadSnapshot,
    loadSequence,
    loadProjection,
    loadFixture,
    buildStateFromVault,
    snapshotStateFromVault,
    toFixtureJson,
} from './fixtures'

export { project } from './project'

export {
    createLayoutStore,
} from './state/layoutStore'

export {
    getSelection,
    isSelected,
    dispatchSelect,
    dispatchDeselect,
    subscribeSelection,
    _resetForTests,
} from './state/selectionStore'

export type {
    LayoutStore,
    LayoutStoreOptions,
    LayoutSubscriber,
    LayoutDelta,
    FlushScheduler,
} from './state/layoutStore'

export {
    getLoadedRoots,
    isRootLoaded,
    dispatchLoadRoot,
    dispatchUnloadRoot,
    subscribeLoadedRoots,
    clearLoadedRoots,
} from './state/loadedRootsStore'

export type {
    RootsDelta,
    LoadedRootsSubscriber,
} from './state/loadedRootsStore'

export type {
    SnapshotDocument,
    SequenceDocument,
    ProjectionDocument,
    SerializedState,
    SerializedCommand,
    SnapshotFixture,
    SequenceFixture,
    ProjectionFixture,
} from './fixtures'
