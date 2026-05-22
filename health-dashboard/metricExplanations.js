// Paragraph-length explanations for every codebase-health metric the dashboard
// can render. Lookup is by metricId; the `globals-*` family shares one
// explanation, and any unrecognized id falls back to a category-derived note.
//
// Tone: concise editorial — what it measures, what signal it carries, how the
// reader should interpret a high/low value. Plain prose, no bullets, no jargon
// without a one-clause definition.

const METRIC_EXPLANATIONS = {
  // ── Structural / Import-graph topology ─────────────────────────────────────
  'treewidth':
    "Tree-width is a structural-computational complexity measure on the package import graph: it answers “how many packages must I reason about simultaneously to understand any dependency chain?” The MCS lower-bound elimination ordering produces an upper bound on the smallest bag size of any tree decomposition; bigger bags mean tightly tangled dependencies that can’t be cleanly factored into independent subsystems. A tree-width of 1 is a true tree (perfect hierarchy); higher values approximate joint-factorization cost, the structural dual to Shannon entropy.",

  'boundary-treewidth':
    "Same tree-width measure, but applied to the file-level cross-boundary import graph rather than the package graph. It captures the shape of the seams between packages — how tangled the surfaces are, not just how many edges cross. A facade with one passthrough file scores low even if downstream packages import heavily from it; a sprawling interface where many files reach across many partners scores high. Surfaces the structural irreducibility that volume metrics miss.",

  'modularity-q':
    "Modularity Q scores how well the current package boundaries cluster the file-level import graph against a null model where edges are placed at random while preserving each node’s degree. Q > 0.3 indicates meaningful modular structure, Q > 0.7 indicates very clean boundaries. The measure is partitionability, not complexity — a low Q tells you that the files would naturally cluster into different groups than the packages currently impose, i.e. the boundaries are in the wrong place.",

  'graph-entropy':
    "Normalized Shannon entropy of the package import-degree distribution. Maximal entropy (~1.0) means every package has roughly equal in/out degree — spaghetti, no hierarchy. Low entropy means a few hub packages do most of the routing while leaves stay sparse — clear architectural shape. Reading the absolute number is less useful than tracking it over time: a rising entropy means the import graph is flattening into peer-to-peer chatter.",

  'dsm-compression-ratio':
    "The Dependency Structure Matrix is the N×N package dependency matrix; gzip-compressing its canonical serialization yields a compression ratio. High compressibility (low ratio) means regular structure — repeated zero blocks, clean banding, layered triangularity. Low compressibility means an irregular matrix with dependencies scattered in every quadrant. This is a Kolmogorov-flavoured proxy: random matrices don’t compress, well-architected ones do.",

  'dsm-layering':
    "Counts dependency entries that sit below the diagonal once packages are ordered by topological depth (leaves on top, roots at bottom). Any below-diagonal entry is an upward dependency — a package depending on something at a deeper layer than itself — which violates strict layering and creates cycles or back-pressure during refactors. Budget is typically zero or a small ratchet number that should only ever go down.",

  'dsm-symmetric-cycles':
    "Symmetric off-diagonal entries in the DSM (both A→B and B→A) are the visible signature of 2-cycles between packages. The measure counts those mutual edges directly from the dependency matrix. Cycles defeat clean refactoring and break the ability to release packages independently; the budget is typically zero.",

  // ── Coupling ───────────────────────────────────────────────────────────────
  'cross-package-coupling':
    "Counts pairs of sibling systems packages whose cross-package value-symbol imports exceed the per-pair budget declared in the coupling ratchet. Type-only imports don’t count — only value imports, since those are what couple runtime behavior. This is the load-bearing CI gate for keeping the import surface narrow; new violations must be earned by raising the budget, which is committed to git and reviewable.",

  'cross-package-cycles':
    "Strongly-connected components in the directed package import graph. Any package pair that mutually imports from each other forms a 2-cycle; longer cycles surface as multi-package SCCs. Cycles signal that the affected packages should likely be merged or that a shared dependency should be extracted. Budget is zero.",

  'change-coupling':
    "Mines the last six months of git commits and computes, for every package pair, the fraction of commits touching A that also touch B. High co-change without an import edge is the signature of hidden semantic coupling — shared assumptions, copy-pasted patterns, co-evolving schemas — that static analysis can’t see. The measure tracks the worst-offending pair’s ratio; a high score means the system has invisible coupling that the import budget won’t catch.",

  'martin-instability':
    "Robert Martin’s stable-dependencies metric: instability I = Ce / (Ca + Ce), where Ca is afferent (incoming) coupling and Ce is efferent (outgoing). A package with many dependents and few dependencies is stable (I≈0); a package that depends on many others and has few dependents is unstable (I≈1). The reported number counts imports that violate the rule — directions where a more-stable package depends on a less-stable one, which inverts the right flow of change.",

  'boundary-width-ratio':
    "For each package, the share of its files that participate in any cross-package import (as importer or importee). A low ratio means a narrow facade — most files are internal, only a few touch the boundary. A high ratio means the package leaks across its boundary from many files, exposing implementation to neighbors. The metric is per-package; the dashboard surfaces the worst.",

  'hypergraph-bci':
    "Boundary Complexity Index aggregates three orthogonal cross-package signals — boundary width ratio, boundary entropy (how concentrated edges are in a few files vs. spread across many), and per-pair tree-width — into a single per-edge index summed over all directed package pairs. Designed to measure the *shape* of cross-package coupling, not just its volume. A high BCI means broad, evenly distributed, structurally tangled coupling; a low BCI means narrow facades funneling through few files.",

  'hypergraph-boundary-ratio':
    "Per-package-pair version of boundary width: for a directed pair (A → B), what fraction of files in the importing-and-importee set actually participate in the edge. Higher means the seam between A and B is broad — many files reach across — rather than channeled through a single passthrough. The dashboard tracks the maximum across all pairs as the headline signal.",

  'hypergraph-pair-treewidth':
    "Tree-width computed per cross-package file-import pair: how tangled the bipartite graph between importers in A and importees in B looks. A pair with one importer to many importees (or vice versa) has tree-width 1; a many-to-many tangle has higher width. The reported number is the worst pair across the codebase — a structural complement to the volume-based coupling budget.",

  'passthrough-barrels':
    "Detects cross-boundary files that contain too little local logic relative to the imports they re-export — a barrel/passthrough that just funnels symbols across packages without adding value. These leak implementation across facades while masquerading as boundary modules, and they make package boundaries fictitious. The count is the number of such files; budget is small and ratcheted.",

  'package-boundaries':
    "Scans every systems package for top-level mutable declarations (let, var, mutated const objects) at module scope. Module-mutable state is invisible to the import graph but couples every consumer through hidden shared mutation — the worst kind of coupling because it doesn’t show up in any structural measure. Budget is zero on the pure parts of the system.",

  // ── Complexity ─────────────────────────────────────────────────────────────
  'hierarchical-complexity':
    "The Orange Gate. The dendrogram of ≤10-child directory communities is walked at every depth, and for each sibling group four orthogonal signals are scored — boundary width, tree-width, normalized entropy, and DSM density — combined into a single priority score = outgoing cross-community edges × fan-out, excluding stable cores. The CI failure mode is whichever community’s score crosses the budget; the value reported is the worst score in the tree.",

  'cognitive-complexity':
    "SonarSource’s cognitive complexity score, per function, expressed as the ratio of the worst function’s score to the configured budget. Cognitive complexity penalizes *understanding* effort: nesting depth, breaks in linear flow, recursion — not just branch count. A deep pipeline of clean transforms scores low; a deeply nested conditional scores high. Aligns with the “deep and narrow” philosophy: deep is fine, complex is not.",

  'function-health':
    "Composite ratio combining function size, exports per file, and impurity detection into a single 0..1 score of the share of the codebase that looks structurally healthy. Functions that are short, exported sparingly, and pure count fully; long, side-effectful, multi-exporting functions drag the score down. Budget is a floor: stay above it.",

  'behavioral-complexity':
    "Per-community score that augments structural complexity with hidden behavioral coupling: top-level mutable state (counted ×3) plus impure global side-effects (counted ÷4). Catches what the import graph can’t see — communities that share a module-mutable singleton or fan out timers, fs, network calls. A high score means a community is structurally clean but behaviorally tangled, the worst kind of hidden coupling.",

  'purity-ast-p90-function-loc':
    "P90 of function body line-count, measured by AST (not lexer heuristics). The 90th percentile means 10% of functions are at least this long. Long functions are the leading indicator of accreted complexity — they hide branching depth, mutable locals, and tangled responsibilities. A drifting p90 means the worst-but-not-rarest functions are getting longer.",

  // ── Purity / Behavioral ────────────────────────────────────────────────────
  'purity-ratio':
    "Lexical purity ratio: share of total function line-count classified as pure by a regex-driven side-effect detector (no fs/net/timers/console/mutation in the body, all dependencies are themselves pure). Fast to compute but tolerates false positives — functions that look pure but call into impurity. Reading the AST variant in tandem is the right way to interpret movement.",

  'purity-ratio-ast':
    "AST-based purity ratio — same idea as lexical purity but uses TypeScript AST traversal to detect side effects, function-by-function, with global symbol tracking. Much more accurate than the lexical version; trips on fewer false positives and catches impurity behind small helpers. Budget is a floor on the share of the codebase that should be pure.",

  'purity-ast-health-score':
    "Composite purity health score: AST purity ratio multiplied by a complexity-location ratio (purity weighted by where the pure code lives — penalizes “islands of purity” inside an impure controller). High score means purity is concentrated in the right layers; a low score means even if the bulk LOC is pure, the load-bearing files aren’t.",

  'purity-ast-shell-thinness':
    "Median line-count of impure functions (the “shell” in functional-core, imperative-shell architectures). The shell should be thin: each impure function does one I/O thing then delegates to pure functions. A high median means impurity is bundled with logic — the shell isn’t thin, side effects are baked into business code rather than pushed to the edges.",

  'purity-ast-pure-dir-side-effects':
    "Impure LOC discovered by the AST detector inside directories named `pure/`. The intent of a `pure/` directory is a hard contract: every line in it is referentially transparent. Budget is zero — any positive value is a contract violation that should be either fixed or relocated out of `pure/`.",

  'purity-ratio-pure-dir-side-effects':
    "Same contract as the AST variant, but checked by the faster lexical detector. Catches the easy cases (direct fs, network, timer calls) without needing the full AST pass. Budget is zero.",

  'default-value-detection':
    "Spots functions whose bodies look pure to a syntactic scanner but whose parameter defaults contain side effects — `function f(now = Date.now()) {…}` is impure even if the body is. This is a known false-negative class for both lexical and AST purity detectors. The count is functions where this hidden impurity was caught; budget is zero.",

  // ── Globals (side-effect classes) ──────────────────────────────────────────
  'globals-console':
    "Number of functions whose AST contains a direct call to a console.* method. Each global side-effect class has its own report so the dashboard can attribute behavioral complexity precisely. Console is the lowest-stakes side effect — useful for log volume tracking, not a hard gate.",

  'globals-fs-io':
    "Functions that directly hit Node fs APIs (readFileSync, writeFile, etc.). Filesystem I/O is one of the highest-impact side effects: it’s slow, racy, and hard to test, so it should be concentrated in a thin shell. A high count means fs access is spread across the codebase rather than funneled through dedicated adapters.",

  'globals-network':
    "Functions making direct network calls (fetch, http, https, websocket). Same shape-of-impurity argument as fs-io: network calls are slow, fail in many ways, and should sit at the edge. Spreading them through internal logic makes the system harder to test offline and harder to mock.",

  'globals-nondeterministic':
    "Functions that read non-deterministic globals — Date.now, Math.random, performance.now, crypto.randomUUID. These are referentially opaque: the same inputs produce different outputs across calls. They should be injected as parameters (or wrapped in a single seam) so that tests can pin the clock and the RNG.",

  'globals-process-io':
    "Functions touching process.stdin/stdout/stderr/env/argv directly. Process I/O is environment coupling — code that reads `process.env` inside business logic is implicitly coupled to deployment configuration. A thin shell should read once at boot and pass values down.",

  'globals-react-hook':
    "Functions whose body uses React hooks (useState, useEffect, useMemo, etc.) outside a component definition. Hooks are legal only inside components or custom hooks; using them elsewhere is a Rules-of-Hooks violation but also a coupling signal — business logic should be hook-free and consume state via plain function arguments.",

  'globals-subprocess':
    "Functions invoking child_process / exec / spawn. Subprocess invocation is the highest-impact side effect — it can do literally anything, including shell injection. Should be tightly contained and reviewed. Even one stray spawn deep in business logic is a behavioral red flag.",

  'globals-timer':
    "Functions calling setTimeout, setInterval, queueMicrotask, setImmediate. Timers couple code to wall-clock and event-loop scheduling — tests have to fake them, and behavior depends on race conditions. Concentrate timing in dedicated scheduler modules.",

  // ── Shape (structure of the public surface) ────────────────────────────────
  'exports-per-file-max':
    "The single file with the largest number of top-level exports. A file that exports many symbols has a wide public surface — every consumer can reach in for any one of them — which makes splitting the file later painful. The metric flags the outlier file so you can either narrow its surface or split it before downstream lock-in.",

  'exports-per-file-p90':
    "The 90th percentile of exports-per-file across the codebase. The max is a single outlier; the p90 tells you whether wide-surface files are common or rare. A drifting p90 means the codebase is normalizing on broad public APIs, which compounds coupling across files.",

  'shape-complexity-file-score':
    "Per-file sprawl score combining p75 function LOC (typical function size in the file) with exports × 3 (penalty for wide public surface). The metric reports the p90 across files — the tail. Flags files drifting away from “deep and narrow” into “many medium-sized functions exposed broadly,” which is the failure mode of functional codebases as they accrete.",

  'shape-complexity-p90-exports':
    "Same tail-90 framing applied just to exports per file: how wide the public API surface is in the worst-but-not-rarest files. Pairs with the file-score metric — if shape complexity is rising, this tells you whether it’s width-driven (more exports) or depth-driven (longer functions).",

  'shape-complexity-p90-file-p75-loc':
    "The depth half of shape complexity: P90 of each file’s P75 function body LOC. In plain English, the typical “larger function” size in the worst tail of files. Rising values mean even median-sized functions are getting longer in the files that already had the longest functions.",

  // ── Structure (codebase size / fanout sanity) ──────────────────────────────
  'codebase-directory-fanout':
    "The largest immediate-child count in any source directory under systems packages. Directory fanout is a directly-observable proxy for cognitive load — if you open a folder and see 40 siblings, you can’t hold them in your head. Budget is around 10-15, with the dendrogram-based gardening enforcing the lower side.",

  'codebase-file-lines':
    "The single largest source file by line count. Large files are an early warning: they tend to accrete unrelated responsibilities and resist refactoring. The metric tracks only the worst file — a runaway file is more dangerous than a thousand mid-size ones.",

  // ── Turbulence / Churn ─────────────────────────────────────────────────────
  'turbulence':
    "Coverage of churn-times-complexity scoring: how many production files have been scored on (commit count × current complexity). High-turbulence files — frequently changed and complex — are the highest-ROI targets for refactoring. The metric is reported as coverage (files scored) so you know the diagnostic ran broadly; the details payload contains the ranking.",

  // ── Gates / Ratchets / Meta ────────────────────────────────────────────────
  'gate-cognitive-baseline-ratchet':
    "Per-function cognitive-complexity baselines committed to git. The ratchet allows existing offenders to stay but disallows regression — if any committed baseline increases, the gate fails. Budget is zero increases. This is the mechanism that lets you adopt cognitive complexity on a legacy codebase without a big-bang refactor.",

  'gate-cognitive-threshold-ratchet':
    "The maximum cognitive-complexity threshold checked against the committed value. New code must pass the threshold; the threshold itself is also versioned so any loosening of it shows up as a ratchet violation. Budget is zero.",

  'gate-coupling-budget-ratchet':
    "The cross-package coupling budgets are versioned in git. The ratchet gate fails if any committed budget has gone up — pairs are allowed to ratchet down (improve), never up. This is the load-bearing CI mechanism that converts a list of current violations into a one-way improvement contract.",

  'gate-files-exist':
    "Counts gate-test files that should be present but aren’t — orange gate, complexity gates, ratchet gates. A missing gate file means the gate isn’t running, which is invisible failure. Budget is zero.",
}

// Category-level fallback for any metricId we haven't authored an explanation
// for. Lets us keep the dashboard useful as new metrics are added.
const CATEGORY_FALLBACKS = {
  Coupling:
    "A coupling measure: how strongly packages, files, or commits depend on each other. The dashboard wants these to stay narrow — a high or rising value means tighter coupling and a heavier refactor cost.",
  Complexity:
    "A complexity measure: structural or per-function difficulty of the code under review. Tracked against a budget so growth is intentional rather than accidental.",
  Structure:
    "A structural measure of the import graph or directory shape: layering, fanout, file size. These don’t catch logic bugs but flag the architectural drift that makes future change harder.",
  Purity:
    "A purity measure: how much of the codebase is referentially-transparent (pure) versus side-effecting (impure). Higher purity is easier to test, easier to reason about, and concentrates risk at the edges.",
  Behavioral:
    "A behavioral measure: side effects, mutation, hidden state — coupling the import graph can’t see. False-negative class is pure functions inside a god-controller.",
  Shape:
    "A shape measure: function size and public-API surface width. Catches the drift from “deep and narrow” into “many medium-sized functions exposed broadly,” which is the typical failure mode of accreted functional codebases.",
  Churn:
    "A churn-based diagnostic combining git history with current complexity to find the highest-ROI refactoring targets. Diagnostic, not a gate.",
  Other:
    "A meta-measure or ratchet that keeps a budget honest over time. Usually a binary gate with budget zero.",
}

const GENERIC_FALLBACK =
  "A codebase-health measure tracked against a committed budget. Hover the card’s description and current/budget values for the headline reading."

export function getMetricExplanation(report) {
  if (!report) return GENERIC_FALLBACK
  const direct = METRIC_EXPLANATIONS[report.metricId]
  if (direct) return direct
  const byCategory = CATEGORY_FALLBACKS[report.category]
  return byCategory ?? GENERIC_FALLBACK
}
