/**
 * @name Transitive cyclomatic complexity
 * @description For each function, the sum of cyclomatic complexity over its
 *   transitive callee set (reflexive). Surfaces the "deep functions" pattern
 *   where a small orchestrator hides a large total complexity in its callees.
 * @kind table
 * @id voicetree/transitive-complexity
 */

import javascript

/** Direct call edge between functions, resolved by CodeQL's name binding. */
predicate calls(Function caller, Function callee) {
  exists(InvokeExpr c | c.getEnclosingFunction() = caller and callee = c.getResolvedCallee())
}

from Function fn, string path, int line, string name, int directCx, int transitiveCx, int calleeCount
where
  path = fn.getFile().getRelativePath() and
  line = fn.getLocation().getStartLine() and
  name = fn.getName() and
  exists(fn.getName()) and
  directCx = fn.getCyclomaticComplexity() and
  // Reflexive transitive closure of the call graph; each callee counted once.
  transitiveCx = sum(Function callee | calls*(fn, callee) and exists(callee.getName()) | callee.getCyclomaticComplexity()) and
  calleeCount = count(Function callee | calls*(fn, callee) and exists(callee.getName()))
select path, line, name, directCx, transitiveCx, calleeCount
order by transitiveCx desc
