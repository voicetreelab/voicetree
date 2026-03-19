#!/usr/bin/env node
/**
 * Web Search Diamond Node Hook (PostToolUse:WebSearch)
 *
 * Creates a teal diamond node in the VoiceTree graph every time
 * an agent performs a web search. The diamond logs the query,
 * results, and agent context for auditability.
 *
 * Reads agent context from env vars set by VoiceTree at spawn:
 *   VOICETREE_VAULT_PATH, AGENT_NAME, VOICETREE_TERMINAL_ID
 *
 * EXIT CODES:
 *   0 - Always (never blocks the agent)
 */

const fs = require('fs');
const path = require('path');

async function main() {
  const debugLog = (msg) => {
    try { fs.appendFileSync('/tmp/search-diamond-debug.log', `${new Date().toISOString()} ${msg}\n`); } catch {}
  };

  debugLog('Hook fired');

  let inputData = '';
  for await (const chunk of process.stdin) {
    inputData += chunk;
  }

  if (!inputData.trim()) { debugLog('Empty stdin'); process.exit(0); }

  let input;
  try {
    input = JSON.parse(inputData);
  } catch {
    debugLog('JSON parse failed'); process.exit(0);
  }

  debugLog(`tool_name=${input.tool_name} query=${input.tool_input?.query}`);

  const vaultPath = process.env.VOICETREE_VAULT_PATH;
  if (!vaultPath) { debugLog('No VOICETREE_VAULT_PATH'); process.exit(0); }

  const query = input.tool_input?.query;
  if (!query) { debugLog('No query in tool_input'); process.exit(0); }

  const agentName = process.env.AGENT_NAME || 'unknown';
  const terminalId = process.env.VOICETREE_TERMINAL_ID || 'unknown';
  const timestamp = new Date().toISOString();

  // Parse results from tool_response
  const results = [];
  const responseContent = input.tool_response?.content;
  if (Array.isArray(responseContent)) {
    for (const item of responseContent) {
      if (item.type === 'web_search_result' && item.url) {
        let domain;
        try { domain = new URL(item.url).hostname.replace(/^www\./, ''); } catch { domain = ''; }
        results.push({
          title: item.title || '',
          url: item.url,
          domain,
          pageAge: item.page_age || '',
        });
      }
    }
  }

  // Compose frontmatter
  const safeQuery = query.replace(/"/g, '\\"');
  const frontmatter = [
    '---',
    'color: teal',
    'shape: diamond',
    'width: 30',
    'height: 30',
    `searchQuery: "${safeQuery}"`,
    `agentName: ${agentName}`,
    `terminalId: ${terminalId}`,
    `resultCount: ${results.length}`,
    `timestamp: ${timestamp}`,
    '---',
  ].join('\n');

  // Compose body
  const header = `# Search: ${query}\n`;
  let body;
  if (results.length > 0) {
    const tableHeader = '| # | Title | Domain | Age | Used? |\n|---|-------|--------|-----|-------|';
    const tableRows = results.map((r, i) =>
      `| ${i + 1} | ${r.title.slice(0, 80)} | ${r.domain} | ${r.pageAge} | — |`
    ).join('\n');
    body = `${header}\n${tableHeader}\n${tableRows}\n`;
  } else {
    body = `${header}\nNo results returned.\n`;
  }

  // Write file
  const filename = `search-${Date.now()}.md`;
  fs.writeFileSync(path.join(vaultPath, filename), `${frontmatter}\n${body}`);
  process.exit(0);
}

main().catch(() => process.exit(0));
