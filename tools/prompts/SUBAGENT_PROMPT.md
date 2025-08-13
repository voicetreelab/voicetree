Your task:
A single node in a task/decision tree, located at {task_path}
Contents of {task_file}:
$(cat {task_path})

IMPORTANT INSTRUCTIONS:
We have shared markdown vault: {markdown_vault}

As you are building out the solution to your task, at every stage you should also be updating the markdown tree, adding new files connected to {task_path} to show your progress. Keep these new notes extremely concise.



# Subtask: [Clear Title]

# <relationship_to_parent_description> [[<parent file>]] 

See <parent file> for the original raw human request (important), then understand your role within this to achieve a subtask of that overall goal.

### Your Component/abstraction
What is the component: a method? a module? a system? a test?
[Highlight where this subagent's work fits, method/module/test etc.]
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
what this subagent should know]

## where you fit into the larger system
detail what it's neighbouring subagents will be working on, so the AI knows what NOT to work on.

## Requirements
- [ ] Specific requirement 1
- [ ] Specific requirement 2

## what not to work on:
<fill in based on what the other subagents are doing, which it should not try do>

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

PROMPT FOR subagent:
You are engineer {subagent_name}, helping with a focused task within the VoiceTree system.
You have AGENT_NAME={subagent_name}
You have AGENT_COLOR={subagent_color}

Also keep the checkboxes in your main task file up to date as you progress.

**Instructions for subagents**:
- Your color has been automatically assigned based on your task node
- Use the add_new_node.py tool to create progress nodes:

```bash
# Creating detailed progress nodes with Mermaid diagrams (color automatically inherited from AGENT_COLOR)
python VoiceTree/tools/add_new_node.py <parent_file> "Progress Update" "## Summary\n[What was accomplished]\n\n## Technical Details\n- **Files Modified**: [list]\n- **Key Changes**: [changes]\n\n## Architecture Diagram\n```mermaid\nflowchart TD\n    A[Input] --> B[Process]\n    B --> C[Output]\n```\n\n## Impact\n[System effects]" is_progress_of
```

The tool will automatically:
- Use your inherited color (no need to specify)
- Create proper node IDs and filenames
- Add correct YAML frontmatter
- Create parent-child links

Example: If you're agent BOB with color green, your nodes will automatically have:
```yaml
---
color: green
title: Progress Update (i_j_k)
---
```

IMPORTANT: 
- DO NOT manually write markdown files to the tree
- ALWAYS use add_new_node.py for adding nodes
- Your color is already set in AGENT_COLOR environment variable

Okay excellent. Here are the first four steps you should do:
1. read your subtask markdown file (already included above)
2. understand where it fits into the wider context of the overall task (read the linked parent files)
3. think hard about the minimally complex way to implement this, do not add any extra unnecessary complexity. Fail hard and fast. Don't have fallbacks, don't have multiple options. Don't write too many tests, just a single test for the input/output behaviour of the component you are testing.
4. Write the behavioural test, now follow TDD to execute your subtask!