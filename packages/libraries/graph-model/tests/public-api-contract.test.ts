import { beforeEach, describe, expect, it } from 'vitest'

import {
  applyGraphDeltaToGraph,
  buildGraphFromFiles,
  fromNodeToMarkdownContent,
  getNodeTitle,
  getSubgraphByDistance,
  graphToAscii,
  mapFSEventsToGraphDelta,
  nodeIdToFilePathWithExtension,
  type Graph,
} from '../src'

const root = '/tmp/vt-model-contract'
const indexPath = `${root}/index.md`
const planPath = `${root}/areas/plan.md`
const imagePath = `${root}/images/diagram.png`

function buildFixture(): Graph {
  return buildGraphFromFiles([
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
        '  - /tmp/vt-model-contract/index.md',
        '---',
        '# Plan',
        '',
        'Back to [[index]].',
      ].join('\n'),
    },
    { absolutePath: imagePath, content: '' },
  ])
}

describe('@vt/graph-model public API contract', () => {
  let graph: Graph

  beforeEach(() => {
    graph = buildFixture()
  })

  it('builds nodes from markdown files for every input path', () => {
    expect(Object.keys(graph.nodes).sort()).toEqual([imagePath, indexPath, planPath].sort())
  })

  it('extracts titles from the leading H1', () => {
    expect(getNodeTitle(graph.nodes[indexPath])).toBe('Home')
    expect(getNodeTitle(graph.nodes[planPath])).toBe('Plan')
  })

  it('resolves wikilinks to outgoing edges', () => {
    expect(graph.nodes[indexPath].outgoingEdges.map((edge) => edge.targetId).sort()).toEqual([
      imagePath,
      planPath,
    ].sort())
  })

  it('parses color from frontmatter as Option.Some', () => {
    expect(graph.nodes[indexPath].nodeUIMetadata.color).toMatchObject({
      _tag: 'Some',
      value: '#ff0000',
    })
  })

  it('parses isContextNode and containedNodeIds from frontmatter', () => {
    expect(graph.nodes[planPath].nodeUIMetadata.isContextNode).toBe(true)
    expect(graph.nodes[planPath].nodeUIMetadata.containedNodeIds).toEqual([indexPath])
  })

  describe('delta application', () => {
    const addedPath = `${root}/areas/final-plan.md`
    let nextGraph: Graph

    beforeEach(() => {
      nextGraph = applyGraphDeltaToGraph(
        graph,
        mapFSEventsToGraphDelta({
          absolutePath: addedPath,
          content: fromNodeToMarkdownContent({
            ...graph.nodes[planPath],
            absoluteFilePathIsID: addedPath,
            contentWithoutYamlOrLinks: '# Final Plan\n\nBack to [index]*.',
          }),
          eventType: 'Added',
        }, graph),
      )
    })

    it('adds the new node with its outgoing edges', () => {
      const finalPlan = nextGraph.nodes[addedPath]
      expect(finalPlan).toBeDefined()
      expect(finalPlan.outgoingEdges).toContainEqual({ targetId: indexPath, label: 'Back to' })
    })

    it('exposes the new node neighborhood via getSubgraphByDistance', () => {
      expect(Object.keys(getSubgraphByDistance(nextGraph, indexPath, 2).nodes)).toEqual(
        expect.arrayContaining([indexPath, imagePath]),
      )
    })

    it('renders the new graph to ASCII', () => {
      expect(graphToAscii(nextGraph)).toContain('Home')
    })
  })

  it('round-trips markdown node ids to file paths via nodeIdToFilePathWithExtension', () => {
    expect(nodeIdToFilePathWithExtension(indexPath)).toBe(indexPath)
    expect(nodeIdToFilePathWithExtension(planPath)).toBe(planPath)
  })
})
