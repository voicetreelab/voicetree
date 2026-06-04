/**
 * Electron-edge adapter for the "Run Agent on Selected Nodes" gesture.
 *
 * The orchestration is shared with browser mode (see
 * @/shell/agent/runAgentOnSelectedNodes); this module only supplies the
 * Electron-flavoured effects — the daemon IPC proxy and the vt-daemon client.
 */

import {
    orchestrateRunAgentOnSelectedNodes,
    type RunAgentOnSelectedParams,
    type RunAgentOnSelectedResult,
} from '@/shell/agent/orchestrateRunAgent'
import {getWriteFolderPath} from '@/shell/edge/main/graph/watch_folder/watchFolder'
import {spawnTerminalWithContextNode} from '@vt/vt-daemon-client'
import {getVtDaemonClient} from '@/shell/edge/main/runtime/electron/daemon/daemon-url-binding'
import {getGraphFromDaemon, postDeltaThroughDaemonWithEditors} from '@/shell/edge/main/runtime/electron/daemon/ipc/daemon-ipc-proxy'

export function runAgentOnSelectedNodes(
    params: RunAgentOnSelectedParams,
): Promise<RunAgentOnSelectedResult> {
    return orchestrateRunAgentOnSelectedNodes(params, {
        getGraph: getGraphFromDaemon,
        getWriteFolderPath,
        applyTaskNodeDelta: postDeltaThroughDaemonWithEditors,
        spawnAgentTerminal: (req) => spawnTerminalWithContextNode(getVtDaemonClient(), req),
    })
}
