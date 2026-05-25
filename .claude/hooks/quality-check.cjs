#!/usr/bin/env node
/**
 * Node.js Quality Check Hook - Main Entry Point
 *
 * EXIT CODES:
 *   0 - Success (all checks passed)
 *   1 - General error (missing dependencies, etc.)
 *   2 - Quality issues found - ALL must be fixed (blocking)
 */

const fs = require('fs').promises;
const path = require('path');
const { colors, config, log } = require('./lib/config.cjs');
const QualityChecker = require('./lib/quality-checker.cjs');

async function parseJsonInput() {
  let inputData = '';
  for await (const chunk of process.stdin) {
    inputData += chunk;
  }

  if (!inputData.trim()) {
    log.warning('No JSON input provided. This hook expects JSON input from Claude Code.');
    console.error(`\n${colors.yellow}👉 Hook executed but no input to process.${colors.reset}`);
    process.exit(0);
  }

  try {
    return JSON.parse(inputData);
  } catch (error) {
    log.error(`Failed to parse JSON input: ${error.message}`);
    process.exit(1);
  }
}

function extractFilePath(input) {
  const { tool_input } = input;
  if (!tool_input) return null;
  return tool_input.file_path || tool_input.absolutePath || tool_input.notebook_path || null;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isSourceFile(filePath) {
  return /\.(ts|tsx|js|jsx)$/.test(filePath);
}

function printSummary(errors, autofixes) {
  if (autofixes.length > 0) {
    console.error(`\n${colors.blue}═══ Auto-fixes Applied ═══${colors.reset}`);
    autofixes.forEach((fix) => {
      console.error(`${colors.green}✨${colors.reset} ${fix}`);
    });
    console.error(`${colors.green}Automatically fixed ${autofixes.length} issue(s) for you!${colors.reset}`);
  }

  if (errors.length > 0) {
    console.error(`\n${colors.blue}═══ Quality Check Summary ═══${colors.reset}`);
    errors.forEach((error) => {
      console.error(`${colors.red}❌${colors.reset} ${error}`);
    });
    console.error(`\n${colors.red}Found ${errors.length} issue(s) that MUST be fixed!${colors.reset}`);
    console.error(`${colors.red}════════════════════════════════════════════${colors.reset}`);
    console.error(`${colors.red}❌ ALL ISSUES ARE BLOCKING ❌${colors.reset}`);
    console.error(`${colors.red}════════════════════════════════════════════${colors.reset}`);
    console.error(`${colors.red}Fix EVERYTHING above until all checks are ✅ GREEN${colors.reset}`);
  }
}

async function main() {
  const hookVersion = config._fileConfig.version || '1.0.0';
  console.error('');
  console.error(`📦 Node.js Quality Check v${hookVersion} - Starting...`);
  console.error('────────────────────────────────────────────');

  log.debug(`Loaded config: ${JSON.stringify(config, null, 2)}`);

  const input = await parseJsonInput();
  const filePath = extractFilePath(input);

  if (!filePath) {
    log.warning('No file path found in JSON input.');
    console.error(`\n${colors.yellow}👉 No file to check - tool may not be file-related.${colors.reset}`);
    process.exit(0);
  }

  if (!(await fileExists(filePath))) {
    log.info(`File does not exist: ${filePath} (may have been deleted)`);
    console.error(`\n${colors.yellow}👉 File skipped - doesn't exist.${colors.reset}`);
    process.exit(0);
  }

  if (!isSourceFile(filePath)) {
    log.info(`Skipping non-source file: ${filePath}`);
    console.error(`\n${colors.green}✅ No checks needed for ${path.basename(filePath)}${colors.reset}`);
    process.exit(0);
  }

  console.error('');
  console.error(`🔍 Validating: ${path.basename(filePath)}`);
  console.error('────────────────────────────────────────────');
  log.info(`Checking: ${filePath}`);

  const checker = new QualityChecker(filePath);
  const { errors, autofixes } = await checker.checkAll();

  printSummary(errors, autofixes);

  const editedFileErrors = errors.filter(
    (e) =>
      e.includes('edited file') ||
      e.includes('ESLint found issues') ||
      e.includes('Prettier formatting issues') ||
      e.includes('console statements') ||
      e.includes("'as any' usage") ||
      e.includes('were auto-fixed'),
  );

  const dependencyWarnings = errors.filter((e) => !editedFileErrors.includes(e));

  if (editedFileErrors.length > 0) {
    console.error(`\n${colors.red}🛑 FAILED - Fix issues in your edited file! 🛑${colors.reset}`);
    console.error(`${colors.cyan}💡 CLAUDE.md CHECK:${colors.reset}`);
    console.error(`${colors.cyan}  → What CLAUDE.md pattern would have prevented this?${colors.reset}`);
    console.error(`${colors.yellow}📋 NEXT STEPS:${colors.reset}`);
    console.error(`${colors.yellow}  1. Fix the issues listed above${colors.reset}`);
    console.error(`${colors.yellow}  2. The hook will run again automatically${colors.reset}`);
    console.error(`${colors.yellow}  3. Continue with your original task once all checks pass${colors.reset}`);
    process.exit(2);
  } else if (dependencyWarnings.length > 0) {
    console.error(`\n${colors.yellow}⚠️ WARNING - Dependency issues found${colors.reset}`);
    console.error(`${colors.green}✅ Quality check passed for ${path.basename(filePath)}${colors.reset}`);
    process.exit(0);
  } else {
    console.error(`\n${colors.green}✅ Quality check passed for ${path.basename(filePath)}${colors.reset}`);
    if (autofixes.length > 0 && config.autofixSilent) {
      console.error(`\n${colors.yellow}👉 File quality verified. Auto-fixes applied. Continue with your task.${colors.reset}`);
    } else {
      console.error(`\n${colors.yellow}👉 File quality verified. Continue with your task.${colors.reset}`);
    }
    process.exit(0);
  }
}

process.on('unhandledRejection', (error) => {
  log.error(`Unhandled error: ${error.message}`);
  process.exit(1);
});

main().catch((error) => {
  log.error(`Fatal error: ${error.message}`);
  process.exit(1);
});
