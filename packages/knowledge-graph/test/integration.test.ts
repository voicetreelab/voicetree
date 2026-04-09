import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { Store } from '../src/lib/store.js';
import { Embedder } from '../src/lib/embedder.js';
import { IndexPipeline } from '../src/lib/index-pipeline.js';
import { KnowledgeGraph } from '../src/lib/graph.js';
import { Search } from '../src/lib/search.js';
import { resolveNodeName } from '../src/lib/resolve.js';

const FIXTURE_VAULT = join(import.meta.dirname, 'fixtures', 'vault');

describe('Integration: full pipeline', () => {
  let store: Store;
  let embedder: Embedder;
  let kg: KnowledgeGraph;
  let search: Search;

  beforeAll(async () => {
    store = new Store(':memory:');
    embedder = new Embedder();
    await embedder.init();

    const pipeline = new IndexPipeline(store, embedder);
    await pipeline.index(FIXTURE_VAULT);

    kg = KnowledgeGraph.fromStore(store);
    search = new Search(store, embedder);
  }, 120000);

  afterAll(async () => {
    store.close();
    await embedder.dispose();
  });

  it('name resolution finds Alice by alias', () => {
    const matches = resolveNodeName('A. Smith', store);
    expect(matches).toHaveLength(1);
    expect(matches[0].nodeId).toBe('People/Alice Smith.md');
  });

  it('node lookup returns content and connections', () => {
    const node = store.getNode('People/Alice Smith.md');
    expect(node).toBeDefined();
    expect(node!.title).toBe('Alice Smith');
    const outgoing = store.getEdgesFrom('People/Alice Smith.md');
    expect(outgoing.length).toBeGreaterThan(0);
  });

  it('neighbors returns connected nodes', () => {
    const neighbors = kg.neighbors('People/Alice Smith.md', 1);
    const titles = neighbors.map(n => n.title);
    expect(titles).toContain('Widget Theory');
  });

  it('semantic search finds relevant nodes', async () => {
    const results = await search.semantic('design pattern for components');
    expect(results.length).toBeGreaterThan(0);
  });

  it('fulltext search finds exact keywords', () => {
    const results = search.fulltext('resilient components');
    expect(results.length).toBeGreaterThan(0);
  });

  it('finds paths between Alice and Acme Project', () => {
    const paths = kg.findPaths(
      'People/Alice Smith.md',
      'Ideas/Acme Project.md',
      3,
    );
    expect(paths.length).toBeGreaterThan(0);
  });

  it('finds common neighbors between Alice and Bob', () => {
    const common = kg.commonNeighbors(
      'People/Alice Smith.md',
      'People/Bob Jones.md',
    );
    const titles = common.map(n => n.title);
    expect(titles).toContain('Widget Theory');
  });

  it('extracts subgraph around Widget Theory', () => {
    const sub = kg.subgraph('Concepts/Widget Theory.md', 1);
    expect(sub.nodes.length).toBeGreaterThan(1);
    expect(sub.edges.length).toBeGreaterThan(0);
  });

  it('communities are detected', () => {
    const communities = store.getAllCommunities();
    expect(communities.length).toBeGreaterThan(0);
  });

  it('bridges are computed', () => {
    const bridges = kg.bridges(10);
    expect(bridges.length).toBeGreaterThan(0);
  });

  it('central nodes are computed', () => {
    const central = kg.centralNodes(10);
    expect(central.length).toBeGreaterThan(0);
  });

  it('orphan node exists but is isolated', () => {
    const orphan = store.getNode('orphan.md');
    expect(orphan).toBeDefined();
    const neighbors = kg.neighbors('orphan.md', 1);
    expect(neighbors).toHaveLength(0);
  });
});
