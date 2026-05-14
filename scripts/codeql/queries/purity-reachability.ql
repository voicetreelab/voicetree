/**
 * @name Purity reachability
 * @description Functions whose transitive call graph reaches an impure sink
 *   (filesystem, network, process). Used as a maintainability/correctness
 *   measure aligned with VT's "push impurity to edge/shell" philosophy.
 * @kind table
 * @id voicetree/purity-reachability
 */

import javascript

/** Module specifiers considered impure (filesystem, network, process control). */
predicate impureModuleName(string name) {
  name = "fs" or
  name = "fs/promises" or
  name = "node:fs" or
  name = "node:fs/promises" or
  name = "http" or
  name = "https" or
  name = "node:http" or
  name = "node:https" or
  name = "node:net" or
  name = "node:dgram" or
  name = "node:tls" or
  name = "node:child_process" or
  name = "child_process" or
  name = "axios" or
  name = "node-fetch" or
  name = "undici"
}

/** A node that directly performs an impure side effect. */
class ImpureSink extends DataFlow::Node {
  ImpureSink() {
    // Any reference to an impure module's API surface
    exists(string m | impureModuleName(m) | this = DataFlow::moduleImport(m).getAPropertyRead(_)) or
    exists(string m | impureModuleName(m) | this = DataFlow::moduleImport(m)) or
    // global fetch / XMLHttpRequest
    this = DataFlow::globalVarRef("fetch") or
    this = DataFlow::globalVarRef("XMLHttpRequest") or
    // process.* state and side effects
    this = DataFlow::globalVarRef("process").getAPropertyRead(_)
  }
}

/** A function that directly references an impure sink in its own body. */
predicate directlyImpure(Function fn) {
  exists(ImpureSink sink | sink.getContainer() = fn)
}

/** A direct callee resolved at a call site within `caller`. */
predicate calls(Function caller, Function callee) {
  exists(InvokeExpr call |
    call.getEnclosingFunction() = caller and
    callee = call.getResolvedCallee()
  )
}

/** Transitive reachability of an impure function via the call graph. */
predicate reachesImpure(Function fn) {
  directlyImpure(fn)
  or
  exists(Function callee | calls(fn, callee) and reachesImpure(callee))
}

from Function fn, string path, int line, string name, string kind
where
  reachesImpure(fn) and
  path = fn.getFile().getRelativePath() and
  line = fn.getLocation().getStartLine() and
  name = fn.getName() and
  // Only report named functions to keep noise down
  exists(fn.getName()) and
  (if directlyImpure(fn) then kind = "direct" else kind = "transitive")
select path, line, name, kind
