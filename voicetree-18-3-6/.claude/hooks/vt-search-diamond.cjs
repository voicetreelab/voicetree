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
  if (!vaultPath) process.exit(0);

  const agent = process.env.AGENT_NAME || process.env.VOICETREE_TERMINAL_ID || 'unknown';
  const time = new Date().toISOString().slice(11, 16); // HH:MM

  const toolName = input.tool_name || '';
  let entry;

  if (toolName === 'WebSearch') {
    const query = input.tool_input?.query;
    if (!query) process.exit(0);
    entry = { type: 'search', query, agent, time };
  } else if (toolName === 'WebFetch') {
    const url = input.tool_input?.url;
    if (!url) process.exit(0);
    let domain;
    try { domain = new URL(url).hostname.replace(/^www\./, ''); } catch { domain = url; }
    entry = { type: 'fetch', url, domain, agent, time };
  } else {
    process.exit(0);
  }

  const logPath = path.join(vaultPath, '.research-trail.jsonl');
  fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
  process.exit(0);
}

main().catch(function() { process.exit(0); });
