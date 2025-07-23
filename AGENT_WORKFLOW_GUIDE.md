# Agent Workflow Guide: Orchestrating Complex Tasks with Sub-Agents

## Overview

This guide documents effective patterns for using Claude as an orchestrator to manage complex tasks by spawning parallel sub-agents, reviewing their work, and deciding when to delegate vs. do work directly.

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

# instructions
e.g. don't do anything else besides this task. 
Specify whether or not it needs to write or run tests. 
If it does, keep it to only one test file following TDD.
Otherwise it will spiral out of control, 
making and running too many 
unnecessary tests.

If doing a test, the test should be a behavioural test
tetsssing the input/output behaviour at high level of 
whatever they are creating or modifying.

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

[Any additional context like file locations, contracts, big picture to why we are doing this]

General instructions to stay focussed only on this task and update the VoiceTree markdown file as appropiate with progress, and new connected files.
."

# Launch agents in parallel with headless mode
claude -p "$TASK1_PROMPT" --dangerously-skip-permissions > task1.log 2>&1 &
PID1=$!

claude -p "$TASK2_PROMPT" --dangerously-skip-permissions --max-turns 60  --model sonnet > task2.log 2>&1 &
PID2=$!
# ^ todo, make sure the above code actually runs them in parallel and are not blocking eachotheer.

# Note: When spawning Claude instances in print/headless mode you may need to increase the max turns so that the process completes: claude -p --max-turns 160
# Note: you can specify a cheaper model --model sonnet for simple tasks, it will be faster. use --model opus complex tasks. 

# Wait for completion
wait $PID1 $PID2

# Check results
if [[ -f task1_complete.marker && -f task2_complete.marker ]]; then
    echo "All tasks completed!"
fi
```

### 3. Creating Module Contracts
When agents need to work on interconnected modules, create a module contract
an API for the module which they can expect to be true, even if right now it is not developed:

## Decision Framework: Delegate vs. Do It Yourself

### Do It Yourself When:
- Task requires understanding of full context, which you can't easily condense
- Task is combining multiple pieces of work, stringing together solutions, spread across modules etc.

### Delegate to Sub-Agent When:
- Task is complex and focused
- Task can be done with limited context
- Task is independent of other work
- Multiple similar tasks can be parallelized


### : Context Optimization
```
Problem: Too much context slows down agents
Solution: Extract just what's needed

PROMPT: "You're implementing one subtask of a larger system.
Here's your specific task: [task]
Here's where it fits: [minimal tree view]
You can read these files if needed: [list]"
```


Always ask agents to update markdown checkboxees tracking their progress.

REMEMBER: SET YOUR TIMEOUTS TO BE VERY LONG. CLAUDE SUBAGENTS CAN TAKE UP TO 10 minutes for a task.

REMEMBER, Save state of tasks WITHIN THE VOICETREE markdown fies, in /Users/bobbobby/repos/VoiceTreePoc/markdownTreeVault
AND TELL YOUR AGENTS TO DO THE SAME.


Prompt:
Using this guide, send the different subtasks off to agents. First you will have to 1. think hard,  2. come up with a good plan, 3. divide      │
│   that plan up into parallel components, 4. write the shell script to run the agents 5. run the script 6. review their work, reject or accept,    │
│   validat, 7. update the VoiceTree in markdowntTreeVault as you go. Note, for every new md file you make in markdown tree vault, prepend the      │
│   title with AGENT{NAME} so I know who did it. give youur subagents a name like 'MARK' so they can do thee same. Step 8. RINSE AND REPEAT!!!      │
│   (for the next steps)