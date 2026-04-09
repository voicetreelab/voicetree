import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Store } from '../src/lib/store.js';
import { KnowledgeGraph } from '../src/lib/graph.js';

describe('KnowledgeGraph', () => {
  let store: Store;
  let kg: KnowledgeGraph;

  beforeEach(() => {
    store = new Store(':memory:');
    // Build a small graph: A -> B -> C, A -> C, D (isolated)
    for (const [id, title] of [['a.md', 'A'], ['b.md', 'B'], ['c.md', 'C'], ['d.md', 'D']]) {
      store.upsertNode({ id, title, content: '', frontmatter: {} });
    }
    store.insertEdge({ sourceId: 'a.md', targetId: 'b.md', context: 'A links to B' });
    store.insertEdge({ sourceId: 'b.md', targetId: 'c.md', context: 'B links to C' });
    store.insertEdge({ sourceId: 'a.md', targetId: 'c.md', context: 'A links to C' });
    kg = KnowledgeGraph.fromStore(store);
  });

  afterEach(() => store.close());

  it('loads all nodes and edges from store', () => {
    expect(kg.nodeCount()).toBe(4);
    expect(kg.edgeCount()).toBe(3);
  });

  it('finds neighbors at depth 1', () => {
    const neighbors = kg.neighbors('a.md', 1);
    const ids = neighbors.map(n => n.id);
    expect(ids).toContain('b.md');
    expect(ids).toContain('c.md');
    expect(ids).not.toContain('d.md');
  });

  it('finds neighbors at depth 2', () => {
    const neighbors = kg.neighbors('a.md', 2);
    const ids = neighbors.map(n => n.id);
    expect(ids).toContain('b.md');
    expect(ids).toContain('c.md');
  });

  it('finds paths between connected nodes', () => {
    const paths = kg.findPaths('a.md', 'c.md', 3);
    expect(paths.length).toBeGreaterThanOrEqual(2);
    const directPath = paths.find(p => p.length === 1);
    expect(directPath).toBeDefined();
    const viaB = paths.find(p => p.nodes.includes('b.md'));
    expect(viaB).toBeDefined();
  });

  it('returns empty paths for disconnected nodes', () => {
    const paths = kg.findPaths('a.md', 'd.md', 3);
    expect(paths).toHaveLength(0);
  });

  it('finds common neighbors', () => {
    const common = kg.commonNeighbors('a.md', 'b.md');
    expect(common.map(n => n.id)).toContain('c.md');
  });

  it('extracts subgraph', () => {
    const sub = kg.subgraph('a.md', 1);
    expect(sub.nodes.map(n => n.id)).toContain('a.md');
    expect(sub.nodes.map(n => n.id)).toContain('b.md');
    expect(sub.nodes.map(n => n.id)).toContain('c.md');
    expect(sub.nodes.map(n => n.id)).not.toContain('d.md');
    expect(sub.edges.length).toBeGreaterThan(0);
  });

  it('computes communities', () => {
    const communities = kg.detectCommunities();
    expect(communities.length).toBeGreaterThan(0);
  });

  it('computes bridges (betweenness centrality)', () => {
    const bridges = kg.bridges(10);
    expect(bridges.length).toBeGreaterThan(0);
  });

  it('computes central nodes (PageRank)', () => {
    const central = kg.centralNodes(10);
    expect(central.length).toBeGreaterThan(0);
  });

  it('computes PageRank even with isolated nodes', () => {
    // D is isolated — PageRank should still work on the connected component
    const central = kg.centralNodes(10);
    // C should rank high — it receives edges from both A and B
    const scores = new Map(central.map(n => [n.id, n.score]));
    expect(scores.has('c.md')).toBe(true);
    // Isolated node D should have lowest score
    const dScore = scores.get('d.md') ?? 0;
    const cScore = scores.get('c.md') ?? 0;
    expect(cScore).toBeGreaterThan(dScore);
  });
});
