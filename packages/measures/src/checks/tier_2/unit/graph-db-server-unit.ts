import {type CheckDef, npmWorkspaceRun, vitestJsonArgs} from '../../../_types.ts'

export const check: CheckDef = {
    id: 'graph-db-server-unit',
    // tier_2: structurally a unit test, but at 1m34s exceeds tier_1 <30s budget. Split into unit + integration deferred to a separate PR.
    name: 'Graph DB Server Unit',
    category: 'Unit',
    display: 'npm --workspace @vt/graph-db-server run test',
    args: (jsonOut) => npmWorkspaceRun('@vt/graph-db-server', 'test', vitestJsonArgs(jsonOut)),
    parser: 'vitest',
    // Long black-box daemon/fuzz tests flake under nested full-suite parallelism.
    exclusive: true,
}
