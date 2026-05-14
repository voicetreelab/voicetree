/**
 * @name Purity by folder (recursive)
 * @description Aggregates impure-reachable function counts per folder, propagating
 *   counts to every ancestor folder so the measure applies at every level of the tree.
 * @kind table
 * @id voicetree/purity-by-folder
 */

import javascript

predicate impureModuleName(string name) {
  name = "fs" or name = "fs/promises" or name = "node:fs" or name = "node:fs/promises" or
  name = "http" or name = "https" or name = "node:http" or name = "node:https" or
  name = "node:net" or name = "node:dgram" or name = "node:tls" or
  name = "node:child_process" or name = "child_process" or
  name = "axios" or name = "node-fetch" or name = "undici"
}

class ImpureSink extends DataFlow::Node {
  ImpureSink() {
    exists(string m | impureModuleName(m) | this = DataFlow::moduleImport(m).getAPropertyRead(_)) or
    exists(string m | impureModuleName(m) | this = DataFlow::moduleImport(m)) or
    this = DataFlow::globalVarRef("fetch") or
    this = DataFlow::globalVarRef("XMLHttpRequest") or
    this = DataFlow::globalVarRef("process").getAPropertyRead(_)
  }
}

predicate directlyImpure(Function fn) { exists(ImpureSink sink | sink.getContainer() = fn) }

predicate calls(Function caller, Function callee) {
  exists(InvokeExpr c | c.getEnclosingFunction() = caller and callee = c.getResolvedCallee())
}

predicate reachesImpure(Function fn) {
  directlyImpure(fn) or
  exists(Function callee | calls(fn, callee) and reachesImpure(callee))
}

/**
 * `f` is an ancestor folder (or the file's own folder) of the file containing `fn`.
 * This is the recursive-folder-as-module step: each function is attributed to
 * every folder up the chain.
 */
predicate functionInFolder(Function fn, Folder f) {
  fn.getFile().getParentContainer+() = f
}

from Folder f, int impureCount, int totalCount, float ratio
where
  totalCount = count(Function fn | functionInFolder(fn, f) and exists(fn.getName())) and
  totalCount > 0 and
  impureCount = count(Function fn |
    functionInFolder(fn, f) and exists(fn.getName()) and reachesImpure(fn)
  ) and
  ratio = (impureCount * 1.0) / totalCount
select f.getRelativePath() as folder, totalCount, impureCount, ratio
order by ratio desc, impureCount desc
