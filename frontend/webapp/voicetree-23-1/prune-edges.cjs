#!/usr/bin/env node
/**
 * Script to prune edges in the VoiceTree graph.
 * Keeps only the first wikilink edge per markdown file and removes the rest.
 */

const fs = require('fs');
const path = require('path');

const GRAPH_DIR = __dirname;
const WIKILINK_REGEX = /\[\[([^\]]+)\]\]/g;

function processFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');

  // Find all wikilinks
  const matches = [...content.matchAll(WIKILINK_REGEX)];

  if (matches.length <= 1) {
    // No pruning needed - 0 or 1 edge
    return { file: path.basename(filePath), originalCount: matches.length, removed: 0 };
  }

  // Keep only the first wikilink, remove all others
  const firstMatch = matches[0];
  let newContent = content;

  // Process in reverse order to avoid offset issues
  for (let i = matches.length - 1; i > 0; i--) {
    const match = matches[i];
    // Replace the wikilink with empty string (keeping surrounding structure)
    const startIndex = match.index;
    const endIndex = match.index + match[0].length;
    newContent = newContent.slice(0, startIndex) + newContent.slice(endIndex);
  }

  // Clean up empty lines and orphaned list items
  newContent = cleanupContent(newContent);

  fs.writeFileSync(filePath, newContent);

  return {
    file: path.basename(filePath),
    originalCount: matches.length,
    removed: matches.length - 1,
    keptLink: firstMatch[1]
  };
}

function cleanupContent(content) {
  // Remove empty list items (lines that are just "- " after removing link)
  content = content.replace(/^- \s*$/gm, '');

  // Remove orphaned section headers with no content
  // (headers followed by blank lines until next header or end)
  const lines = content.split('\n');
  const result = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines that resulted from removed links
    if (trimmed === '' && result.length > 0 && result[result.length - 1].trim() === '') {
      continue;
    }

    // Check if this is a section header (like "Parent:", "Children:", "Uses:", etc.)
    if (trimmed.match(/^[A-Za-z]+:$/) || trimmed.match(/^[A-Za-z\s]+:$/)) {
      // Look ahead to see if there's content
      let hasContent = false;
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j].trim();
        if (nextLine === '') continue;
        if (nextLine.startsWith('- [[') || nextLine.startsWith('-[[')) {
          hasContent = true;
          break;
        }
        if (nextLine.match(/^[A-Za-z]+:$/) || nextLine.match(/^[A-Za-z\s]+:$/)) {
          break;
        }
        if (nextLine.startsWith('- ') || nextLine.startsWith('-')) {
          hasContent = true;
          break;
        }
        break;
      }
      if (!hasContent) {
        // Skip this orphaned header
        continue;
      }
    }

    result.push(line);
  }

  // Remove trailing empty lines except one
  while (result.length > 1 && result[result.length - 1].trim() === '' && result[result.length - 2].trim() === '') {
    result.pop();
  }

  return result.join('\n');
}

function main() {
  console.log('Pruning edges in VoiceTree graph...\n');
  console.log(`Directory: ${GRAPH_DIR}\n`);

  // Get all markdown files in the directory (not in subdirectories to skip ctx-nodes, voice)
  const files = fs.readdirSync(GRAPH_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => path.join(GRAPH_DIR, f));

  console.log(`Found ${files.length} markdown files\n`);

  const results = [];

  for (const file of files) {
    const result = processFile(file);
    results.push(result);
  }

  // Summary
  console.log('Results:');
  console.log('--------');

  const modified = results.filter(r => r.removed > 0);
  const unchanged = results.filter(r => r.removed === 0);

  console.log(`\nModified files (${modified.length}):`);
  for (const r of modified) {
    console.log(`  ${r.file}: ${r.originalCount} -> 1 (kept: [[${r.keptLink}]])`);
  }

  console.log(`\nUnchanged files (${unchanged.length}):`);
  for (const r of unchanged) {
    console.log(`  ${r.file}: ${r.originalCount} edge(s)`);
  }

  console.log(`\nTotal edges removed: ${results.reduce((sum, r) => sum + r.removed, 0)}`);
}

main();
