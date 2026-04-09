import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Store } from '../src/lib/store.js';

describe('Store', () => {
  let store: Store;

  beforeEach(() => {
    store = new Store(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  it('creates schema on initialization', () => {
    const tables = store.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table'"
    ).all().map((r: any) => r.name);
    expect(tables).toContain('nodes');
    expect(tables).toContain('edges');
    expect(tables).toContain('communities');
    expect(tables).toContain('sync');
  });

  it('upserts and retrieves nodes', () => {
    store.upsertNode({
      id: 'test.md',
      title: 'Test',
      content: 'Hello world',
      frontmatter: { type: 'test' },
    });
    const node = store.getNode('test.md');
    expect(node).toBeDefined();
    expect(node!.title).toBe('Test');
    expect(node!.frontmatter).toEqual({ type: 'test' });
  });

  it('inserts and retrieves edges', () => {
    store.upsertNode({ id: 'a.md', title: 'A', content: '', frontmatter: {} });
    store.upsertNode({ id: 'b.md', title: 'B', content: '', frontmatter: {} });
    store.insertEdge({ sourceId: 'a.md', targetId: 'b.md', context: 'A links to B' });
    const edges = store.getEdgesFrom('a.md');
    expect(edges).toHaveLength(1);
    expect(edges[0].targetId).toBe('b.md');
    expect(edges[0].context).toBe('A links to B');
  });

  it('allows multiple edges between the same pair', () => {
    store.upsertNode({ id: 'a.md', title: 'A', content: '', frontmatter: {} });
    store.upsertNode({ id: 'b.md', title: 'B', content: '', frontmatter: {} });
    store.insertEdge({ sourceId: 'a.md', targetId: 'b.md', context: 'First mention' });
    store.insertEdge({ sourceId: 'a.md', targetId: 'b.md', context: 'Second mention' });
    const edges = store.getEdgesFrom('a.md');
    expect(edges).toHaveLength(2);
  });

  it('retrieves backlinks (edges targeting a node)', () => {
    store.upsertNode({ id: 'a.md', title: 'A', content: '', frontmatter: {} });
    store.upsertNode({ id: 'b.md', title: 'B', content: '', frontmatter: {} });
    store.insertEdge({ sourceId: 'a.md', targetId: 'b.md', context: 'link' });
    const backlinks = store.getEdgesTo('b.md');
    expect(backlinks).toHaveLength(1);
    expect(backlinks[0].sourceId).toBe('a.md');
  });

  it('performs full-text search via FTS5', () => {
    store.upsertNode({
      id: 'test.md',
      title: 'Widget Theory',
      content: 'A framework for understanding component interactions',
      frontmatter: {},
    });
    const results = store.searchFullText('framework component');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].nodeId).toBe('test.md');
  });

  it('tracks sync state', () => {
    store.upsertSync('test.md', 1000);
    expect(store.getSyncMtime('test.md')).toBe(1000);
    store.upsertSync('test.md', 2000);
    expect(store.getSyncMtime('test.md')).toBe(2000);
  });

  it('deletes a node and cascades to edges', () => {
    store.upsertNode({ id: 'a.md', title: 'A', content: '', frontmatter: {} });
    store.upsertNode({ id: 'b.md', title: 'B', content: '', frontmatter: {} });
    store.insertEdge({ sourceId: 'a.md', targetId: 'b.md', context: 'link' });
    store.deleteNode('a.md');
    expect(store.getNode('a.md')).toBeUndefined();
    expect(store.getEdgesFrom('a.md')).toHaveLength(0);
  });

  it('lists all node IDs', () => {
    store.upsertNode({ id: 'a.md', title: 'A', content: '', frontmatter: {} });
    store.upsertNode({ id: 'b.md', title: 'B', content: '', frontmatter: {} });
    expect(store.allNodeIds()).toEqual(expect.arrayContaining(['a.md', 'b.md']));
  });

  it('full-text search returns snippets', () => {
    store.upsertNode({
      id: 'test.md',
      title: 'Widget Theory',
      content: 'A framework for understanding component interactions in complex distributed systems',
      frontmatter: {},
    });
    const results = store.searchFullText('framework component');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].excerpt).not.toBe('');
    expect(results[0].excerpt).toContain('framework');
  });

  it('counts edges for a node', () => {
    store.upsertNode({ id: 'a.md', title: 'A', content: '', frontmatter: {} });
    store.upsertNode({ id: 'b.md', title: 'B', content: '', frontmatter: {} });
    store.upsertNode({ id: 'c.md', title: 'C', content: '', frontmatter: {} });
    store.insertEdge({ sourceId: 'a.md', targetId: 'b.md', context: 'link 1' });
    store.insertEdge({ sourceId: 'a.md', targetId: 'c.md', context: 'link 2' });
    store.insertEdge({ sourceId: 'b.md', targetId: 'a.md', context: 'backlink' });
    expect(store.countEdgesFrom('a.md')).toBe(2);
    expect(store.countEdgesTo('a.md')).toBe(1);
  });

  it('gets edge summaries (target titles without context)', () => {
    store.upsertNode({ id: 'a.md', title: 'Alpha', content: '', frontmatter: {} });
    store.upsertNode({ id: 'b.md', title: 'Beta', content: '', frontmatter: {} });
    store.upsertNode({ id: 'c.md', title: 'Gamma', content: '', frontmatter: {} });
    store.insertEdge({ sourceId: 'a.md', targetId: 'b.md', context: 'long paragraph...' });
    store.insertEdge({ sourceId: 'c.md', targetId: 'a.md', context: 'another paragraph...' });
    const outSummary = store.getEdgeSummariesFrom('a.md');
    expect(outSummary).toHaveLength(1);
    expect(outSummary[0].title).toBe('Beta');
    const inSummary = store.getEdgeSummariesTo('a.md');
    expect(inSummary).toHaveLength(1);
    expect(inSummary[0].title).toBe('Gamma');
  });
});
