#!/usr/bin/env node
/**
 * Stop Hook - Checks for unseen nodes and reminds agents to create progress nodes
 *
 * EXIT CODES:
 *   0 - Allow stop
 *   2 - Block stop (unseen nodes or first attempt)
 */

const http = require('http');

async function fetchUnseenNodes(port, terminalId) {
  return new Promise((resolve) => {
    const url = `http://127.0.0.1:${port}/hook/unseen-nodes/${encodeURIComponent(terminalId)}`;

    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ unseenNodes: [] });
        }
      });
    }).on('error', () => {
      resolve({ unseenNodes: [] });
    });
  });
}

async function main() {
  // Read stdin
  let inputData = '';
  for await (const chunk of process.stdin) {
    inputData += chunk;
  }

  let input = {};
  try {
    input = JSON.parse(inputData);
  } catch (e) {
    // If no valid JSON, treat as first attempt
  }

  // If already blocked once (stop_hook_active=true), allow stopping
  if (input.stop_hook_active) {
    console.error('[ VT HOOK ] Already reminded once, allowing stop.');
    process.exit(0);
  }

  const port = process.env.VOICETREE_MCP_PORT;
  const terminalId = process.env.VOICETREE_TERMINAL_ID;

  let unseenNodes = [];

  // Try to fetch unseen nodes if we have the required env vars
  if (port && terminalId) {
    const result = await fetchUnseenNodes(port, terminalId);
    unseenNodes = result.unseenNodes || [];
  }

  // No unseen nodes or MCP unavailable → allow stop
  if (!port || !terminalId || unseenNodes.length === 0) {
    process.exit(0);
  }

  // Unseen nodes found → block and show them
  console.error('');
  console.error('════════════════════════════════════════════');
  console.error('[ VT HOOK ] ⚠️  UNSEEN NODES NEARBY - READ BEFORE STOPPING:');
  console.error('════════════════════════════════════════════');
  console.error('');
  unseenNodes.forEach((node, i) => {
    const title = node.title || node.id || 'Untitled';
    console.error(`   ${i + 1}. ${title}`);
  });
  console.error('');
  console.error('→ Call get_unseen_nodes_nearby to read their content');
  console.error('════════════════════════════════════════════');
  console.error('');

  process.exit(2);
}

main().catch((error) => {
  console.error(`Stop hook error: ${error.message}`);
  process.exit(0);
});
