/**
 * Realistic vault generator for performance testing.
 *
 * Creates 500 markdown files on disk with:
 * - YAML frontmatter matching real VoiceTree node format
 * - Wikilinks between nodes (creating graph edges)
 * - 3-level folder hierarchy (creating compound/folder nodes)
 * - Clusters of related nodes + some isolated nodes
 * - .voicetree/ directory with empty positions.json
 *
 * Pure function interface — all side effects (fs writes) confined to generateVaultOnDisk.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

interface VaultNode {
  /** Relative path from vault root (e.g. "cluster-a/sub-1/node-42.md") */
  relativePath: string;
  /** Markdown content including YAML frontmatter */
  content: string;
}

/**
 * Generate the in-memory representation of 500 vault nodes.
 * Deterministic — no randomness.
 */
export function generateVaultNodes(nodeCount: number = 500): VaultNode[] {
  const nodes: VaultNode[] = [];

  // Layout: 8 clusters of ~50 nodes each (400), 5 folders of ~15 (75), 25 isolated root nodes
  const clusterCount = 8;
  const nodesPerCluster = 50;
  const folderCount = 5;
  const nodesPerFolder = 15;
  const isolatedCount = nodeCount - (clusterCount * nodesPerCluster) - (folderCount * nodesPerFolder);

  let nodeIdx = 0;

  // --- Clustered nodes: 3-level deep folders with wikilinks ---
  for (let c = 0; c < clusterCount; c++) {
    const clusterDir = `cluster-${String.fromCharCode(97 + c)}`; // cluster-a through cluster-h
    const subDirs = [`${clusterDir}/planning`, `${clusterDir}/implementation`, `${clusterDir}/review`];

    for (let i = 0; i < nodesPerCluster; i++) {
      const id = `node-${nodeIdx}`;
      // Distribute across subdirs: first 15 in planning, next 20 in implementation, rest in review
      let dir: string;
      if (i < 15) dir = subDirs[0];
      else if (i < 35) dir = subDirs[1];
      else dir = subDirs[2];

      // Wikilinks: each node links to 1-3 siblings in same cluster
      const links: string[] = [];
      if (i > 0) {
        // Link to previous node in cluster
        const prevIdx = nodeIdx - 1;
        const prevId = `node-${prevIdx}`;
        links.push(`[[${prevId}.md]]`);
      }
      if (i > 5) {
        // Link to a node ~5 back (cross-subdir link)
        const crossIdx = nodeIdx - 5;
        const crossId = `node-${crossIdx}`;
        links.push(`[[${crossId}.md]]`);
      }
      // Inter-cluster link: first node of each cluster links to first node of previous cluster
      if (i === 0 && c > 0) {
        const prevClusterFirst = `node-${(c - 1) * nodesPerCluster}`;
        links.push(`[[${prevClusterFirst}.md]]`);
      }

      const content = buildNodeContent(id, nodeIdx, links, `Cluster ${String.fromCharCode(65 + c)} task ${i}`);
      nodes.push({ relativePath: `${dir}/${id}.md`, content });
      nodeIdx++;
    }
  }

  // --- Folder nodes: 2-level folders without inter-links ---
  for (let f = 0; f < folderCount; f++) {
    const folderDir = `topics/topic-${f}`;
    for (let i = 0; i < nodesPerFolder; i++) {
      const id = `node-${nodeIdx}`;
      const links: string[] = [];
      if (i > 0) {
        links.push(`[[node-${nodeIdx - 1}.md]]`);
      }
      const content = buildNodeContent(id, nodeIdx, links, `Topic ${f} note ${i}`);
      nodes.push({ relativePath: `${folderDir}/${id}.md`, content });
      nodeIdx++;
    }
  }

  // --- Isolated root nodes ---
  for (let i = 0; i < isolatedCount; i++) {
    const id = `node-${nodeIdx}`;
    // Some isolated nodes link to cluster nodes for cross-topology edges
    const links: string[] = [];
    if (i % 3 === 0 && nodeIdx > 50) {
      links.push(`[[node-${nodeIdx - 50}.md]]`);
    }
    const content = buildNodeContent(id, nodeIdx, links, `Standalone note ${i}`);
    nodes.push({ relativePath: `${id}.md`, content });
    nodeIdx++;
  }

  return nodes;
}

function buildNodeContent(id: string, idx: number, links: string[], description: string): string {
  const frontmatter = [
    '---',
    'isContextNode: false',
    '---',
  ].join('\n');

  const body = [
    `# ${description}`,
    '',
    `This is ${id}. ${generateParagraph(idx)}`,
    '',
  ];

  if (links.length > 0) {
    body.push('-----------------');
    body.push('_Links:_');
    body.push('');
    for (const link of links) {
      body.push(link);
    }
  }

  return `${frontmatter}\n${body.join('\n')}\n`;
}

/** Deterministic filler text — varies by index to avoid identical content. */
function generateParagraph(idx: number): string {
  const phrases = [
    'Working through the implementation details.',
    'Need to review the edge cases here.',
    'This connects to the broader architecture discussion.',
    'Performance considerations are important for this section.',
    'Iterating on the design based on feedback.',
    'The constraint solver needs careful tuning.',
    'Layout algorithm handles this via cola.js.',
    'File watcher integration is the critical path.',
  ];
  return phrases[idx % phrases.length];
}

/**
 * Write the vault to disk. Creates all directories, files, and .voicetree/ config.
 *
 * @returns The vault root path
 */
export async function generateVaultOnDisk(
  parentDir: string,
  nodeCount: number = 500
): Promise<string> {
  const vaultPath = path.join(parentDir, 'perf-test-vault');
  await fs.mkdir(vaultPath, { recursive: true });

  // Create .voicetree directory with empty positions.json
  const voicetreeDir = path.join(vaultPath, '.voicetree');
  await fs.mkdir(voicetreeDir, { recursive: true });
  await fs.writeFile(path.join(voicetreeDir, 'positions.json'), '{}', 'utf8');

  // Create ctx-nodes directory (required by vault structure)
  await fs.mkdir(path.join(vaultPath, 'ctx-nodes'), { recursive: true });

  // Generate and write all nodes
  const nodes = generateVaultNodes(nodeCount);
  const createdDirs = new Set<string>();

  for (const node of nodes) {
    const fullPath = path.join(vaultPath, node.relativePath);
    const dir = path.dirname(fullPath);
    if (!createdDirs.has(dir)) {
      await fs.mkdir(dir, { recursive: true });
      createdDirs.add(dir);
    }
    await fs.writeFile(fullPath, node.content, 'utf8');
  }

  console.log(`[Vault Gen] Created ${nodes.length} nodes in ${vaultPath}`);
  console.log(`[Vault Gen] Directories: ${createdDirs.size}`);

  return vaultPath;
}
