export type DaemonRouteMethod = 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT'

export type CliBackedDaemonRouteSpec = {
  readonly id: string
  readonly method: DaemonRouteMethod
  readonly path: string
}

export type ExemptDaemonRouteSpec = {
  readonly method: DaemonRouteMethod
  readonly path: string
  readonly exemptionReason: string
}

export type DaemonRouteSpec = CliBackedDaemonRouteSpec | ExemptDaemonRouteSpec

export const DAEMON_ROUTE_SPECS = [
  { id: 'session.create', method: 'POST', path: '/sessions' },
  { id: 'session.delete', method: 'DELETE', path: '/sessions/:sessionId' },
  { id: 'session.show', method: 'GET', path: '/sessions/:sessionId' },
  { id: 'session.events', method: 'GET', path: '/sessions/:sessionId/events' },
  { id: 'view.show', method: 'GET', path: '/sessions/:sessionId/state' },
  { id: 'session.folder-state.read', method: 'GET', path: '/sessions/:sessionId/folder-state' },
  { id: 'session.folder-state.set', method: 'PATCH', path: '/sessions/:sessionId/folder-state/:encodedPath' },
  { id: 'session.folder-state.batch', method: 'PATCH', path: '/sessions/:sessionId/folder-state' },
  { id: 'view.selection', method: 'POST', path: '/sessions/:sessionId/selection' },
  { id: 'view.layout', method: 'PUT', path: '/sessions/:sessionId/layout' },
  { id: 'graph.view', method: 'GET', path: '/sessions/:sessionId/view' },
  {
    method: 'GET',
    path: '/sessions/:sessionId/projected-graph',
    exemptionReason:
      '`/sessions/:sessionId/projected-graph` returns the full ProjectedGraph for renderer hydration; internal to the Electron IPC bridge, not a CLI command.',
  },
  {
    method: 'POST',
    path: '/sessions/:sessionId/expand/:folderId',
    exemptionReason:
      '`/sessions/:sessionId/expand/:folderId` stores persistent render-only expand overrides; current CLI uses one-shot `vt graph structure --expand` query params instead.',
  },
  {
    method: 'DELETE',
    path: '/sessions/:sessionId/expand/:folderId',
    exemptionReason:
      '`/sessions/:sessionId/expand/:folderId` clears persistent render-only expand overrides; current CLI has no persistent override command.',
  },
  {
    method: 'GET',
    path: '/health',
    exemptionReason:
      '`/health` exists for readiness, port discovery, and test orchestration; it is not a user-facing `vt` command.',
  },
  {
    method: 'POST',
    path: '/shutdown',
    exemptionReason:
      '`/shutdown` is daemon lifecycle control for teardown and tests; it is not a user-facing `vt` command.',
  },
  { id: 'graph.read', method: 'GET', path: '/graph' },
  { id: 'graph.delta', method: 'POST', path: '/graph/delta' },
  {
    method: 'POST',
    path: '/graph/apply-delta',
    exemptionReason:
      '`/graph/apply-delta` is the option-aware mutation endpoint used by Electron/MCP bridges; the user-facing CLI remains covered by `/graph/delta`.',
  },
  { id: 'graph.delete-node', method: 'DELETE', path: '/graph/node/:encodedNodeId' },
  {
    method: 'POST',
    path: '/graph/reconcile-disk',
    exemptionReason:
      '`/graph/reconcile-disk` is a daemon maintenance endpoint used by Electron startup/tests to remove stale in-memory nodes for files already gone on disk; it is not a user-facing CLI command.',
  },
  {
    method: 'GET',
    path: '/graph/find-file',
    exemptionReason:
      '`/graph/find-file` is a daemon-internal query used by the webapp IPC bridge for wikilink resolution; not a user-facing CLI command.',
  },
  {
    method: 'GET',
    path: '/graph/preview-contained-nodes/:nodeId',
    exemptionReason:
      '`/graph/preview-contained-nodes/:nodeId` computes context node preview highlights for the renderer; not a user-facing CLI command.',
  },
  {
    method: 'POST',
    path: '/graph/context-node',
    exemptionReason:
      '`/graph/context-node` creates transient agent context files for Electron/headless agent workflows; it is not a user-facing CLI command.',
  },
  {
    method: 'POST',
    path: '/graph/context-node-from-question',
    exemptionReason:
      '`/graph/context-node-from-question` creates ask-mode context files for Electron/headless agent workflows; it is not a user-facing CLI command.',
  },
  {
    method: 'POST',
    path: '/graph/context-node-from-selected-nodes',
    exemptionReason:
      '`/graph/context-node-from-selected-nodes` creates transient agent context files for Electron selected-node workflows; it is not a user-facing CLI command.',
  },
  {
    method: 'POST',
    path: '/graph/unseen-nodes-around-context-node',
    exemptionReason:
      '`/graph/unseen-nodes-around-context-node` collects agent context for MCP orchestration; it is not a user-facing CLI command.',
  },
  {
    method: 'PATCH',
    path: '/graph/context-node-contained-ids',
    exemptionReason:
      '`/graph/context-node-contained-ids` updates MCP context-node bookkeeping; it is not a user-facing CLI command.',
  },
  {
    method: 'POST',
    path: '/graph/write-positions',
    exemptionReason:
      '`/graph/write-positions` persists renderer layout coordinates from Electron; it is not a user-facing CLI command.',
  },
  {
    method: 'POST',
    path: '/graph/write-markdown-file',
    exemptionReason:
      '`/graph/write-markdown-file` is the floating markdown editor save endpoint; it writes body text to disk while preserving daemon-owned frontmatter.',
  },
  {
    method: 'POST',
    path: '/graph/undo',
    exemptionReason:
      '`/graph/undo` reverses the last graph mutation; triggered by the webapp IPC bridge, not a user-facing CLI command.',
  },
  {
    method: 'POST',
    path: '/graph/redo',
    exemptionReason:
      '`/graph/redo` re-applies a previously undone mutation; triggered by the webapp IPC bridge, not a user-facing CLI command.',
  },
  { id: 'project.show', method: 'GET', path: '/project' },
  { id: 'project.open', method: 'POST', path: '/project/open' },
  { id: 'project.close', method: 'POST', path: '/project/close' },
  { id: 'project.set-write-path', method: 'PUT', path: '/project/write-path' },
  { id: 'project.views.list', method: 'GET', path: '/project/views' },
  { id: 'project.views.create', method: 'POST', path: '/project/views' },
  { id: 'project.views.activate', method: 'POST', path: '/project/views/:viewId/activate' },
  { id: 'project.views.clone', method: 'POST', path: '/project/views/:viewId/clone' },
  { id: 'project.views.delete', method: 'DELETE', path: '/project/views/:viewId' },
] as const satisfies readonly DaemonRouteSpec[]

export type DaemonRouteId = Extract<
  (typeof DAEMON_ROUTE_SPECS)[number],
  { readonly id: string }
>['id']

export function isCliBackedDaemonRouteSpec(
  spec: DaemonRouteSpec,
): spec is CliBackedDaemonRouteSpec & { readonly id: DaemonRouteId } {
  return 'id' in spec
}

export function isExemptDaemonRouteSpec(
  spec: DaemonRouteSpec,
): spec is ExemptDaemonRouteSpec {
  return 'exemptionReason' in spec
}

export function daemonRouteSpecById(id: DaemonRouteId): DaemonRouteSpec {
  const route = DAEMON_ROUTE_SPECS.find(
    (spec): boolean => isCliBackedDaemonRouteSpec(spec) && spec.id === id,
  )
  if (!route) throw new Error(`Missing daemon route spec: ${id}`)
  return route
}

export function daemonRouteSpecBySignature(
  method: DaemonRouteMethod,
  path: string,
): DaemonRouteSpec {
  const route = DAEMON_ROUTE_SPECS.find(
    (spec): boolean => spec.method === method && spec.path === path,
  )
  if (!route) throw new Error(`Missing daemon route spec: ${method} ${path}`)
  return route
}
