#!/usr/bin/env node
/**
 * Shared configuration and utilities for quality check hooks
 */

const path = require('path');
const fs = require('fs');

function findProjectRoot(startDir) {
  let dir = startDir;
  while (true) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('Could not find project root (no package.json found)');
    dir = parent;
  }
}

const projectRoot = findProjectRoot(__dirname);

const colors = {
  red: '\x1b[0;31m',
  green: '\x1b[0;32m',
  yellow: '\x1b[0;33m',
  blue: '\x1b[0;34m',
  cyan: '\x1b[0;36m',
  reset: '\x1b[0m',
};

function loadConfig() {
  let fileConfig = {};

  try {
    const configPath = path.join(__dirname, '..', 'hook-config.json');
    if (fs.existsSync(configPath)) {
      fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (e) {
    // Config file not found or invalid, use defaults
  }

  return {
    typescriptEnabled:
      process.env.CLAUDE_HOOKS_TYPESCRIPT_ENABLED !== undefined
        ? process.env.CLAUDE_HOOKS_TYPESCRIPT_ENABLED !== 'false'
        : (fileConfig.typescript?.enabled ?? true),
    showDependencyErrors:
      process.env.CLAUDE_HOOKS_SHOW_DEPENDENCY_ERRORS !== undefined
        ? process.env.CLAUDE_HOOKS_SHOW_DEPENDENCY_ERRORS === 'true'
        : (fileConfig.typescript?.showDependencyErrors ?? false),
    eslintEnabled:
      process.env.CLAUDE_HOOKS_ESLINT_ENABLED !== undefined
        ? process.env.CLAUDE_HOOKS_ESLINT_ENABLED !== 'false'
        : (fileConfig.eslint?.enabled ?? true),
    eslintAutofix:
      process.env.CLAUDE_HOOKS_ESLINT_AUTOFIX !== undefined
        ? process.env.CLAUDE_HOOKS_ESLINT_AUTOFIX === 'true'
        : (fileConfig.eslint?.autofix ?? false),
    prettierEnabled:
      process.env.CLAUDE_HOOKS_PRETTIER_ENABLED !== undefined
        ? process.env.CLAUDE_HOOKS_PRETTIER_ENABLED !== 'false'
        : (fileConfig.prettier?.enabled ?? true),
    prettierAutofix:
      process.env.CLAUDE_HOOKS_PRETTIER_AUTOFIX !== undefined
        ? process.env.CLAUDE_HOOKS_PRETTIER_AUTOFIX === 'true'
        : (fileConfig.prettier?.autofix ?? false),
    autofixSilent:
      process.env.CLAUDE_HOOKS_AUTOFIX_SILENT !== undefined
        ? process.env.CLAUDE_HOOKS_AUTOFIX_SILENT === 'true'
        : (fileConfig.general?.autofixSilent ?? false),
    debug:
      process.env.CLAUDE_HOOKS_DEBUG !== undefined
        ? process.env.CLAUDE_HOOKS_DEBUG === 'true'
        : (fileConfig.general?.debug ?? false),
    ignorePatterns: fileConfig.ignore?.patterns || [],
    _fileConfig: fileConfig,
  };
}

const config = loadConfig();

const log = {
  info: (msg) => console.error(`${colors.blue}[INFO]${colors.reset} ${msg}`),
  error: (msg) => console.error(`${colors.red}[ERROR]${colors.reset} ${msg}`),
  success: (msg) => console.error(`${colors.green}[OK]${colors.reset} ${msg}`),
  warning: (msg) => console.error(`${colors.yellow}[WARN]${colors.reset} ${msg}`),
  debug: (msg) => {
    if (config.debug) {
      console.error(`${colors.cyan}[DEBUG]${colors.reset} ${msg}`);
    }
  },
};

// Load optional modules
let ESLint, prettier, ts;

try {
  ({ ESLint } = require(path.join(projectRoot, 'node_modules', 'eslint')));
} catch (e) {
  log.debug('ESLint not found in project - will skip ESLint checks');
}

try {
  prettier = require(path.join(projectRoot, 'node_modules', 'prettier'));
} catch (e) {
  log.debug('Prettier not found in project - will skip Prettier checks');
}

try {
  ts = require(path.join(projectRoot, 'node_modules', 'typescript'));
} catch (e) {
  log.debug('TypeScript not found in project - will skip TypeScript checks');
}

module.exports = {
  projectRoot,
  colors,
  config,
  log,
  ESLint,
  prettier,
  ts,
};
