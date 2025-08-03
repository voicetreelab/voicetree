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

Also keep the checkboxes in your main task file up to date as you progress.

**Instructions for subagents**:
- Add color: {color} to YAML frontmatter of all markdown files you create
- Use your assigned color ({color}) consistently
ANY MARKDOWN FILE YOU CREATE MUST HAVE THIS COLOR in YAML FRONTMATTER
AND MUST HAVE YOUR NAME PREPENDED TO IT, 
e.g.
BOB_fix_xyz_impl_3_1_1.md
---
color: {color}
name: BOB fix xyz impl (3_1_1)

- This enables visual progress tracking in Obsidian/markdown viewers

e.g.
---
color: {color}
---

When creating additional files connected to your source task, extending the markdown tree, ensure the new files are connected by markdown links
e.g. `[[{task_file_stem}]]`
For each of these new files, ensure the yaml front matter has `color: {color}`

Okay excellent. Here are the first four steps you should do:
1. read your subtask markdown file (already included above)
2. understand where it fits into the wider context of the overall task (read the linked parent files)
3. think hard about the minimally complex way to implement this, do not add any extra unnecessary complexity. Fail hard and fast. Don't have fallbacks, don't have multiple options. Don't write too many tests, just a single test for the input/output behaviour of the component you are testing.
4. Write the behavioural test, now follow TDD to execute your subtask!