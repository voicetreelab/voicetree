import { describe, it, expect } from 'vitest';
import { loadMarkdownTree } from '@/graph-core/data/load_markdown/MarkdownParser';
import { MarkdownTree, Node } from '@/graph-core/types';
import fs from 'fs';
import path from 'path';

/**
 * Generate ASCII tree visualization (1:1 port of Python _generate_ascii_tree)
 * backend/markdown_tree_manager/markdown_to_tree/tree_visualization.py
 */
function generateAsciiTree(markdownTree: MarkdownTree): string {
  const lines: string[] = [];
  const visited = new Set<string>();

  // Build tree structure map (filename -> children filenames)
  const treeStructure = new Map<string, string[]>();
  const nodeMap = new Map<string, Node>();
  const roots: string[] = [];

  // Build maps
  for (const node of markdownTree.tree.values()) {
    nodeMap.set(node.filename, node);

    // Add children
    const childrenFilenames = node.children
      .map(childId => markdownTree.tree.get(childId)?.filename)
      .filter((f): f is string => f !== undefined);

    if (childrenFilenames.length > 0) {
      treeStructure.set(node.filename, childrenFilenames);
    }

    // Track roots (nodes with no parent)
    if (node.parentId === undefined) {
      roots.push(node.filename);
    }
  }

  function printTree(
    filename: string,
    prefix: string = '',
    isLast: boolean = true,
    isRoot: boolean = true
  ): void {
    const node = nodeMap.get(filename);
    if (!node || visited.has(node.id)) {
      return;
    }
    visited.add(node.id);

    const title = node.title;

    // Print current node
    if (isRoot) {
      lines.push(title);
    } else {
      const connector = isLast ? '└── ' : '├── ';
      lines.push(prefix + connector + title);
    }

    // Print children
    const children = treeStructure.get(filename) || [];
    for (let i = 0; i < children.length; i++) {
      const childFile = children[i];
      const isLastChild = i === children.length - 1;
      let childPrefix: string;
      if (isRoot) {
        childPrefix = '';
      } else {
        const extension = isLast ? '    ' : '│   ';
        childPrefix = prefix + extension;
      }
      printTree(childFile, childPrefix, isLastChild, false);
    }
  }

  // Start with root nodes
  for (const root of roots) {
    printTree(root);
  }

  return lines.join('\n');
}

describe('Markdown Tree Loading - ASCII Visualization', () => {
  const fixtureDir = path.join(__dirname, '../../fixtures/example_real_large/2025-09-30');

  it('should generate correct ASCII tree matching Python output', () => {
    // Load all markdown files
    const files = new Map<string, string>();
    const mdFiles = fs.readdirSync(fixtureDir)
      .filter(f => f.endsWith('.md'))
      .sort(); // Sort to match Python's consistent ordering

    for (const filename of mdFiles) {
      const content = fs.readFileSync(path.join(fixtureDir, filename), 'utf-8');
      files.set(filename, content);
    }

    // Parse using new canonical parser
    const markdownTree = loadMarkdownTree(files, fixtureDir);

    // Generate ASCII tree visualization
    const asciiTree = generateAsciiTree(markdownTree);

    // Expected output - canonical tree structure from markdown files
    const expectedTree = `Business Idea: Surfboard Rentals for Children with Disabilities (141122)
Inquiry about a Trailer (141123)
(Victor) Local Cloud Function Testing Complete - All Tests Pass (14_1_1_2)
└── (Victor) Workstream 2 Plan - System Test Integration (14_1_1_2_1)
Relationship between Target Node and Append Agent (1)
└── Convert Append Agent to Google Cloud Lambda (2)
    ├── Setting up Agent in Feedback Loop (10)
    │   └── Identify Relevant Test for Tree Action Decider Workflow (11)
    ├── Observation: Plan Complexity for Agent Conversion (18)
    ├── Create Cloud Functions Directory (20)
    │   └── Copy Contents to Cloud Functions Directory (22)
    ├── Setup G Cloud CLI and Understand Lambda Creation (3)
    │   ├── Setup G Cloud CLI (4)
    │   │   ├── Resolve G Cloud CLI MFA Block (16)
    │   │   ├── Create G Cloud Configuration (17)
    │   │   ├── (Uma) GCloud CLI Successfully Installed (4_1)
    │   │   ├── (Uma) GCloud CLI Configured and Authenticated (4_2)
    │   │   └── (Uma) Google Cloud APIs Enabled for Australia Region (4_3)
    │   ├── Understand Google Cloud Lambda Creation (5)
    │   └── Question Scope of G Cloud CLI (6)
    ├── Identify Code Extraction Boundaries (7)
    │   └── Assign Agent to Identify Boundaries (14)
    │       └── (Victor) Append Agent Extraction Analysis Complete (14_1)
    └── Quick Testing Strategy for Lambda Conversion (8)
        ├── Bare Minimum Conversion Requirements for Quick Test (19)
        ├── Test Lambda in Isolation Locally (21)
        │   └── Integration Test for Append Relative Node Agent (23)
        │       ├── Google Cloud Setup for Testing (28)
        │       ├── Identified Testing Boundaries (29)
        │       ├── Cloud Function Isolation Test (30)
        │       └── Tree Action Set End-to-End Test (31)
        ├── Google Cloud Function Compatibility Testing (24)
        ├── Local Google Cloud Function Execution for Testing (25)
        ├── Develop Quick Testing Strategy Plan (26)
        │   └── Two Streams of Work (27)
        └── Local Lambda Execution for Testing (9)
Agent Task Initiation and Clarification (32)
├── Agent Clarification Request (33)
├── Agent Plan Request (34)
└── Agent Online Status (51)
Deployment of main.py to Cloud Functions (37)
├── Deployment of main.py to AWS Lambda (41)
└── Ping Test for Lambda Deployment (42)
    └── Ping Test Result for Australia Southeast 1 (43)
        └── Next System Test Phase (45)
Initiation of Work Stream Two (System Test) (38)
Speaker's Self-Correction/Informal Remarks (39)
├── Time Remaining Inquiry and Response (40)
├── Speaker's Positive Outcome Reaction (44)
├── Speaker's Big Picture Planning Capability (46)
├── Addressing Technical Debt (47)
├── Fallback Removal Instruction (48)
├── Verification Inquiry (49)
└── Real Example Test Instruction (50)
Workstream Management and Agent Interaction (53)`;

    // Simple assertion: output should match expected
    expect(asciiTree).toBe(expectedTree);
  });
});
