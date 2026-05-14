/**
 * @name Transitive cyclomatic complexity by folder (recursive)
 * @description Folder-aggregated transitive cyclomatic complexity. Each function
 *   is attributed to every ancestor folder via getParentContainer+(), so the
 *   measure exists at every level of the tree in a single query.
 * @kind table
 * @id voicetree/transitive-complexity-by-folder
 */

import javascript

predicate calls(Function caller, Function callee) {
  exists(InvokeExpr c | c.getEnclosingFunction() = caller and callee = c.getResolvedCallee())
}

predicate functionInFolder(Function fn, Folder f) {
  fn.getFile().getParentContainer+() = f and exists(fn.getName())
}

int transitiveComplexity(Function fn) {
  result = sum(Function callee | calls*(fn, callee) and exists(callee.getName()) | callee.getCyclomaticComplexity())
}

from Folder f, int totalFunctions, int maxTransitive, int sumTransitive, float meanTransitive
where
  totalFunctions = count(Function fn | functionInFolder(fn, f)) and
  totalFunctions > 0 and
  maxTransitive = max(Function fn | functionInFolder(fn, f) | transitiveComplexity(fn)) and
  sumTransitive = sum(Function fn | functionInFolder(fn, f) | transitiveComplexity(fn)) and
  meanTransitive = (sumTransitive * 1.0) / totalFunctions
select f.getRelativePath() as folder, totalFunctions, maxTransitive, sumTransitive, meanTransitive
order by maxTransitive desc
