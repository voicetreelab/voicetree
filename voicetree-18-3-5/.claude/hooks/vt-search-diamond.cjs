#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

async function main() {
  let inputData = '';
  for await (const chunk of process.stdin) inputData += chunk;
  if (!inputData.trim()) process.exit(0);

  let input;
  try { input = JSON.parse(inputData); } catch { process.exit(0); }

  const vaultPath = process.env.VOICETREE_VAULT_PATH;
  const query = input.tool_input?.query;
  if (!vaultPath || !query) process.exit(0);

  const agentName = process.env.AGENT_NAME || 'unknown';
  const terminalId = process.env.VOICETREE_TERMINAL_ID || 'unknown';
  const timestamp = new Date().toISOString();

  // Extract search results from tool_response
  // Actual format: tool_response.results[0].content = [{ title, url }, ...]
  const results = [];
  const responseResults = input.tool_response?.results;
  if (Array.isArray(responseResults)) {
    for (const entry of responseResults) {
      if (entry && Array.isArray(entry.content)) {
        for (const item of entry.content) {
          if (item.url) {
            let domain;
            try { domain = new URL(item.url).hostname.replace(/^www\./, ''); } catch { domain = ''; }
            results.push({ title: item.title || '', url: item.url, domain, pageAge: item.page_age || '' });
          }
        }
      }
    }
  }

  var safeQuery = query.replace(/"/g, '\\"');
  var frontmatter = [
    '---', 'color: teal', 'shape: diamond', 'width: 30', 'height: 30',
    'searchQuery: "' + safeQuery + '"', 'agentName: ' + agentName,
    'terminalId: ' + terminalId, 'resultCount: ' + results.length,
    'timestamp: ' + timestamp, '---',
  ].join('\n');

  var body;
  if (results.length > 0) {
    var header = '| # | Title | Domain |\n|---|-------|--------|';
    var rows = results.map(function(r, i) {
      return '| ' + (i + 1) + ' | [' + r.title.slice(0, 80) + '](' + r.url + ') | ' + r.domain + ' |';
    }).join('\n');
    body = '# Search: ' + query + '\n\n' + header + '\n' + rows + '\n';
  } else {
    body = '# Search: ' + query + '\n\nNo results returned.\n';
  }

  fs.writeFileSync(path.join(vaultPath, 'search-' + Date.now() + '.md'), frontmatter + '\n' + body);
  process.exit(0);
}

main().catch(function() { process.exit(0); });
