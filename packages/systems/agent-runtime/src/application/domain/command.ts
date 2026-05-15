import type {
    GraphDelta,
    PlainTerminalLaunch,
} from './session.ts'

export type Command =
    | { type: 'LaunchTerminalOntoUI'; launch: PlainTerminalLaunch }
    | { type: 'ApplyRuntimeGraphDelta'; graphDelta: GraphDelta }
