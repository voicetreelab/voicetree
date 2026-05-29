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
    Select,
    Deselect,
    AddNode,
    RemoveNode,
    AddEdge,
    RemoveEdge,
    Move,
    SetFolderState,
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
    applyCommandAsync,
    applyCommandAsyncWithDelta,
    emptyState,
} from './applyCommand'

export {
    FIXTURES_DIR,
    SNAPSHOTS_DIR,
    SEQUENCES_DIR,
    PROJECTIONS_DIR,
    REAL_PROJECT_FIXTURE_ID,
    REAL_PROJECT_CANONICAL_ROOT,
    collectLayoutPositions,
    serializeState,
    serializeCommand,
    hydrateState,
    hydrateCommand,
    readSnapshotDocument,
    listSnapshotDocuments,
    listSequenceDocuments,
    listProjectionDocuments,
    loadSnapshot,
    loadSequence,
    loadProjection,
    loadFixture,
    buildStateFromProject,
    snapshotStateFromProject,
    toFixtureJson,
} from './fixtures'

export { project } from './project'

export {
    createLayoutStore,
    getLayoutStoreSingleton,
    getLayout,
    dispatchSetZoom,
    dispatchSetPan,
    dispatchSetPositions,
    dispatchRequestFit,
    subscribeLayout,
    flushLayout,
    _resetLayoutStoreForTests,
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
    ensureTrailingSlash,
    stripTrailingSlash,
} from './state/folderVisibility/path'

export {
    deriveImplicitRoots,
    deriveWatchRoots,
} from './state/folderVisibility/implicitRoots'

export type {
    AbsolutePath,
    FolderState,
    FolderVisibilityState,
} from './state/folderVisibility/types'

export {
    configureFolderVisibilityStore,
    clearFolderVisibilityStoreForTests,
    getFolderVisibility,
    setFolderState,
    setFolderStateBatch,
    own,
    effective,
    onFolderStateChanged,
} from './state/folderVisibilityStore'

export type {
    FolderVisibilityDatabase,
    FolderVisibilityUpdate,
    FolderStateChangedListener,
} from './state/folderVisibilityStore'

export {
    applySetFolderState,
} from './apply/folderVisibility'

export {
    configureRootIO,
    clearRootIOForTests,
} from './rootIO'

export type {
    RootIO,
} from './rootIO'

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
