/**
 * @name Semantic coupling between packages
 * @description For each ordered pair of top-level packages (libraries/X or systems/X),
 *   weighted coupling = distinct cross-package callees + distinct cross-package
 *   type references. Distinguishes from import-count coupling: a single import
 *   pulling 10 symbols contributes weight 10 here, not 1.
 * @kind table
 * @id voicetree/semantic-coupling
 */

import javascript

/** A top-level VT package folder: libraries/<name> or systems/<name>. */
predicate isPackageFolder(Folder f) {
  exists(string p | p = f.getRelativePath() |
    p.regexpMatch("libraries/[^/]+") or
    p.regexpMatch("systems/[^/]+"))
}

/** Walk up the file's container chain to find its enclosing package folder. */
predicate packageOf(File file, Folder pkg) {
  isPackageFolder(pkg) and file.getParentContainer+() = pkg
}

/** Cross-package callee edges (caller pkg, distinct callee fn, callee pkg). */
predicate crossPkgCall(Folder srcPkg, Folder tgtPkg, Function callee) {
  exists(InvokeExpr c, Function caller |
    c.getEnclosingFunction() = caller and
    callee = c.getResolvedCallee() and
    packageOf(caller.getFile(), srcPkg) and
    packageOf(callee.getFile(), tgtPkg) and
    srcPkg != tgtPkg
  )
}

/**
 * Distinct named import bindings used across packages (the import-symbol surface).
 * E.g. `import {a, b, c} from '@vt/x'` contributes 3 named bindings.
 * Captures type-only imports too — `LocalTypeAccess.getLocalTypeName()` resolves
 * imported types to the import declaration, which we side-step here by counting
 * specifiers instead of type-decl targets.
 */
predicate crossPkgImportBinding(Folder srcPkg, Folder tgtPkg, string name) {
  exists(ImportDeclaration id, ImportSpecifier spec, Module mod |
    packageOf(id.getFile(), srcPkg) and
    spec = id.getASpecifier() and
    name = spec.getImportedName() and
    mod = id.getImportedModule() and
    packageOf(mod.getFile(), tgtPkg) and
    srcPkg != tgtPkg
  )
}

from Folder srcPkg, Folder tgtPkg, int callEdges, int importBindings, int weight
where
  callEdges = count(Function f | crossPkgCall(srcPkg, tgtPkg, f)) and
  importBindings = count(string n | crossPkgImportBinding(srcPkg, tgtPkg, n)) and
  weight = callEdges + importBindings and
  weight > 0
select srcPkg.getRelativePath() as src, tgtPkg.getRelativePath() as tgt, callEdges, importBindings, weight
order by weight desc
