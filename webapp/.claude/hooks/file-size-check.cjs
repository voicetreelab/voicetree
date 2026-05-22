#!/usr/bin/env node
/**
 * File Size Check Hook (PostToolUse:Write|Edit|MultiEdit|apply_patch)
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
  return /\.(ts|tsx|js|jsx|css|scss|less)$/.test(filePath);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function resolveFromCwd(filePath, cwd) {
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(cwd || process.cwd(), filePath);
}

function extractPatchFilePaths(command) {
  if (typeof command !== 'string') return [];

  const files = [];
  for (const line of command.split(/\r?\n/)) {
    const add = line.match(/^\*\*\* Add File: (.+)$/);
    if (add) {
      files.push(add[1]);
      continue;
    }

    const update = line.match(/^\*\*\* Update File: (.+)$/);
    if (update) {
      files.push(update[1]);
      continue;
    }

    const move = line.match(/^\*\*\* Move to: (.+)$/);
    if (move) {
      files.push(move[1]);
    }
  }

  return files;
}

function getCandidateFilePaths(input) {
  const toolInput = input.tool_input;
  if (!toolInput) return [];

  const directPath = toolInput.file_path || toolInput.absolutePath || toolInput.notebook_path || null;
  const patchPaths = extractPatchFilePaths(toolInput.command);
  return unique([directPath, ...patchPaths]).map((filePath) => resolveFromCwd(filePath, input.cwd));
}

function oversizedMessage(filePath, lineCount) {
  return [
    '',
    '\x1b[0;31m════════════════════════════════════════════\x1b[0m',
    `\x1b[0;31m❌ FILE TOO LARGE: ${path.basename(filePath)}\x1b[0m`,
    `\x1b[0;31m   ${lineCount} lines — limit is ${MAX_LINES}\x1b[0m`,
    '\x1b[0;31m════════════════════════════════════════════\x1b[0m',
    '\x1b[0;33mExtract this file into multiple files.\x1b[0m',
    '\x1b[0;33mUse functional programming philosophy to guide your extraction.\x1b[0m',
    '\x1b[0;33mPure functions are ideal, edge with side effects when necessary, avoid OOP.\x1b[0m',
  ];
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

  const filePaths = getCandidateFilePaths(input);
  if (filePaths.length === 0) process.exit(0);

  let foundOversizedFile = false;
  for (const filePath of filePaths) {
    if (!isSourceFile(filePath)) continue;

    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }

    const lineCount = content.split('\n').length;
    if (lineCount <= MAX_LINES) continue;

    foundOversizedFile = true;
    for (const line of oversizedMessage(filePath, lineCount)) {
      console.error(line);
    }
  }

  process.exit(foundOversizedFile ? 2 : 0);
}

main().catch(() => process.exit(0));
