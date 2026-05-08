import type { Graph, GraphNode } from '@vt/graph-model/graph'
import { createEmptyGraph } from '@vt/graph-model/graph'

let currentGraph: Graph = createEmptyGraph()

export const getGraph = (): Graph => currentGraph
export const setGraph = (g: Graph): void => { currentGraph = g }
export const getNode = (nodeId: string): GraphNode | undefined => currentGraph.nodes[nodeId]
