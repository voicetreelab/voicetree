import { symbolFileEntries, summarizeSymbolCounts } from './_helpers.mjs';

const ALLOWED_AGENT_RUNTIME_WEBAPP_LAUNCHERS = new Set([
  'webapp/src/shell/edge/main/cli/commands/runtime/serve.ts',
]);

export const invariant = {
  id: 'webapp-agent-runtime',
  title: 'Webapp→agent-runtime back-channel invariant',
  packageName: '@vt/agent-runtime',
  threshold: 0,
  ruleLines: [
    'webapp/src/** must not embed @vt/agent-runtime at runtime;',
    'terminal ops cross the MCP-owned terminal surface. ideal=0.',
  ],
  check(data) {
    const runtimeEntries = symbolFileEntries(data.runtime.prod)
      .filter(({ file }) => file.startsWith('webapp/src/'));
    const allowlistedRuntimeEntries = runtimeEntries.filter(({ file }) =>
      ALLOWED_AGENT_RUNTIME_WEBAPP_LAUNCHERS.has(file)
    );
    const violationEntries = runtimeEntries.filter(({ file }) =>
      !ALLOWED_AGENT_RUNTIME_WEBAPP_LAUNCHERS.has(file)
    );
    const violationsByFile = new Map();

    for (const { symbol, file } of violationEntries) {
      if (!violationsByFile.has(file)) violationsByFile.set(file, []);
      violationsByFile.get(file).push(symbol);
    }

    return {
      violationCount: violationsByFile.size,
      importCount: violationEntries.length,
      allowlistedCount: allowlistedRuntimeEntries.length,
      allowlistedSummary: summarizeSymbolCounts(allowlistedRuntimeEntries),
      violationsByFile,
    };
  },
};
