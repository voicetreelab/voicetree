import type {
    Graph,
    GraphDelta,
    NodeIdAndFilePath,
} from '@vt/graph-model/graph'
import type {VTSettings} from '@vt/graph-model/settings'
import type {
    CreateTerminalDataParams,
    TerminalData,
    TerminalId,
} from '@vt/agent-runtime/terminals/terminal-registry/types.ts'

export type {
    CreateTerminalDataParams,
    Graph,
    GraphDelta,
    NodeIdAndFilePath,
    TerminalData,
    TerminalId,
    VTSettings,
}

export type PlainTerminalLaunch = {
    nodeId: NodeIdAndFilePath
    terminalDataParams: CreateTerminalDataParams
}
