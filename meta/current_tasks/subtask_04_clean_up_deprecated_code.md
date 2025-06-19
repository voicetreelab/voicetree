# Subtask: Clean Up Deprecated Code and Migration

## Overview
Multiple files and classes are marked for deletion with TODOs. This cleanup is necessary to reduce code complexity, remove confusion, and improve maintainability. The cleanup must be done carefully to ensure no active code depends on these deprecated components.

## Current State Analysis

### Files/Components to Remove
1. **EnhancedWorkflowTreeManager class**
   - File: `backend/tree_manager/enhanced_workflow_tree_manager.py:141`
   - TODO: "delete this class"
   - Status: Appears to be replaced by newer implementation

2. **Old Unified Buffer Manager Test**
   - File: `backend/tests/unit_tests/test_unified_buffer_manager.py:1`
   - TODO: "delete - old"
   - Status: Deprecated test file

3. **Test in Reproduction Issues**
   - File: `backend/tests/integration_tests/test_reproduction_issues.py:108`
   - TODO: "Delete?"
   - Status: Unclear if still needed

4. **Quality Module Location**
   - Current: `backend/benchmarker/quality/`
   - TODO: "move to agentic_workflows/quality"
   - Status: Needs relocation, not deletion

### Related Cleanup
- Remove backward compatibility code after STREAMING mode standardization
- Clean up unused imports after deletions
- Update documentation references

## Implementation Plan

### Phase 1: Dependency Analysis (Day 1)
- [ ] Search for all imports of EnhancedWorkflowTreeManager
- [ ] Check for any references to test_unified_buffer_manager
- [ ] Verify test_reproduction_issues test coverage
- [ ] Map quality module dependencies

### Phase 2: Safe Removal Process (Day 2-3)
- [ ] Create backup branch with current code
- [ ] Remove EnhancedWorkflowTreeManager class
- [ ] Delete old test files
- [ ] Move quality module to new location
- [ ] Update all imports

### Phase 3: Verification (Day 4)
- [ ] Run full test suite
- [ ] Check for broken imports
- [ ] Verify no functionality lost
- [ ] Update documentation

## Technical Approach

### Step 1: Dependency Search
```bash
# Find all imports of deprecated components
grep -r "EnhancedWorkflowTreeManager" backend/
grep -r "test_unified_buffer_manager" backend/
grep -r "from backend.benchmarker.quality" backend/
```

### Step 2: Create Migration Script
```python
#!/usr/bin/env python
"""
Migration script to clean up deprecated code
"""
import os
import shutil
from pathlib import Path

def migrate_quality_module():
    """Move quality module to new location"""
    old_path = Path("backend/benchmarker/quality")
    new_path = Path("backend/agentic_workflows/quality")
    
    if old_path.exists():
        # Create new directory
        new_path.mkdir(parents=True, exist_ok=True)
        
        # Move files
        for file in old_path.glob("*.py"):
            shutil.move(str(file), str(new_path / file.name))
        
        # Remove old directory
        shutil.rmtree(old_path)
        
        print(f"Moved quality module from {old_path} to {new_path}")

def update_imports():
    """Update all imports to new locations"""
    for root, dirs, files in os.walk("backend"):
        for file in files:
            if file.endswith(".py"):
                filepath = os.path.join(root, file)
                update_file_imports(filepath)

def update_file_imports(filepath):
    """Update imports in a single file"""
    with open(filepath, 'r') as f:
        content = f.read()
    
    # Replace old imports
    replacements = [
        ("from backend.benchmarker.quality", "from backend.agentic_workflows.quality"),
        ("import backend.benchmarker.quality", "import backend.agentic_workflows.quality"),
    ]
    
    for old, new in replacements:
        content = content.replace(old, new)
    
    with open(filepath, 'w') as f:
        f.write(content)
```

### Step 3: Removal Checklist
```python
# Files to delete
files_to_delete = [
    "backend/tree_manager/enhanced_workflow_tree_manager.py",
    "backend/tests/unit_tests/test_unified_buffer_manager.py",
]

# Lines to remove (after verification)
lines_to_remove = {
    "backend/tests/integration_tests/test_reproduction_issues.py": [108]
}

# Directories to move
dirs_to_move = {
    "backend/benchmarker/quality": "backend/agentic_workflows/quality"
}
```

## Complexities and Risks

### Technical Complexities
1. **Hidden Dependencies**: Code might be imported dynamically
2. **Test Coverage**: Removing tests might reduce coverage
3. **Import Cycles**: Moving modules might create circular imports
4. **Configuration**: Some configs might reference old paths

### Risks
1. **Breaking Production**: Removing actively used code
2. **Lost Functionality**: Deprecated code might have unique features
3. **Documentation Drift**: Docs might reference removed code
4. **External Dependencies**: Scripts or tools might use these components

### Mitigation Strategies
1. **Comprehensive Search**: Use multiple search methods to find dependencies
2. **Incremental Removal**: Remove one component at a time
3. **Test Coverage Check**: Ensure coverage doesn't drop after removal
4. **Documentation Update**: Search and update all documentation

## Verification Process

### Pre-Removal Checks
```bash
# Check test coverage before removal
pytest --cov=backend --cov-report=html
# Save coverage percentage

# Check for dynamic imports
grep -r "importlib" backend/ | grep -E "(enhanced_workflow|unified_buffer)"

# Check configuration files
grep -r "enhanced_workflow\|unified_buffer" *.yml *.yaml *.json *.toml
```

### Post-Removal Validation
```bash
# Run all tests
pytest backend/tests/

# Check imports are valid
python -m py_compile backend/**/*.py

# Verify coverage hasn't dropped significantly
pytest --cov=backend --cov-report=html
# Compare with pre-removal coverage

# Check for broken documentation links
grep -r "enhanced_workflow_tree_manager\|test_unified_buffer_manager" docs/ *.md
```

### Rollback Plan
```bash
# If issues found, rollback using git
git checkout backup-branch -- <deleted-files>

# Or restore from backup
cp backup/<file> backend/path/to/<file>
```

## Success Criteria

1. **Code Reduction**
   - At least 500 lines of deprecated code removed
   - No duplicate functionality remaining
   - Cleaner module structure

2. **Test Coverage**
   - Coverage remains above 80%
   - No loss of critical test scenarios
   - All remaining tests pass

3. **Clean Imports**
   - No broken imports
   - No circular dependencies
   - Clear module organization

4. **Documentation**
   - All references updated
   - No broken links
   - Clear migration notes

## Dependencies
- Should be done after STREAMING mode standardization
- Coordinate with any active feature development
- Ensure CI/CD pipeline updated

## Cleanup Order

1. **First Wave - Safe Deletions**
   - Old test files that are clearly marked "delete"
   - Unused utility functions

2. **Second Wave - Class Removal**
   - EnhancedWorkflowTreeManager after verifying no usage
   - Associated helper classes

3. **Third Wave - Module Reorganization**
   - Move quality module
   - Update all imports
   - Clean up empty directories

4. **Final Wave - Documentation**
   - Update all .md files
   - Remove references from comments
   - Update architecture diagrams

## Notes
- This cleanup will significantly improve code maintainability
- Should be done in small, reviewable commits
- Each deletion should have clear justification in commit message
- Consider automating similar cleanups in future with linting rules