#!/usr/bin/env node
/**
 * File Size Check Hook for Codex (PostToolUse:apply_patch|Edit|Write|MultiEdit)
 *
 * Blocks the agent immediately if an edited source file exceeds 500 lines.
 * Codex apply_patch tool input is a patch text; this script extracts file
 * paths from `*** Add File:` / `*** Update File:` / `*** Move to:` lines.
 *
 * EXIT CODES:
 *   0 - All files within size limits (or not source files)
 *   2 - At least one file exceeds 500 lines — agent must split/refactor
 */

const fs = require('fs');
const path = require('path');

const MAX_LINES = 500;

function isSourceFile(filePath) {
  return /\.(ts|tsx|js|jsx|css|scss|less)$/.test(filePath);
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

  return [...new Set(files)];
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

  const toolInput = input.tool_input;
  if (!toolInput) process.exit(0);

  const patchPaths = extractPatchFilePaths(toolInput.command);
  if (patchPaths.length === 0) process.exit(0);

  const filePaths = patchPaths.map((p) => resolveFromCwd(p, input.cwd));

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
