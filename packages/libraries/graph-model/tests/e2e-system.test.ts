import { describe, expect, it } from 'vitest'

import {
  applyGraphDeltaToGraph,
  buildGraphFromFiles,
  fromNodeToMarkdownContent,
  getNodeTitle,
  getSubgraphByDistance,
  graphToAscii,
  mapFSEventsToGraphDelta,
  nodeIdToFilePathWithExtension,
} from '../src'

describe('@vt/graph-model system contract', () => {
  it('round-trips a representative markdown vault through public graph APIs', () => {
    const root = '/tmp/vt-model-system'
    const indexPath = `${root}/index.md`
    const planPath = `${root}/areas/plan.md`
    const imagePath = `${root}/images/diagram.png`

    const graph = buildGraphFromFiles([
      {
        absolutePath: indexPath,
        content: [
          '---',
          'color: "#ff0000"',
          'agent_name: Ada',
          '---',
          '# Home',
          '',
          'See [[areas/plan]] and [[images/diagram.png]].',
        ].join('\n'),
      },
      {
        absolutePath: planPath,
        content: [
          '---',
          'isContextNode: true',
          'containedNodeIds:',
          '  - /tmp/vt-model-system/index.md',
          '---',
          '# Plan',
          '',
          'Back to [[index]].',
        ].join('\n'),
      },
      {
        absolutePath: imagePath,
        content: '',
      },
    ])

    expect(Object.keys(graph.nodes).sort()).toEqual([
      imagePath,
      indexPath,
      planPath,
    ].sort())
    expect(getNodeTitle(graph.nodes[indexPath])).toBe('Home')
    expect(getNodeTitle(graph.nodes[planPath])).toBe('Plan')
    expect(graph.nodes[indexPath].outgoingEdges.map((edge) => edge.targetId).sort()).toEqual([
      imagePath,
      planPath,
    ].sort())
    expect(graph.nodes[indexPath].nodeUIMetadata.color).toMatchObject({
      _tag: 'Some',
      value: '#ff0000',
    })
    expect(graph.nodes[planPath].nodeUIMetadata.isContextNode).toBe(true)
    expect(graph.nodes[planPath].nodeUIMetadata.containedNodeIds).toEqual([indexPath])

    const renamedPath = `${root}/areas/final-plan.md`
    const nextGraph = applyGraphDeltaToGraph(
      graph,
      mapFSEventsToGraphDelta({
        absolutePath: renamedPath,
        content: fromNodeToMarkdownContent({
          ...graph.nodes[planPath],
          absoluteFilePathIsID: renamedPath,
          contentWithoutYamlOrLinks: '# Final Plan\n\nBack to [index]*.',
        }),
        eventType: 'Added',
      }, graph),
    )

    const finalPlan = nextGraph.nodes[renamedPath]
    expect(finalPlan.outgoingEdges).toContainEqual({ targetId: indexPath, label: 'Back to' })
    expect(nodeIdToFilePathWithExtension(renamedPath)).toBe(renamedPath)
    expect(Object.keys(getSubgraphByDistance(nextGraph, indexPath, 2).nodes)).toEqual(
      expect.arrayContaining([indexPath, imagePath]),
    )
    expect(graphToAscii(nextGraph)).toContain('Home')
  })
})
