---
name: workflow-verifier
description: Verifies that all workflows in the voicetree/workflows folder follow the correct SKILL.md format. Can optionally fix non-compliant workflows in place.
user-invocable: true
---

# Workflow Verifier

Verifies that all workflows in the ~/voicetree/workflows/ folder follow the correct SKILL.md format. Checks for proper title, introduction paragraph, and parameter formatting (Required/Optional sections with {{VAR}} syntax including type and description for each parameter). Reports issues or fixes them in place based on the OVERRIDE parameter.

Required:

{{OVERRIDE}}
Whether to fix non-compliant workflows in place or only report issues
boolean

## Instructions

The OVERRIDE parameter controls behavior:
- If `OVERRIDE` is `true`: fix non-compliant workflows by rewriting their SKILL.md files to match the required format
- If `OVERRIDE` is `false`: report all issues found without modifying any files

## Required SKILL.md Format

Every workflow SKILL.md must have these elements in order:

1. **YAML frontmatter** with `name`, `description`, and `user-invocable` fields
2. **Title**: A `# Title` as the first markdown heading
3. **Introduction**: At least one paragraph describing what the skill does, placed after the title but before the parameters
4. **Parameters** formatted as shown below. Each parameter must include a description and a type on the lines following it:

Example parameter format:
```
Required:

{{REQUIRED_VAR_1}}
Description of what this parameter does
string

{{REQUIRED_VAR_2}}
Description of what this parameter does
number

Optional:

{{OPTIONAL_VAR_1=default_value}}
Description of what this parameter does
string

{{OPTIONAL_VAR_2=default_value}}
Description of what this parameter does
boolean
```

If a workflow has no required parameters, omit the `Required:` section. If it has no optional parameters, omit the `Optional:` section.

## Verification Steps

1. List all subdirectories in `~/voicetree/workflows/`
2. For each directory containing a `SKILL.md`, read the file
3. Check each file against the required format:
   - Has `# Title` as first heading
   - Has an introduction paragraph between the title and the parameters
   - Parameters use `Required:` / `Optional:` sections with `{{VAR}}` or `{{VAR=default}}` format
   - Each parameter is followed by a description line and a type line
   - No legacy parameter formats (`## Parameters`, `$ARGUMENTS`, backtick-wrapped vars, bold-wrapped vars)
4. Report findings per workflow:
   - Which checks pass/fail
   - What specific issues were found
   - What the fix would be

## Fixing Workflows (OVERRIDE=true)

When fixing, preserve:
- The YAML frontmatter exactly as-is
- The title heading
- The introduction content (may need to extract from existing text)
- All parameter names and defaults
- All instructional content after the parameters section

Transform:
- Restructure parameters into `Required:` / `Optional:` format with description and type for each
- Move introduction text to the correct position if misplaced

## Output

Create a progress node summarizing:
- Total workflows scanned
- Number compliant / non-compliant
- Per-workflow issue list
- If OVERRIDE=true, which files were modified
