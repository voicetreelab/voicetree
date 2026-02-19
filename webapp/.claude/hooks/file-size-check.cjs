#!/usr/bin/env node
/**
 * File Size Check Hook (PostToolUse:Write|Edit|MultiEdit)
 *
 * Blocks the agent immediately if an edited source file exceeds 500 lines.
 * This fires on every edit — not batched like the Stop quality check — so the
 * agent gets instant feedback and must refactor before continuing.
 *
 * EXIT CODES:
 *   0 - File is within size limits (or not a source file)
 *   2 - File exceeds 500 lines — agent must split/refactor before continuing
 */

const fs = require('fs');
const path = require('path');

const MAX_LINES = 500;

function isSourceFile(filePath) {
  return /\.(ts|tsx|js|jsx)$/.test(filePath);
}

async function main() {
  let inputData = '';
  for await (const chunk of process.stdin) {
    inputData += chunk;
  }

  if (!inputData.trim()) process.exit(0);

  let input;
  try {
    input = JSON.parse(inputData);
  } catch {
    process.exit(0);
  }

  const toolInput = input.tool_input;
  if (!toolInput) process.exit(0);

  const filePath = toolInput.file_path || toolInput.absolutePath || toolInput.notebook_path || null;
  if (!filePath) process.exit(0);

  if (!isSourceFile(filePath)) process.exit(0);

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    process.exit(0);
  }

  const lineCount = content.split('\n').length;

  if (lineCount > MAX_LINES) {
    console.error('');
    console.error('\x1b[0;31m════════════════════════════════════════════\x1b[0m');
    console.error(`\x1b[0;31m❌ FILE TOO LARGE: ${path.basename(filePath)}\x1b[0m`);
    console.error(`\x1b[0;31m   ${lineCount} lines — limit is ${MAX_LINES}\x1b[0m`);
    console.error('\x1b[0;31m════════════════════════════════════════════\x1b[0m');
    console.error('\x1b[0;33mSplit this file into smaller modules before continuing.\x1b[0m');
    console.error('\x1b[0;33mEach module should have a single responsibility.\x1b[0m');
    process.exit(2);
  }

  process.exit(0);
}

main().catch(() => process.exit(0));
