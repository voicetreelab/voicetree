# Agent Workflow Guide: Orchestrating Complex Tasks with Sub-Agents

## Overview

This guide documents effective patterns for using Claude as an orchestrator to manage complex tasks by spawning parallel sub-agents, reviewing their work, and deciding when to delegate vs. do work directly.

## Core Principles

### 1. **Decompose Before Delegating**
Break down complex tasks into focused subtasks that can be handled independently. Each sub-agent should have:
- A single, clear objective
- sufficient context (high level goal, any possible relevant context) but no context bloat (anything irrelevant)
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

Important, both you, and the agents, will keep all their documentation contained WITHIN a markdown tree. The entry point for this tree is whatever markdown documents you are already working with. Connections between nodes (markdown files), can be made with markdown links [[file]]

i.e. you will extend the existing tree. for every new md file you make in markdown tree vault, 
prepend the file name with AGENT{NAME}_{TITLE}
You are only allowed to modify existing nodes in the tree that start with AGENT_

You will also have to explain this to your agents
```


## Practical Implementation

### 1. Creating Subtask Files

IMPORTANT, create this markdown file, and then CONNECT it to the most relevant
markdown file already in the tree, with a markown link [[]],
such that this subtask file itself becomes a node in the tree!

```markdown
# Subtask: [Clear Title]

# <relationship_to_parent_description> [[<parent file>]] 

See <parent file> for the original raw human request (important), then understand your role within this to achieve a subtask of that overall goal.

### Your Component/abstraction
What is the component: a method? a module? a system? a test?
[Highlight where this agent's work fits, method/module/test etc.]
What exactly will the input and output be for this component. 
What allowed side effects can it have (ideally none). ANY OTHER SIDE EFFECTS ARE BANNED
**Input**: [Exact format/type of data this component receives]
```
[Concrete example of input data]
```

**Output**: [Exact format/type of data this component produces]
```
[Concrete example of output data]
```

### System Architecture
<very concise overview of where the component fits into the overall system being created>

### Dependencies
- Input from: [upstream component]
- Output to: [downstream component]

## Context
what this agent should know]

## where you fit into the larger system
detail what it's neighbouring agents will be working on, so the AI knows what NOT to work on.

## Requirements
- [ ] Specific requirement 1
- [ ] Specific requirement 2

## what not to work on:
<fill in based on what the other agents are doing, which it should not try do>

# instructions
e.g. don't do anything else besides this task. 
Specify whether or not it needs to write or run tests. 
If it does, keep it to only one test file following TDD.
Otherwise it will spiral out of control, 
making and running too many 
unnecessary tests.

## Files that may be relevant
<list of file paths>

If doing a test, the test should be a behavioural test
tetsssing the input/output behaviour at high level of  whatever abstraction you are creating or modifying.

## Success Criteria
- [ ] Clear, measurable outcome
```

### 3. Color Coding for Visual Progress Tracking

Assign each agent a unique color for their markdown files:

```yaml
---
color: blue   
---
```

### 4. Generating Agent Launch Scripts

After creating subtask markdown files, use the `generate_agent_script.py` tool to create executable launch scripts:

```bash
# Basic usage
python generate_agent_script.py --agent-name <NAME> --color <COLOR> --task-file <TASK_FILE>

# Examples for each agent
python generate_agent_script.py --agent-name ALICE --color red --task-file AGENT_ALICE_integration_test.md
python generate_agent_script.py --agent-name BOB --color green --task-file AGENT_BOB.md
python generate_agent_script.py --agent-name CHARLIE --color blue --task-file AGENT_CHARLIE_workflow_driver.md
python generate_agent_script.py --agent-name DIANA --color yellow --task-file AGENT_DIANA_markdown_tags.md

# Advanced options
python generate_agent_script.py \
    --agent-name ALICE \
    --color red \
    --task-file AGENT_ALICE_integration_test.md \
    --max-turns 40 \              # Increase for complex tasks
    --model opus \                # Use opus for complex reasoning
    --vault-subdir clustering_task \  # Specify subdirectory in agent-communication
    --description "Integration testing setup"  # Custom description
```

This generates executable scripts like `run_alice_agent.sh` that:
- Include the full task content in the prompt
- Set up proper markdown vault paths
- Configure color coding for visual tracking
- Follow TDD principles with clear instructions

Launch agents with:
```bash
./run_alice_agent.sh
./run_bob_agent.sh
# etc.
```


### 5. Creating Module Contracts
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


Always ask agents to update markdown checkboxees tracking their progress.

REMEMBER: SET YOUR TIMEOUTS TO BE VERY LONG. CLAUDE SUBAGENTS CAN TAKE UP TO 10 minutes for a task.

REMEMBER, Save state of tasks WITHIN THE VOICETREE markdown files, in /Users/bobbobby/repos/VoiceTreePoc/agent-communication
AND TELL YOUR AGENTS TO DO THE SAME.

## Best Practices for Multi-Agent Development

2. **Color Coding**: Assign unique colors to visualize each agent's contributions
3. **Clear Boundaries**: Define exactly which files/modules each agent can modify
4. **Shared Documentation**: Keep task tracking in shared markdown vault
5. **Module Contracts**: Define interfaces before parallel development begins