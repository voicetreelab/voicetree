# Fix Broken Tests

You are tasked with fixing broken tests based on recent code changes. 

Just fix the tests that are related to the changes in the last commit.

## Rules
- **ONLY modify test files** - never change production code
- Fix tests to work with the new code implementation 
- Update imports, method calls, assertions, and test data as needed
- Preserve the original test intent and coverage
- Do not remove tests unless they are genuinely obsolete

## Context
The git diff below shows what changed in the production code. Use this to understand which tests to run, and how to update the failing tests.

## Your Task
0. Find possibly relevant tests: navigate up the call hierarchy from the changed methods. up to 3 method distance away, you can use serena symbol search for this.
1. Run the relevant tests to see current failures
2. Analyze the git diff to understand what changed
3. Fix the failing tests to work with the new code
4. Ensure all tests pass without changing production files

Focus on mechanical fixes like:
- Updated method signatures
- Changed import paths  
- Modified return values/data structures
- New required parameters

Git diff follows: