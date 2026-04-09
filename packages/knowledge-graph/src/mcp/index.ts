import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { resolveConfig } from '../lib/config.js';
import { Store } from '../lib/store.js';
import { Embedder } from '../lib/embedder.js';
import { IndexPipeline } from '../lib/index-pipeline.js';
import { KnowledgeGraph } from '../lib/graph.js';
import { Search } from '../lib/search.js';
import { resolveNodeName } from '../lib/resolve.js';
import { VaultWriter } from '../lib/writer.js';
import { mkdirSync } from 'fs';

const config = resolveConfig({});
mkdirSync(config.dataDir, { recursive: true });

const store = new Store(config.dbPath);
const embedder = new Embedder();
const search = new Search(store, embedder);
const writer = new VaultWriter(config.vaultPath, store);
let embedderReady = false;

const server = new McpServer({
  name: 'knowledge-graph',
  version: '0.1.0',
});

function requireMatch(name: string): string {
  const matches = resolveNodeName(name, store);
  if (matches.length === 0) throw new Error(`No node found matching "${name}"`);
  if (matches.length > 1 && matches[0].matchType !== 'exact' && matches[0].matchType !== 'id') {
    const candidates = matches.map(m => `"${m.title}" (${m.nodeId})`).join(', ');
    throw new Error(`Ambiguous name "${name}". Candidates: ${candidates}. Use the full node ID to disambiguate.`);
  }
  return matches[0].nodeId;
}

server.tool(
  'kg_index',
  'Parse vault and build/update the knowledge graph',
  { resolution: z.number().optional().describe('Louvain resolution parameter (default 1.0)') },
  async ({ resolution }) => {
    if (!embedderReady) { await embedder.init(); embedderReady = true; }
    const pipeline = new IndexPipeline(store, embedder);
    const stats = await pipeline.index(config.vaultPath, resolution ?? 1.0);
    return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] };
  }
);

server.tool(
  'kg_node',
  'Get a node. Brief mode (default) returns metadata + connection titles. Full mode returns content + edge context.',
  {
    name: z.string().describe('Node name (fuzzy matched)'),
    brief: z.boolean().optional().describe('Brief mode: metadata + connection titles only (default true)'),
    maxContentLength: z.number().optional().describe('Truncate content to N chars in full mode (default 2000)'),
  },
  async ({ name, brief, maxContentLength }) => {
    const nodeId = requireMatch(name);
    const node = store.getNode(nodeId);
    if (!node) throw new Error(`Node "${name}" not found`);
    const useBrief = brief ?? true;

    if (useBrief) {
      const outgoing = store.getEdgeSummariesFrom(nodeId);
      const incoming = store.getEdgeSummariesTo(nodeId);
      const result = {
        id: node.id,
        title: node.title,
        frontmatter: node.frontmatter,
        outgoingCount: store.countEdgesFrom(nodeId),
        incomingCount: store.countEdgesTo(nodeId),
        outgoing,
        incoming,
      };
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    const limit = maxContentLength ?? 2000;
    const truncatedContent = node.content.length > limit
      ? node.content.slice(0, limit) + `\n\n... [truncated, ${node.content.length} chars total]`
      : node.content;
    const outgoing = store.getEdgesFrom(nodeId).map(e => ({
      ...e,
      context: e.context.length > 200 ? e.context.slice(0, 200) + '...' : e.context,
    }));
    const incoming = store.getEdgesTo(nodeId).map(e => ({
      ...e,
      context: e.context.length > 200 ? e.context.slice(0, 200) + '...' : e.context,
    }));
    return { content: [{ type: 'text', text: JSON.stringify({ ...node, content: truncatedContent, outgoing, incoming }, null, 2) }] };
  }
);

server.tool(
  'kg_neighbors',
  'Get connected nodes at N-hop depth',
  {
    name: z.string().describe('Node name (fuzzy matched)'),
    depth: z.number().optional().describe('Hop depth (default 1)'),
  },
  async ({ name, depth }) => {
    const nodeId = requireMatch(name);
    const kg = KnowledgeGraph.fromStore(store);
    const neighbors = kg.neighbors(nodeId, depth ?? 1);
    return { content: [{ type: 'text', text: JSON.stringify(neighbors, null, 2) }] };
  }
);

server.tool(
  'kg_search',
  'Semantic or full-text search over the graph',
  {
    query: z.string().describe('Search query'),
    fulltext: z.boolean().optional().describe('Use full-text search instead of semantic'),
    limit: z.number().optional().describe('Max results (default 20)'),
  },
  async ({ query, fulltext, limit }) => {
    let results;
    if (fulltext) {
      results = store.searchFullText(query).slice(0, limit ?? 20);
    } else {
      if (!embedderReady) { await embedder.init(); embedderReady = true; }
      results = await search.semantic(query, limit ?? 20);
    }
    return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
  }
);

server.tool(
  'kg_paths',
  'Find connecting paths between two nodes',
  {
    from: z.string().describe('Source node name'),
    to: z.string().describe('Target node name'),
    maxDepth: z.number().optional().describe('Maximum path depth (default 3)'),
  },
  async ({ from, to, maxDepth }) => {
    const fromId = requireMatch(from);
    const toId = requireMatch(to);
    const kg = KnowledgeGraph.fromStore(store);
    const paths = kg.findPaths(fromId, toId, maxDepth ?? 3);
    return { content: [{ type: 'text', text: JSON.stringify(paths, null, 2) }] };
  }
);

server.tool(
  'kg_common',
  'Find shared connections between two nodes',
  {
    nodeA: z.string().describe('First node name'),
    nodeB: z.string().describe('Second node name'),
  },
  async ({ nodeA, nodeB }) => {
    const idA = requireMatch(nodeA);
    const idB = requireMatch(nodeB);
    const kg = KnowledgeGraph.fromStore(store);
    const common = kg.commonNeighbors(idA, idB);
    return { content: [{ type: 'text', text: JSON.stringify(common, null, 2) }] };
  }
);

server.tool(
  'kg_subgraph',
  'Extract a local neighborhood as a self-contained graph',
  {
    name: z.string().describe('Center node name'),
    depth: z.number().optional().describe('Hop depth (default 1)'),
  },
  async ({ name, depth }) => {
    const nodeId = requireMatch(name);
    const kg = KnowledgeGraph.fromStore(store);
    const sub = kg.subgraph(nodeId, depth ?? 1);
    return { content: [{ type: 'text', text: JSON.stringify(sub, null, 2) }] };
  }
);

server.tool(
  'kg_communities',
  'List detected communities',
  {},
  async () => {
    const communities = store.getAllCommunities();
    const summary = communities.map(c => ({
      id: c.id, label: c.label, summary: c.summary, memberCount: c.nodeIds.length,
    }));
    return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
  }
);

server.tool(
  'kg_community',
  'Get a specific community',
  { id: z.string().describe('Community ID or label') },
  async ({ id }) => {
    const communities = store.getAllCommunities();
    const numId = /^\d+$/.test(id) ? parseInt(id) : NaN;
    const community = communities.find(c => c.id === numId || c.label === id);
    if (!community) throw new Error(`Community "${id}" not found`);
    return { content: [{ type: 'text', text: JSON.stringify(community, null, 2) }] };
  }
);

server.tool(
  'kg_bridges',
  'Find bridge nodes with highest betweenness centrality',
  { limit: z.number().optional().describe('Max results (default 20)') },
  async ({ limit }) => {
    const kg = KnowledgeGraph.fromStore(store);
    const bridges = kg.bridges(limit ?? 20);
    return { content: [{ type: 'text', text: JSON.stringify(bridges, null, 2) }] };
  }
);

server.tool(
  'kg_central',
  'Find central nodes by PageRank',
  {
    community: z.string().optional().describe('Restrict to community ID'),
    limit: z.number().optional().describe('Max results (default 20)'),
  },
  async ({ community, limit }) => {
    const kg = KnowledgeGraph.fromStore(store);
    let communityNodeIds: string[] | undefined;
    if (community) {
      const communities = store.getAllCommunities();
      const c = communities.find(c => c.id === parseInt(community));
      communityNodeIds = c?.nodeIds;
    }
    const central = kg.centralNodes(limit ?? 20, communityNodeIds);
    return { content: [{ type: 'text', text: JSON.stringify(central, null, 2) }] };
  }
);

server.tool(
  'kg_create_node',
  'Create a new node in the vault. Writes a markdown file with frontmatter and indexes it.',
  {
    title: z.string().describe('Node title (becomes the filename)'),
    directory: z.string().optional().describe('Directory within vault (e.g., "Concepts", "People", "Ideas"). Omit for vault root.'),
    content: z.string().describe('Markdown content for the node body'),
    frontmatter: z.record(z.unknown()).optional().describe('YAML frontmatter fields (type, tags, status, related, etc.)'),
  },
  async ({ title, directory, content, frontmatter }) => {
    const relPath = writer.createNode({
      title,
      directory,
      frontmatter: frontmatter ?? {},
      content,
    });
    return { content: [{ type: 'text', text: JSON.stringify({ created: relPath }, null, 2) }] };
  }
);

server.tool(
  'kg_annotate_node',
  'Append content to an existing node. Use for agent notes, observations, or additional context.',
  {
    name: z.string().describe('Node name or ID (fuzzy matched)'),
    content: z.string().describe('Markdown content to append'),
  },
  async ({ name, content }) => {
    const nodeId = requireMatch(name);
    writer.annotateNode(nodeId, content);
    return { content: [{ type: 'text', text: JSON.stringify({ annotated: nodeId }, null, 2) }] };
  }
);

server.tool(
  'kg_add_link',
  'Add a wiki link from one node to another with context. Appends to the source file and creates an edge.',
  {
    source: z.string().describe('Source node name or ID'),
    target: z.string().describe('Target node reference (e.g., "People/Alice Smith" or "Widget Theory")'),
    context: z.string().describe('Why this link exists — the sentence or note explaining the connection'),
  },
  async ({ source, target, context }) => {
    const sourceId = requireMatch(source);
    writer.addLink(sourceId, target, context);
    return { content: [{ type: 'text', text: JSON.stringify({ linked: { from: sourceId, to: target } }, null, 2) }] };
  }
);

async function main() {
  // Embedder is lazily initialized on first semantic search/index — no eager loading here
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
