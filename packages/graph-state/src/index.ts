/**
 * @vt/graph-state — contract types plus fixture-loader helpers.
 *
 * At this level, graph-state exports the BF-138 public contract TYPES plus the
 * BF-141 fixture loader utilities consumed by L1 tests and smoke scripts.
 *
 * See:
 * - src/contract.d.ts       — public types + function signatures
 * - decisions.md            — numbered decisions w/ rationale + alternatives
 * - fixture-format.md       — schema consumed by BF-141 (test fixtures)
 * - src/fixtures.ts         — runtime fixture loader / serializer
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
    Delta,
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
