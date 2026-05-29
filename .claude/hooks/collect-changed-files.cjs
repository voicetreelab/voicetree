#!/usr/bin/env node
/**
 * Collect Changed Files Hook (PostToolUse:Edit)
 *
 * Instead of running the full quality check on every edit,
 * just record which files were changed. The Stop hook will
 * run quality checks against all accumulated files at once.
 *
 * Changed files are stored per-session at:
 *   /tmp/claude-changed-files-{session_id}.txt
 *
 * EXIT CODES:
 *   0 - Always (never blocks edits)
 */

const fs = require('fs');
const path = require('path');

function isSourceFile(filePath) {
  return /\.(ts|tsx|js|jsx)$/.test(filePath);
}

async function main() {
  let inputData = '';
  for await (const chunk of process.stdin) {
    inputData += chunk;
  }

  if (!inputData.trim()) {
    process.exit(0);
  }

  let input;
  try {
    input = JSON.parse(inputData);
  } catch {
    process.exit(0);
  }

  const sessionId = input.session_id;
  if (!sessionId) {
    process.exit(0);
  }

  const toolInput = input.tool_input;
  if (!toolInput) {
    process.exit(0);
  }

  const filePath = toolInput.file_path || toolInput.absolutePath || toolInput.notebook_path || null;
  if (!filePath) {
    process.exit(0);
  }

  if (!isSourceFile(filePath)) {
    process.exit(0);
  }

  // Append file path to per-session tracking file
  const trackingFile = path.join('/tmp', `claude-changed-files-${sessionId}.txt`);
  fs.appendFileSync(trackingFile, filePath + '\n');

  process.exit(0);
}

main().catch(() => process.exit(0));
