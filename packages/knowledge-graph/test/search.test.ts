import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Store } from '../src/lib/store.js';
import { Embedder } from '../src/lib/embedder.js';
import { Search } from '../src/lib/search.js';

describe('Search', () => {
  let store: Store;
  let embedder: Embedder;
  let search: Search;

  beforeAll(async () => {
    store = new Store(':memory:');
    embedder = new Embedder();
    await embedder.init();
    search = new Search(store, embedder);

    const nodes = [
      { id: 'graph.md', title: 'Graph Theory', content: 'Study of mathematical structures used to model pairwise relations', frontmatter: {} },
      { id: 'cake.md', title: 'Chocolate Cake', content: 'A delicious dessert made with cocoa powder and sugar', frontmatter: {} },
      { id: 'network.md', title: 'Network Analysis', content: 'Analysis of graph structures in social networks', frontmatter: {} },
    ];

    for (const node of nodes) {
      store.upsertNode(node);
      const text = Embedder.buildEmbeddingText(node.title, [], node.content);
      const embedding = await embedder.embed(text);
      store.upsertEmbedding(node.id, embedding);
    }
  }, 60000);

  afterAll(async () => {
    store.close();
    await embedder.dispose();
  });

  it('semantic search returns relevant results', async () => {
    const results = await search.semantic('graph structures and relationships');
    expect(results.length).toBeGreaterThan(0);
    const ids = results.map(r => r.nodeId);
    const graphIdx = ids.indexOf('graph.md');
    const cakeIdx = ids.indexOf('cake.md');
    expect(graphIdx).toBeLessThan(cakeIdx);
  });

  it('fulltext search returns exact keyword matches', () => {
    const results = search.fulltext('cocoa powder');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].nodeId).toBe('cake.md');
  });
});
