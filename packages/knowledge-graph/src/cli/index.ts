import { Command } from 'commander';
import { mkdirSync } from 'fs';
import { resolveConfig } from '../lib/config.js';
import { Store } from '../lib/store.js';
import { Embedder } from '../lib/embedder.js';
import { IndexPipeline } from '../lib/index-pipeline.js';
import { KnowledgeGraph } from '../lib/graph.js';
import { Search } from '../lib/search.js';
import { resolveNodeName } from '../lib/resolve.js';

const program = new Command();

program
  .name('kg')
  .description('Knowledge graph tools for Obsidian vaults')
  .version('0.1.0')
  .option('--vault-path <path>', 'Path to Obsidian vault')
  .option('--data-dir <path>', 'Path to data directory');

function getConfig() {
  const opts = program.opts();
  return resolveConfig({
    vaultPath: opts.vaultPath,
    dataDir: opts.dataDir,
  });
}

function getStore() {
  const config = getConfig();
  mkdirSync(config.dataDir, { recursive: true });
  return new Store(config.dbPath);
}

function output(data: unknown) {
  console.log(JSON.stringify(data, null, 2));
}

function requireSingleMatch(name: string, store: Store): string {
  const matches = resolveNodeName(name, store);
  if (matches.length === 0) {
    console.error(`No node found matching "${name}"`);
    process.exit(1);
  }
  if (matches.length > 1 && matches[0].matchType !== 'exact' && matches[0].matchType !== 'id') {
    output({ ambiguous: true, hint: 'Use the full node ID to disambiguate', candidates: matches });
    process.exit(1);
  }
  return matches[0].nodeId;
}

program
  .command('index')
  .description('Parse vault and build/update the knowledge graph')
  .option('--resolution <number>', 'Louvain resolution parameter', '1.0')
  .option('--force', 'Force full re-index (ignore sync state)')
  .action(async (opts) => {
    const config = getConfig();
    mkdirSync(config.dataDir, { recursive: true });
    const store = new Store(config.dbPath);
    if (opts.force) {
      store.db.prepare('DELETE FROM sync').run();
    }
    const embedder = new Embedder();
    await embedder.init();
    const pipeline = new IndexPipeline(store, embedder);
    const stats = await pipeline.index(config.vaultPath, parseFloat(opts.resolution));
    output(stats);
    await embedder.dispose();
    store.close();
  });

program
  .command('node <name>')
  .description('Get a node with its content and connections')
  .option('--full', 'Return full content and edge context (default is brief)')
  .option('--max-content <n>', 'Truncate content to N chars in full mode', '2000')
  .action((name, opts) => {
    const store = getStore();
    const nodeId = requireSingleMatch(name, store);
    const node = store.getNode(nodeId);
    if (!node) { console.error(`Node not found`); process.exit(1); }

    if (opts.full) {
      const limit = parseInt(opts.maxContent);
      const truncatedContent = node.content.length > limit
        ? node.content.slice(0, limit) + `\n\n... [truncated, ${node.content.length} chars total]`
        : node.content;
      const outgoing = store.getEdgesFrom(nodeId).map(e => ({
        ...e, context: e.context.length > 200 ? e.context.slice(0, 200) + '...' : e.context,
      }));
      const incoming = store.getEdgesTo(nodeId).map(e => ({
        ...e, context: e.context.length > 200 ? e.context.slice(0, 200) + '...' : e.context,
      }));
      output({ ...node, content: truncatedContent, outgoing, incoming });
    } else {
      const outgoing = store.getEdgeSummariesFrom(nodeId);
      const incoming = store.getEdgeSummariesTo(nodeId);
      output({
        id: node.id, title: node.title, frontmatter: node.frontmatter,
        outgoingCount: store.countEdgesFrom(nodeId),
        incomingCount: store.countEdgesTo(nodeId),
        outgoing, incoming,
      });
    }
    store.close();
  });

program
  .command('neighbors <name>')
  .description('Get connected nodes')
  .option('--depth <n>', 'Hop depth', '1')
  .action((name, opts) => {
    const store = getStore();
    const nodeId = requireSingleMatch(name, store);
    const kg = KnowledgeGraph.fromStore(store);
    const neighbors = kg.neighbors(nodeId, parseInt(opts.depth));
    output(neighbors);
    store.close();
  });

program
  .command('search <query>')
  .description('Search the knowledge graph')
  .option('--fulltext', 'Use full-text search instead of semantic')
  .option('--limit <n>', 'Max results', '20')
  .action(async (query, opts) => {
    const store = getStore();
    if (opts.fulltext) {
      const results = store.searchFullText(query).slice(0, parseInt(opts.limit));
      output(results);
    } else {
      const embedder = new Embedder();
      await embedder.init();
      const search = new Search(store, embedder);
      const results = await search.semantic(query, parseInt(opts.limit));
      output(results);
      await embedder.dispose();
    }
    store.close();
  });

program
  .command('paths <from> <to>')
  .description('Find connecting paths between two nodes')
  .option('--max-depth <n>', 'Maximum path depth', '3')
  .action((from, to, opts) => {
    const store = getStore();
    const fromId = requireSingleMatch(from, store);
    const toId = requireSingleMatch(to, store);
    const kg = KnowledgeGraph.fromStore(store);
    const paths = kg.findPaths(fromId, toId, parseInt(opts.maxDepth));
    output(paths);
    store.close();
  });

program
  .command('common <nodeA> <nodeB>')
  .description('Find shared connections between two nodes')
  .action((nodeA, nodeB) => {
    const store = getStore();
    const idA = requireSingleMatch(nodeA, store);
    const idB = requireSingleMatch(nodeB, store);
    const kg = KnowledgeGraph.fromStore(store);
    const common = kg.commonNeighbors(idA, idB);
    output(common);
    store.close();
  });

program
  .command('subgraph <name>')
  .description('Extract a local neighborhood')
  .option('--depth <n>', 'Hop depth', '1')
  .action((name, opts) => {
    const store = getStore();
    const nodeId = requireSingleMatch(name, store);
    const kg = KnowledgeGraph.fromStore(store);
    const sub = kg.subgraph(nodeId, parseInt(opts.depth));
    output(sub);
    store.close();
  });

program
  .command('communities')
  .description('List detected communities')
  .action(() => {
    const store = getStore();
    const communities = store.getAllCommunities();
    output(communities.map(c => ({
      id: c.id,
      label: c.label,
      summary: c.summary,
      memberCount: c.nodeIds.length,
    })));
    store.close();
  });

program
  .command('community <id>')
  .description('Get a specific community')
  .action((id) => {
    const store = getStore();
    const communities = store.getAllCommunities();
    const numId = /^\d+$/.test(id) ? parseInt(id) : NaN;
    const community = communities.find(c => c.id === numId || c.label === id);
    if (!community) {
      console.error(`Community "${id}" not found`);
      process.exit(1);
    }
    output(community);
    store.close();
  });

program
  .command('bridges')
  .description('Find bridge nodes (high betweenness centrality)')
  .option('--limit <n>', 'Max results', '20')
  .action((opts) => {
    const store = getStore();
    const kg = KnowledgeGraph.fromStore(store);
    const bridges = kg.bridges(parseInt(opts.limit));
    output(bridges);
    store.close();
  });

program
  .command('central')
  .description('Find central nodes (PageRank)')
  .option('--community <id>', 'Restrict to a community')
  .option('--limit <n>', 'Max results', '20')
  .action((opts) => {
    const store = getStore();
    const kg = KnowledgeGraph.fromStore(store);
    let communityNodeIds: string[] | undefined;
    if (opts.community) {
      const communities = store.getAllCommunities();
      const c = communities.find(c => c.id === parseInt(opts.community));
      communityNodeIds = c?.nodeIds;
    }
    const central = kg.centralNodes(parseInt(opts.limit), communityNodeIds);
    output(central);
    store.close();
  });

program.parse();
