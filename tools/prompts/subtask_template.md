# Subtask Template

This template defines the structure for subtask nodes. Fill in the sections below when decomposing a task.

---

## Template

```markdown
## Success Criteria

- [ ] Measurable outcome 1
- [ ] Measurable outcome 2

## Requirements

- [ ] Requirement 1
- [ ] Requirement 2


**Type**: [method | module | system | test | other]

**Input**:
- Format: [exact type/format]
- Example:
  ```
  [concrete example]
  ```

**Output**:
- Format: [exact type/format]
- Example:
  ```
  [concrete example]
  ```

**Side effects**: [none | list allowed side effects]

## Context

[What this subagent needs to know to complete the task]


## Boundaries

**Work on**:
- [specific thing 1]
- [specific thing 2]

**Do NOT work on**:
- [thing handled by sibling subtask A]
- [thing handled by sibling subtask B]

## Relevant Files

- `path/to/file1.py`
- `path/to/file2.ts`
```

---

## Instructions for Subagent

When you receive a subtask node following this template:

1. **Read** your subtask file and understand the scope
2. **Read parent nodes** to understand the broader context and original human request
3. **Plan minimally** - find the simplest solution, avoid unnecessary complexity
4. **Execute** - implement the requirements
5. **Update checkboxes** in your subtask file as you progress

### Guidelines

- Fail fast, don't add fallbacks or multiple options, you should give up quickly if something is broken or confusing, and your parent can handle it.
- If tests are required, write ONE behavioral test for input/output
- Stay within your boundaries - don't do work assigned to sibling subtasks
- Keep side effects to only those explicitly allowed
