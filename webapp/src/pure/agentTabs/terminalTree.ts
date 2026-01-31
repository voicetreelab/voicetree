import type { TerminalData } from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType';

/**
 * A terminal with computed tree depth for display
 */
export type TerminalTreeNode = {
  readonly terminal: TerminalData;
  readonly depth: number; // 0 = root, 1 = child, 2 = grandchild
};

/**
 * Transform flat terminal list into tree-ordered list with depths.
 * Uses DFS traversal: parent appears before children.
 *
 * @param terminals - Flat array of TerminalData
 * @returns Array of TerminalTreeNode in display order (parent, then children depth-first)
 */
export function buildTerminalTree(terminals: readonly TerminalData[]): TerminalTreeNode[] {
  if (terminals.length === 0) return [];

  // Build map of terminalId -> terminal for lookup
  const terminalById = new Map<string, TerminalData>();
  for (const terminal of terminals) {
    terminalById.set(terminal.terminalId, terminal);
  }

  // Separate roots from children, grouping children by parent
  const childrenByParentId = new Map<string, TerminalData[]>();
  const rootTerminals: TerminalData[] = [];

  for (const terminal of terminals) {
    const parentId = terminal.parentTerminalId;

    // Is root if: parentId is null OR parent doesn't exist (orphan)
    const isRoot = parentId === null || !terminalById.has(parentId);

    if (isRoot) {
      rootTerminals.push(terminal);
    } else {
      // Has a valid parent
      if (!childrenByParentId.has(parentId)) {
        childrenByParentId.set(parentId, []);
      }
      childrenByParentId.get(parentId)!.push(terminal);
    }
  }

  // DFS from roots
  const result: TerminalTreeNode[] = [];

  function dfs(terminal: TerminalData, depth: number) {
    result.push({ terminal, depth });
    const children = childrenByParentId.get(terminal.terminalId) || [];
    for (const child of children) {
      dfs(child, depth + 1);
    }
  }

  for (const root of rootTerminals) {
    dfs(root, 0);
  }

  return result;
}
