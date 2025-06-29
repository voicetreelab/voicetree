# Agent Workflow Guide: Orchestrating Complex Tasks with Sub-Agents

## Overview

This guide documents effective patterns for using Claude as an orchestrator to manage complex tasks by spawning sub-agents, reviewing their work, and deciding when to delegate vs. do work directly.

## Core Principles

### 1. **Decompose Before Delegating**
Break down complex tasks into focused subtasks that can be handled independently. Each sub-agent should have:
- A single, clear objective
- Minimal but sufficient context
- Well-defined success criteria

### 2. **Context Optimization**
Give each agent only the context they need:
- ❌ Don't dump entire conversation history
- ✅ Do provide specific task files, contracts, and relevant background
- ✅ Do explain where their work fits in the larger system

### 3. **Parallel When Possible**
Identify independent tasks that can run simultaneously:
- Tasks with no shared state
- Tasks with well-defined interfaces
- Tasks that communicate only through files

## Workflow Patterns

### Pattern 1: Planning → Decomposition → Parallel Execution

```
1. Understand the goal
2. Create a detailed plan (like simplification_plan.md)
3. Decompose into subtasks (like subtask_*.md files)
4. Identify dependencies and parallelization opportunities
5. Spawn agents for independent tasks
6. Review and integrate results
```

### Pattern 2: Iterative Refinement

```
1. Create initial plan
2. Get human feedback
3. Refine based on constraints
4. Implement incrementally
5. Review and adjust
```

## Practical Implementation

### 1. Creating Subtask Files

```markdown
# Subtask: [Clear Title]

## Goal
[One sentence description]

## Context
[Only what this agent needs to know]

## Requirements
- [ ] Specific requirement 1
- [ ] Specific requirement 2

## Success Criteria
- [ ] Clear, measurable outcome

## Notes
- Any special considerations
- Available resources or examples
```

### 2. Spawning Agents with Shell Scripts

```bash
#!/bin/bash
# execute_subtasks.sh

# Prepare prompts with minimal context
TASK1_PROMPT="You are helping with a focused task.

Your task:
$(cat subtask_1.md)

[Any additional context like file locations, contracts, etc.]

When complete, create 'task1_complete.marker'."

# Launch agents in parallel with headless mode
claude -p "$TASK1_PROMPT" --dangerously-skip-permissions > task1.log 2>&1 &
PID1=$!

claude -p "$TASK2_PROMPT" --dangerously-skip-permissions --max-turns 20  --model sonnet > task2.log 2>&1 &
PID2=$!

# Note: When spawning Claude instances in print/headless mode you may need to increase the max turns so that the process completes: claude -p --max-turns 20
# Note: you can specify a cheaper model --model sonnet for simple tasks, it will be faster. use --model opus complex tasks. 

# Wait for completion
wait $PID1 $PID2

# Check results
if [[ -f task1_complete.marker && -f task2_complete.marker ]]; then
    echo "All tasks completed!"
fi
```

### 3. Creating Module Contracts

When agents need to work on interconnected modules:

```markdown
# Module Contracts

## module_a.py
```python
def process_data(input_file: str) -> dict:
    """Process input file and return results dict"""
```

## module_b.py
```python
def analyze_results(results: dict) -> str:
    """Analyze results dict and return summary"""
```

## File Formats
- Input: JSON with schema {...}
- Output: Markdown report

## IMPORTANT: Exact Function Names
List the EXACT function names that will be used:
- Main entry: `process_data()` (NOT `process()` or `processData()`)
- Analysis: `analyze_results()` (NOT `analyze()` or `analyzeResults()`)

This prevents interface mismatches in tests and integrations.
```

### 4. Progress Monitoring

```bash
#!/bin/bash
# monitor_agents.sh

while true; do
    clear
    echo "=== Agent Progress ==="
    
    # Check completion markers
    [[ -f task1_complete.marker ]] && echo "✓ Task 1" || echo "⏳ Task 1"
    [[ -f task2_complete.marker ]] && echo "✓ Task 2" || echo "⏳ Task 2"
    
    # Show recent log activity
    echo -e "\n--- Recent Activity ---"
    tail -n 3 task*.log 2>/dev/null
    
    sleep 5
done
```

## Decision Framework: Delegate vs. Do It Yourself

### Do It Yourself When:
- Task is simple and quick (< 5 minutes)
- Task requires understanding of full context
- Task is mostly file operations or refactoring
- You need tight control over the outcome

### Delegate to Sub-Agent When:
- Task is complex and focused
- Task can be done with limited context
- Task is independent of other work
- Multiple similar tasks can be parallelized

## Example: Our Simplification Workflow

### 1. Initial Planning (Did Myself)
- Created comprehensive simplification_plan.md
- Incorporated human feedback iteratively
- Made architectural decisions

### 2. Task Decomposition (Did Myself)
- Created focused subtask files
- Defined module contracts
- Identified parallelization opportunities

### 3. Implementation (Delegated)
- Spawned 3 agents in parallel
- Each had minimal, focused context
- No conflicts due to clean interfaces

### 4. Review and Integration (Did Myself)
- Examined agent outputs
- Fixed minor issues (like CLI arguments)
- Reorganized files

## Common Patterns and Solutions

### Pattern: Integration Testing with Mocks
```
Problem: Need fast tests without waiting for real API calls
Solution: Create mock implementations

PROMPT: "Create integration tests that mock Claude CLI calls. 
Tests should run in seconds. Include mock_claude.py that 
simulates responses based on prompt content."
```

### Pattern: Parallel Development with Clean Interfaces
```
Problem: Multiple modules need development
Solution: Define contracts, develop in parallel

PROMPT: "Implement module X according to this contract: [contract].
You don't need to implement modules Y or Z - just follow the interface."
```

### Pattern: Context Optimization
```
Problem: Too much context slows down agents
Solution: Extract just what's needed

PROMPT: "You're implementing one subtask of a larger system.
Here's your specific task: [task]
Here's where it fits: [minimal tree view]
You can read these files if needed: [list]"
```

## Tips for Success

### 1. **Use Completion Markers**
Always ask agents to create a marker file when done. This enables easy progress tracking without parsing logs.

### 2. **Capture Logs**
Redirect stdout/stderr to files for debugging:
```bash
command > output.log 2>&1
```

### 3. **Test Incrementally**
Don't wait for all agents to finish. Check logs periodically and course-correct if needed.

### 4. **Prepare for Sequential Execution**
Even with parallel launching, some systems (like Claude CLI) may enforce sequential execution. Design tasks to work either way.

### 5. **Document Assumptions**
Each subtask should document its assumptions clearly so agents don't make conflicting choices.

### 6. **Verify Before Testing (NEW)**
When creating tests, instruct agents to:
- First read the actual implementation
- Verify function names and signatures
- Check expected behavior from code, not assumptions
Example prompt addition: "Before writing tests, read decompose.py and note the exact function names and signatures."

### 7. **Include Working Examples (NEW)**
When agents need to create similar code:
- Show a working example from the codebase
- Point to patterns to follow
Example: "See how agent_tree.py uses argparse - follow this pattern for consistency."

## Real Example from Our Session

```bash
# Created three subtasks
subtask_entry_point.md    # Modify main entry point
subtask_decompose.md       # Create decomposition module  
subtask_solve.md          # Create solving module

# Defined contracts
module_contracts.md       # Interfaces between modules

# Launched in parallel
./execute_simplification.sh

# Result: Three agents worked independently, no conflicts
```

## Debugging Workflow Issues

### Common Problems:

1. **Agents missing context**
   - Solution: Add tree visualization or relevant examples
   
2. **Conflicting implementations**
   - Solution: Better contracts and clearer boundaries
   
3. **Sequential instead of parallel**
   - Solution: Check for system limitations, design for both cases

4. **Agents not completing**
   - Solution: Check logs, simplify tasks, add better error handling

5. **Interface Mismatches (NEW)**
   - Problem: Agent makes incorrect assumptions about module interfaces
   - Example: Tests calling `solve_task()` when actual function is `solve()`
   - Solution: 
     - Provide exact function signatures in contracts
     - Have agents verify interfaces before writing tests
     - Include "Interface Verification" as first task step

6. **Test-Code Drift (NEW)**
   - Problem: Tests written based on assumed behavior, not actual implementation
   - Solution:
     - Run tests incrementally during development
     - Provide working examples in prompts
     - Ask agents to read actual code before writing tests

## Creating Handoff Documents for Sub-Agents

When orchestrating complex multi-phase work, create a handoff document that includes:

### Essential Elements:
1. **Step 0: Orientation**
   - List key documents in reading order
   - Explain the "why" before the "what"
   - Provide time estimates for each read

2. **Step 1: Current State Assessment**
   - Show how to verify current implementation
   - List what's complete (✅) and incomplete (❌)
   - Provide quick commands to check status

3. **Step 2: Technical Context**
   - Point to interface definitions
   - Highlight critical design decisions
   - Warn about known issues

4. **Step 3: Specific Next Steps**
   - Prioritized list of tasks
   - Exact files and line numbers to modify
   - Test commands to verify progress

### Example Structure:
```markdown
# Project X - Handoff Document

## Step 0: Familiarize Yourself
1. vision.txt (5 min) - Why we're doing this
2. plan.md (15 min) - How we're doing it
3. contracts.md (5 min) - Technical interfaces

## Step 1: Current State
- Run `pytest -v` to see failures
- Check git status for modified files
- Review progress in plan.md

## Step 2: Fix Priority Issues
1. Update mock_api.py line 42
2. Fix test assertions in test_*.py
3. Run integration test

[Continue with specific, actionable steps...]
```

### Benefits:
- New agents start productive immediately
- Reduces context-gathering overhead
- Prevents duplicate work
- Maintains momentum across handoffs

## Meta-Learning

The workflow itself demonstrates the principles:
1. We decomposed the simplification into subtasks
2. We optimized context for each agent  
3. We parallelized where possible
4. We reviewed and integrated results
5. We learned and adapted (like discovering headless mode)
6. We created clear handoffs for continuity

This recursive application of our own principles validates the approach!