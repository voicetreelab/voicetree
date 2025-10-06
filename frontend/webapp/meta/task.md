Your job is to be the manager for executing this large code task.

Make sure you follow the plan. Spawn subagents to do parts of the plan, give them the spec file, and
where they fit into that plan. Make sure each subagent has a specific contained job to do. Tell them
also what NOT to do. Each time you spawn a subagent it must also be told what test it should write or
have pass.

You should try write the tests mostly yourself. i.e. you will be following TDD. This way you can ensure
the tests are actually high quality, testing behaviour not implmentation details.

For each test you write, launch an agent to make it pass.


behvaiour Spec file (MOST IMPORTANT FILE):
- @floatingWindowSpec.md

Plan file ( you can adjust as necessary)
- @simplePhase1PlanApproach.md

The task is done once the spec is confirmed to be true with the corresponding playwright test.
`tests/e2e/isolated-with-harness/graph-core/floating-window-extension.spec.ts`

first let me know if you need any clarifications 


----------------

Okay, give me examples of how you will call the subagents. DO NOT ACTUALLY CALL THE SUBAGENTS. Just
show me the tool call you would use wrapped as XML text

----------------------

> # subagent Workflow Guide: Orchestrating Complex Tasks with subagents

YOU ARE AN ORCHESTRATOR, AN ENGINEERING MANAGER OF SUBAGENTS.
YOU ARE CURRENTLY BEING EXAMINED ON HOW WELL YOU WILL PERFORM AT DELEGATING
AND MANAGING YOUR ENGINEERS to perform the above task.

YOU ARE GRADED ON 4 pillars:
1. THE QUALITY OF THE OVERALL SOLUTION
2. TOTAL TIME TAKEN
3. WHETHER ANY TECH DEBT WAS ADDED, are the tests high quality but not a burden.
4. AND WHETHER YOU COULD HAVE ACHIEVED A SIMPLER SOLUTION FOR THE SAME END RESULT

### YOUR TASK & THE MOST IMPORTANT THING FOR YOU THE ORCHESTRATOR

Your task is to create the subtask markdown notes. We ALREADY have a template for that here

$USER_ROOT_DIR/repos/VoiceTree/tools/prompts/SUBAGENT_PROMPT.md

You must start by filling out this template for each subtask,
and then creating the subtask nodes connected to their most relevant existing node in the graph
(the most relevant existing node will either be the markdown source file you were called from,
)

## Overview

This rest of this guide documents effective patterns for using Claude as an orchestrator to manage
complex tasks by spawning parallel subagents, reviewing their work, and deciding when to delegate vs. do
work directly.

## Core Principles

### 1. **Decompose Before Delegating**
Break down complex tasks into focused subtasks that can be handled independently. Each subagent should
have:
- A single, clear objective
- sufficient context (high level goal, any possible relevant context) but no context bloat (anything
  irrelevant)
- Well-defined success criteria

### 2. **Context Optimization**
Give each subagent only the context they need:
-  Don't dump entire conversation history
-  Do provide specific task files, contracts, and relevant background
-  Do explain where their work fits in the larger system

### 3. **Parallel When Possible**
Identify independent tasks that can run simultaneously:
- Tasks with no shared state
- Tasks with well-defined interfaces
- Tasks that communicate only through files

Important, both you, and the subagents, will keep all their documentation contained WITHIN a markdown
tree. The entry point for this tree is whatever markdown documents you are already working with.
Connections between nodes (markdown files), can be made with markdown links [[file]]

i.e. you will extend the existing tree. for every new md file you make in markdown tree vault at
$OBSIDIAN_VAULT_PATH/$OBSIDIAN_SOURCE_NOTE,
prepend the file name with {subagent_NAME}_{TITLE}
You are only allowed to modify existing nodes in the tree that start with subagent_

You will also have to explain this to your subagents

### 3. Color Coding and subagent naming for Visual Progress Tracking

- Assign each subagent a unique name for their markdown subtask file
- Assign each subagent a unique color for their markdown files
- Use the add_new_node.py tool with --color to create subtask nodes:

```bash
# Creating a subtask node with specific color for subagent
python tools/add_new_node.py <parent_file> "Bob implement feature" "Task description" is_subtask_of 
--color green
```

This will create a node with:
```yaml
---
color: green
title: Bob implement feature (i_j)
---
```

When the subagent is spawned on this node, they will automatically inherit the green color for all their
progress nodes.

### 5. Creating Module Contracts
When subagents need to work on interconnected modules, create a module contract
an API for the module which they can expect to be true, even if right now it is not developed:

## Decision Framework: Delegate vs. Do It Yourself

### Do It Yourself When:
- Task requires understanding of full context, which you can't easily condense
- Task is combining multiple pieces of work, stringing together solutions, spread across modules etc.

### Delegate to subagent When:
- Task is complex and focused
- Task can be done with limited context
- Task is independent of other work
- Multiple similar tasks can be parallelized

### : Context Optimization
Problem: Too much context slows down subagents
Solution: Extract just what's needed

PROMPT: "You're implementing one subtask of a larger system.
Here's your specific task: [task]
Here's where it fits: [minimal tree view]


Always ask subagents to update markdown checkboxes tracking their progress.

REMEMBER, Save state of tasks at project root.

AND TELL YOUR subagentS TO DO THE SAME.

## Best Practices for Multi-subagent Development

2. **Color Coding**: Assign unique colors to visualize each subagent's contributions
3. **Clear Boundaries**: Define exactly which files/modules each subagent can modify
4. **Shared Documentation**: Keep task tracking in shared markdown vault
5. **Module Contracts**: Define interfaces before parallel development begins


## Example Workflow for Creating Subagent Tasks

1. **Orchestrator creates subtasks with specific colors using full SUBAGENT_PROMPT.md template:**
```bash
# Create Bob's subtask (agent name: Bob, color: green) - content should be filled from 
SUBAGENT_PROMPT.md template
python tools/add_new_node.py $OBSIDIAN_VAULT_PATH/$OBSIDIAN_SOURCE_NOTE "Bob implement auth" "$(cat 
$USER_ROOT_DIR/repos/VoiceTree/tools/prompts/SUBAGENT_PROMPT.md | sed 
's/{task_path}/current_task_path/g' | sed 's/{subagent_name}/Bob/g' | sed 's/{subagent_color}/green/g')"
 is_subtask_of --color green --agent-name Bob

# Create Alice's subtask (agent name: Alice, color: blue) - content should be filled from 
SUBAGENT_PROMPT.md template  
python tools/add_new_node.py $OBSIDIAN_VAULT_PATH/$OBSIDIAN_SOURCE_NOTE "Alice create tests" "$(cat 
$USER_ROOT_DIR/repos/VoiceTree/tools/prompts/SUBAGENT_PROMPT.md | sed 
's/{task_path}/current_task_path/g' | sed 's/{subagent_name}/Alice/g' | sed 
's/{subagent_color}/blue/g')" is_subtask_of --color blue --agent-name Alice

# Create Charlie's subtask (agent name: Charlie, color: purple) - content should be filled from 
SUBAGENT_PROMPT.md template
python tools/add_new_node.py $OBSIDIAN_VAULT_PATH/$OBSIDIAN_SOURCE_NOTE "Charlie write docs" "$(cat 
$USER_ROOT_DIR/repos/VoiceTree/tools/prompts/SUBAGENT_PROMPT.md | sed 
's/{task_path}/current_task_path/g' | sed 's/{subagent_name}/Charlie/g' | sed 
's/{subagent_color}/purple/g')" is_subtask_of --color purple --agent-name Charlie
```

2. **When subagents are spawned:**
- They automatically inherit their task node's color
- All their progress nodes will have consistent color
- Visual tracking shows each agent's work clearly

Okay, now think! What's the best way to split up this task? Propose it to me now.
Your proposed subtask files should all be named <agent_name>_subtask_name,
with the yaml title containing this without underscores and (i_j)
e.g. bob_implement_x (3_1)

DO NOT NOW SPAWN THE SUBTASKS, JUST PROPOSE THE SUBTASK FILES YOU WILL CREATE.


------------
Okay, create the task file, then spawn the subagent with a link to the task file, make sure to also
include my original spec file in the task file.


1. add to spec file.
2. add to test.spec file
3. create a subagent task file (same template)
4. Launch subagent
5. Review subagents work, and integrate it into the larger system 
5. (new) Check webapp/codeReview.md for any external comments on the code from another reviewer
6. Continue to next phase goto step 1 

