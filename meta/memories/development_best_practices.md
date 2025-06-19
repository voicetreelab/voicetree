# VoiceTree Development Best Practices

## Purpose
This document captures key development principles and patterns to prevent common mistakes identified through TODO analysis. These guidelines should be followed to maintain code quality and avoid repeating past issues.

## Core Principles

### 1. Single Execution Path Principle
**Problem Identified**: Multiple TODOs show confusion between ATOMIC and STREAMING modes, with developers unsure which to use.

**Best Practice**: 
- Maintain only ONE way to execute any given functionality
- Avoid "backward compatibility" modes that create confusion
- If multiple approaches exist, clearly deprecate all but one
- Document the single correct approach prominently

**Example**: The system should have either STREAMING or ATOMIC mode, not both.

### 2. Performance-First Design
**Problem Identified**: Linear search in `get_node_id_from_name()` with TODO: "THIS WONT SCALE"

**Best Practice**:
- Always consider algorithmic complexity during initial implementation
- Use appropriate data structures (hash maps for O(1) lookup, indexes for search)
- Add performance tests for any operation that will scale with data size
- Document expected performance characteristics in code comments

**Anti-pattern to Avoid**:
```python
# BAD - Linear search
def get_node_id_from_name(tree, name):
    for node in tree.nodes:
        if node.name == name:
            return node.id
```

**Preferred Pattern**:
```python
# GOOD - Hash-based lookup
class Tree:
    def __init__(self):
        self.nodes = {}
        self.name_to_id = {}  # Maintain index
```

### 3. Clear Configuration Defaults
**Problem Identified**: Multiple TODOs about unclear default values and confusing parameters

**Best Practice**:
- Always provide sensible defaults for configuration
- Document what each configuration option does
- Use type hints and enums for valid values
- Avoid optional parameters that duplicate functionality

**Example**:
```python
# BAD
execution_type = "STREAMING"  # TODO: or None or maybe "ATOMIC"? Not actually sure

# GOOD
from enum import Enum
class ExecutionType(Enum):
    STREAMING = "STREAMING"  # Default: processes data as stream

execution_type: ExecutionType = ExecutionType.STREAMING
```

### 4. Complete Implementation Before Integration
**Problem Identified**: Core tree reorganization agent has "TODO: Implement the actual agent logic"

**Best Practice**:
- Never commit skeleton/stub implementations to main branch
- Use feature branches for incomplete work
- Add clear "NOT IMPLEMENTED" exceptions rather than empty TODOs
- Complete core functionality before adding to system

### 5. Deprecation Management
**Problem Identified**: Multiple "delete this" TODOs for old code still in codebase

**Best Practice**:
- Remove deprecated code immediately after confirming it's unused
- Use deprecation decorators with removal dates
- Don't maintain old test files - delete or update them
- Run coverage reports to identify dead code

### 6. Module Organization
**Problem Identified**: Confusing import paths like `voice_to_text.voice_to_text`

**Best Practice**:
- Follow Python module naming conventions
- Avoid redundant module names
- Use `__init__.py` to expose clean APIs
- Structure: `package.module.function`, not `package.package.function`

### 7. Consistent Output Locations
**Problem Identified**: Multiple output directories causing confusion

**Best Practice**:
- Define all output paths in a central configuration
- Use a single, well-organized output directory structure
- Never hardcode paths in individual modules
- Document the output directory structure in README

### 8. Test Reliability
**Problem Identified**: Flaky tests that need fixing

**Best Practice**:
- Fix flaky tests immediately - they erode confidence
- Use proper test isolation (no shared state)
- Mock external dependencies consistently
- Add retry logic only for truly transient issues
- Document why a test might be flaky if it must be

### 9. Clear TODOs
**Problem Identified**: Vague TODOs like "Check what happens with the outputs?"

**Best Practice**:
- Make TODOs actionable with clear descriptions
- Include context about why the TODO exists
- Assign TODOs to specific people when possible
- Use format: `TODO(username): Clear action - Context`

**Example**:
```python
# BAD
# TODO: Check what happens with the outputs?

# GOOD
# TODO(john): Verify outputs are saved to unified_benchmark_reports/ directory
#             Currently unclear if old reports are overwritten or versioned
```

### 10. Migration Path Planning
**Problem Identified**: "TODO: migrate to LangGraph" without clear plan

**Best Practice**:
- Document migration requirements before starting
- Create a migration checklist
- Maintain compatibility during transition
- Have clear cutover plan
- Update all documentation after migration

## Common Mistakes to Avoid

1. **Don't create dual-mode systems** - Pick one approach and stick with it
2. **Don't use linear algorithms for scalable operations** - Think O(n) vs O(1)
3. **Don't leave stub implementations** - Complete or don't commit
4. **Don't keep deprecated code** - Delete it
5. **Don't create confusing module structures** - Keep imports clean
6. **Don't scatter output files** - Centralize output management
7. **Don't ignore flaky tests** - Fix them immediately
8. **Don't write vague TODOs** - Be specific and actionable

## Implementation Checklist

Before committing code, verify:
- [ ] No dual-mode confusion (single execution path)
- [ ] Scalable algorithms used (no unnecessary O(n) operations)
- [ ] Complete implementation (no stub TODOs)
- [ ] Old code removed (no deprecation TODOs)
- [ ] Clean module structure
- [ ] Centralized configuration
- [ ] Reliable tests (no flaky)
- [ ] Clear, actionable TODOs if any remain

## Continuous Improvement

This document should be updated when new patterns emerge from code reviews or TODO analysis. Each update should include:
1. The problem identified
2. The best practice to prevent it
3. Concrete examples
4. How to detect the issue in code review