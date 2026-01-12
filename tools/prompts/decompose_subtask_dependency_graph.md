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
- **Keep your agent name** (don't use `--agent-name ""`)
- **Contains**: dependency graph sketch, phase summary, key decisions

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

When a phase needs multiple prior phases, use `--parents`:

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
   - Diamond deps → `--parents "file1.md,file2.md"`
4. **Add sub-subtasks** as parallel siblings under their phase

---

## CLI Usage

```bash
python3 "$VOICETREE_APP_SUPPORT"/tools/add_new_node.py "<title>" "<content>" \
  [--relationship <why_blocked>] \
  [--parent <file>] \
  [--parents <file1,file2,...>] \
  [--color <color>] \
  [--agent-name <name>]
```

- `<title>` - Use naming convention: "Phase 1: Setup", "1A: Docker Config"
- `--relationship` - Why blocked by parent (short phrase, <10 words)
- `--parent` - Single parent file path
- `--parents` - Comma-separated for diamond dependencies
- `--color` - Different color per phase; sub-subtasks inherit. Avoid blue (default color).
- `--agent-name ""` - Empty for subtasks/sub-subtasks; omit for impl plan

Subtask content follows: `$VOICETREE_APP_SUPPORT/tools/prompts/subtask_template.md`

---

## Example: Agent Stats Dashboard

**Task**: "Add an agent stats dashboard for Claude Code OTEL telemetry"

**Dependency Analysis**:
- Phase 1 (OTEL Stack) & Phase 2 (Dashboard) can run in parallel
- Phase 1 has parallel sub-subtasks: 1A (config), 1B (testing)
- Phase 3 (Hooks) depends on Phase 1
- Phase 4 (Multi-user) needs both Phase 2 AND Phase 3 (diamond)

**ASCII Sketch**:
```
Task: Agent Stats Dashboard
└── Implementation Plan
    ├── Phase 1: OTEL Stack Setup (cyan)
    │   ├── 1A: Docker Compose Config (parallel)
    │   └── 1B: Test OTEL Collection (parallel)
    │
    ├── Phase 2: Custom Dashboard (green) [parallel with Phase 1]
    │
    └── Phase 3: Context Hooks (orange) [child of Phase 1]
            │
            └── Phase 4: Multi-user (purple) [diamond: Phase 2 + Phase 3]
```

**Execution Order**:
```
         ┌─► Phase 1 (1A ∥ 1B) ──► Phase 3 ──┐
Start ───┤                                    ├──► Phase 4 ──► Done
         └─► Phase 2 ────────────────────────┘
```

**Node Creation Order**:

```bash
# 1. Implementation Plan (keeps agent name)
python3 ... "Implementation Plan" "..." --parent /path/to/task.md

# 2. Phase 1 - child of impl plan
python3 ... "Phase 1: OTEL Stack Setup" "..." \
  --parent impl_plan.md --color cyan --agent-name ""

# 3. Phase 2 - sibling of Phase 1 (parallel)
python3 ... "Phase 2: Custom Dashboard" "..." \
  --parent impl_plan.md --color green --agent-name ""

# 4. Sub-subtasks 1A, 1B - siblings under Phase 1
python3 ... "1A: Docker Compose Config" "..." \
  --parent phase1.md --color cyan --agent-name ""
python3 ... "1B: Test OTEL Collection" "..." \
  --parent phase1.md --color cyan --agent-name ""

# 5. Phase 3 - child of Phase 1 (NOT child of 1A or 1B!)
python3 ... "Phase 3: Context Hooks" "..." \
  --parent phase1.md --color orange --agent-name ""

# 6. Phase 4 - diamond dependency
python3 ... "Phase 4: Multi-user Support" "..." \
  --parents "phase2.md,phase3.md" --color purple --agent-name ""
```
