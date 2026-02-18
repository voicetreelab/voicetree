#!/usr/bin/env node
/**
 * Stop Quality Check Hook
 *
 * Runs on the Stop event. Reads the per-session list of changed files
 * accumulated by collect-changed-files.cjs, deduplicates them, and
 * runs quality checks on each file that still exists.
 *
 * EXIT CODES:
 *   0 - All checks passed (or no files to check) — agent may stop
 *   2 - Quality issues found — blocks the stop, agent must fix
 */

const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const { colors, config, log } = require('./lib/config.cjs');
const QualityChecker = require('./lib/quality-checker.cjs');

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

  // Prevent infinite loop: if we already ran and blocked once,
  // don't block again on the same stop cycle
  if (input.stop_hook_active) {
    process.exit(0);
  }

  const sessionId = input.session_id;
  if (!sessionId) {
    process.exit(0);
  }

  const trackingFile = path.join('/tmp', `claude-changed-files-${sessionId}.txt`);

  if (!fs.existsSync(trackingFile)) {
    process.exit(0);
  }

  // Read and deduplicate changed files
  const content = fs.readFileSync(trackingFile, 'utf8').trim();
  if (!content) {
    cleanup(trackingFile);
    process.exit(0);
  }

  const uniqueFiles = [...new Set(content.split('\n').filter(Boolean))];

  // Filter to files that still exist
  const existingFiles = [];
  for (const filePath of uniqueFiles) {
    try {
      await fsPromises.access(filePath);
      existingFiles.push(filePath);
    } catch {
      // File was deleted, skip
    }
  }

  if (existingFiles.length === 0) {
    cleanup(trackingFile);
    process.exit(0);
  }

  const hookVersion = config._fileConfig.version || '1.0.0';
  console.error('');
  console.error(`📦 Node.js Quality Check v${hookVersion} - Stop Hook`);
  console.error(`   Checking ${existingFiles.length} changed file(s)...`);
  console.error('────────────────────────────────────────────');

  const allErrors = [];
  const allAutofixes = [];

  for (const filePath of existingFiles) {
    console.error('');
    console.error(`🔍 Validating: ${path.basename(filePath)}`);
    console.error('────────────────────────────────────────────');
    log.info(`Checking: ${filePath}`);

    const checker = new QualityChecker(filePath);
    const { errors, autofixes } = await checker.checkAll();

    if (autofixes.length > 0) {
      allAutofixes.push(...autofixes.map((fix) => `${path.basename(filePath)}: ${fix}`));
    }

    if (errors.length > 0) {
      allErrors.push(...errors);
    } else {
      console.error(`${colors.green}✅ ${path.basename(filePath)} passed${colors.reset}`);
    }
  }

  // Print summary
  if (allAutofixes.length > 0) {
    console.error(`\n${colors.blue}═══ Auto-fixes Applied ═══${colors.reset}`);
    allAutofixes.forEach((fix) => {
      console.error(`${colors.green}✨${colors.reset} ${fix}`);
    });
  }

  if (allErrors.length > 0) {
    const editedFileErrors = allErrors.filter(
      (e) =>
        e.includes('edited file') ||
        e.includes('ESLint found issues') ||
        e.includes('Prettier formatting issues') ||
        e.includes('console statements') ||
        e.includes("'as any' usage") ||
        e.includes('were auto-fixed'),
    );

    if (editedFileErrors.length > 0) {
      console.error(`\n${colors.blue}═══ Quality Check Summary ═══${colors.reset}`);
      editedFileErrors.forEach((error) => {
        console.error(`${colors.red}❌${colors.reset} ${error}`);
      });
      console.error(`\n${colors.red}Found ${editedFileErrors.length} issue(s) that MUST be fixed!${colors.reset}`);
      console.error(`${colors.red}════════════════════════════════════════════${colors.reset}`);
      console.error(`${colors.red}❌ FIX BEFORE STOPPING ❌${colors.reset}`);
      console.error(`${colors.red}════════════════════════════════════════════${colors.reset}`);

      // Don't clean up tracking file — agent will edit and re-accumulate
      // Clear the file so only new edits are checked next time
      fs.writeFileSync(trackingFile, '');
      process.exit(2);
    }
  }

  // All passed — clean up
  console.error(`\n${colors.green}✅ All ${existingFiles.length} changed file(s) passed quality checks${colors.reset}`);
  cleanup(trackingFile);
  process.exit(0);
}

function cleanup(trackingFile) {
  try {
    fs.unlinkSync(trackingFile);
  } catch {
    // Ignore cleanup errors
  }
}

process.on('unhandledRejection', (error) => {
  log.error(`Unhandled error: ${error.message}`);
  process.exit(0); // Don't block stop on internal errors
});

main().catch((error) => {
  log.error(`Fatal error: ${error.message}`);
  process.exit(0); // Don't block stop on internal errors
});
