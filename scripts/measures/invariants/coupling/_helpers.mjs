export function symbolFileEntries(symbolFiles) {
  return [...symbolFiles.entries()].flatMap(([symbol, files]) =>
    [...files].map(file => ({ symbol, file }))
  );
}

export function summarizeSymbolCounts(entries) {
  const counts = new Map();
  for (const { symbol, file } of entries) {
    if (!counts.has(symbol)) counts.set(symbol, new Set());
    counts.get(symbol).add(file);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
    .map(([symbol, files]) => `${symbol}(${files.size})`);
}
