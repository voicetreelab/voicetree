# Test Quality Evaluation Orchestrator

Evaluates and improves unit test quality across a codebase using parallel subagents.

## Subagent Prompt
See: `test_quality_evaluation_prompt.md` (same directory)

## Steps

### 1. Discover Tests
Get a list of all unit tests in the application (exclude node_modules).

### 2. Group Tests
Group them into roughly 6 groups.

### 3. Evaluate (Parallel)
Run parallel subagents for each group, with the quality evaluation prompt.

### 4. Collect & Sort
After they have all responded, save all their responses to a file, and then sort their responses by net_score (worst first).

### 5. Fix Bad Tests (Parallel)
For each test with a score > -5 (the bad ones), spawn a subagent with context of the output from the previous analysis subagent, and tell it to execute the improvements or actions:
- Remove redundancy
- Delete if necessary
- Soften/reduce assertions
- etc.

## Output
- `test_quality_evaluation_results.md` - Sorted analysis of all tests
- Modified test files with reduced redundancy and improved quality
