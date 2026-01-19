# Decomposing Tasks into Dependency Graphs

Your task is to decompose a task into a subtask dependency graph and add it to the markdown tree.

## Naming Convention

### Subtasks (Phases)
Sequential phases that depend on each other: `Phase 1`, `Phase 2`, `Phase 3`
- Dependent subtask = **child** of previous phase
- `Phase N+1` is a child of `Phase N`

### Sub-subtasks (Parallel work within a phase)
Parallel work within a single phase: `1A`, `1B`, `1C` or `2A`, `2B`
- Format: `<phase_number><letter>`
- All sub-subtasks of a phase are **siblings** (same parent = the phase)
- Sub-subtasks execute in parallel

### Key Rule: Sub-subtasks Are Internal

**Never use a sub-subtask as a parent for another phase.**

If work depends on a sub-subtask completing, that dependency belongs to the **phase level**, not the sub-subtask.

```
CORRECT:
Phase 1
├── 1A (parallel)    Phase 2 depends on Phase 1
└── 1B (parallel)        ↓
    └── Phase 2 ←────────┘

WRONG:
Phase 1
├── 1A
└── 1B
    └── Phase 2  ← Don't make sub-subtasks parents of phases
```

---

## Structure Rules

### 1. Create a Root "Implementation Plan" Node First

- **Parent**: the original task node
- **Openspec link**: If implementing from an openspec, link to it here (only the root links to openspec)
- **Keep your agent name** (don't use `--agent-name ""`)
- **Contains**: dependency graph sketch, phase summary, key decisions

### Minimize Edges

Every `[[wikilink]]` creates a visible graph edge. Too many = visual clutter.

- **Wikilinks = parent edges only.** Use `[[]]` only for linking to parents (and openspec from root)
- **Only the Implementation Plan** links to openspec (not every phase/task)
- For references (specs, docs, related files), use regular `[markdown](links)` - no edge created

### 2. Sequential Phases = Parent-Child Chain

```
Implementation Plan
└── Phase 1
    └── Phase 2
        └── Phase 3
```

### 3. Parallel Phases = Siblings

If two phases can run simultaneously:

```
Implementation Plan
├── Phase 1 (parallel)
└── Phase 2 (parallel)
```

### 4. Sub-subtasks = Parallel Siblings Under Phase

Each phase should have **2+ parallel sub-subtasks** when possible:

```
Phase 1
├── 1A: Config setup (parallel)
└── 1B: Test setup (parallel)
```

### 5. Diamond Dependencies = Multiple Parents

```
Implementation Plan
├── Phase 1 ─────┐
└── Phase 2 ─────┼──► Phase 3
```

---

## Workflow

1. **Sketch the dependency graph** in ASCII first
2. **Create the Implementation Plan node** (child of task, keeps your agent name)
3. **Add phases** following dependency order:
   - Parallel phases → siblings
   - Sequential phases → parent-child
4. **Add sub-subtasks** as parallel siblings under their phase
5. Stop, do NOT make a progress node. The dependency graph creation satisfies your progress node todo item.