# Subtask: Standardize on STREAMING Mode

## Overview
This is a critical architectural change to eliminate the dual-mode confusion between ATOMIC and STREAMING execution types. Multiple developers have expressed confusion about which mode to use, and the codebase maintains unnecessary backward compatibility.

## Current State Analysis

### Problem Summary
- The system currently supports both ATOMIC and STREAMING modes
- Multiple TODOs indicate confusion: "why backwards compat? There should be only one option for doing something!"
- Developers are unsure which mode to use: "'STREAMING' or None or maybe 'ATOMIC'? Not actually sure"
- Redundant parameters exist (`streaming` parameter duplicates `execution_type`)
- **Phase 1 Finding**: Only ATOMIC mode is actually used, but STREAMING architecture is superior

### Affected Files
1. **backend/workflow_adapter.py**
   - Lines 47-48: Backward compatibility code
   - Lines 114-115: Redundant `streaming` parameter
   - Contains mode selection logic

2. **backend/settings.py**
   - Line 95: Unclear default execution type
   - Configuration for both modes

3. **backend/enhanced_transcription_processor.py**
   - Line 125: Streaming mode confusion
   - Line 241: Backward compatibility wrapper

4. **backend/tree_manager/text_to_tree_manager.py**
   - Line 55: Unclear streaming parameter

5. **backend/agentic_workflows/infrastructure_executor.py**
   - Lines 50, 119, 138, 148: Multiple "What is correct?" comments

## Implementation Plan

### Phase 1: Analysis and Documentation (Day 1) ✅ COMPLETED
- [x] Map all usages of ATOMIC mode throughout codebase
- [x] Document current behavior differences between ATOMIC and STREAMING  
- [x] Figure out which mode is better for our system, and how to safely remove the unnecessary one.

**Analysis Results**: See `/meta/current_tasks/phase1_analysis_atomic_vs_streaming.md`

**Key Findings**:
- ATOMIC mode: Applies tree changes immediately after workflow processing
- STREAMING mode: Returns actions without applying them (better architecture)
- Only ATOMIC is currently used in production
- STREAMING provides better separation of concerns and flexibility

**Decision**: Remove ATOMIC mode, keep STREAMING mode with explicit action application 

### Phase 2: Code Removal (Day 2-3)
- [ ] Remove ATOMIC mode handling from `workflow_adapter.py`
- [ ] Remove redundant `streaming` parameter
- [ ] Update all mode checks to assume STREAMING
- [ ] Remove backward compatibility wrappers
- [ ] Update configuration to have single execution type

### Phase 3: Simplification (Day 4)
- [ ] Rename STREAMING mode to just standard execution (remove mode concept entirely)
- [ ] Simplify execution flow since there's only one path
- [ ] Remove all conditional logic based on execution type
- [ ] Update method signatures to remove mode parameters

### Phase 4: Testing and Validation (Day 5)
- [ ] Update all tests to remove ATOMIC mode references
- [ ] Ensure all integration tests pass
- [ ] Run performance benchmarks to ensure no regression
- [ ] Test with real voice input scenarios

## Technical Approach

### Step 1: Create Feature Flag (Temporary)
```python
# settings.py
ENABLE_ATOMIC_MODE = False  # Deprecation flag
```

### Step 2: Update WorkflowAdapter
```python
# Remove this pattern:
if execution_type == "ATOMIC":
    # atomic logic
else:
    # streaming logic

# Replace with:
# streaming logic only
```

### Step 3: Simplify Method Signatures
```python
# Before:
def process(text, execution_type="STREAMING", streaming=True):

# After:
def process(text):
```

### Step 4: Update Configuration
```python
# Before:
WORKFLOW_EXECUTION_TYPE = os.getenv("WORKFLOW_EXECUTION_TYPE", "STREAMING")

# After:
# Remove entirely - no need for configuration of single option
```

## Complexities and Risks

### Technical Complexities
1. **Hidden Dependencies**: ATOMIC mode might be used in places not immediately obvious
2. **Test Coverage**: Many tests might be specifically testing ATOMIC mode behavior
3. **Performance**: Need to ensure STREAMING mode performs well for all use cases
4. **State Management**: STREAMING mode handles state differently - ensure consistency

### Migration Risks
1. **Breaking Changes**: This is a breaking change for any code using ATOMIC mode
2. **Documentation**: All documentation needs updating
3. **User Scripts**: Any automation or scripts might rely on ATOMIC mode
4. **Default Behavior**: Changing defaults might surprise users

### Mitigation Strategies
1. **Gradual Rollout**: Use feature flag to disable ATOMIC mode before removing
2. **Comprehensive Testing**: Run full test suite after each change
3. **Documentation First**: Update docs before code changes
4. **Clear Communication**: Add deprecation warnings before removal

## Success Criteria

1. **Code Simplification**
   - No more execution_type parameters
   - No more mode selection logic
   - Single, clear execution path

2. **Developer Experience**
   - No more TODOs about mode confusion
   - Clear, simple API
   - Obvious how to use the system

3. **Performance**
   - No performance regression
   - Potentially improved performance from simpler code path

4. **Testing**
   - All tests pass
   - No flaky tests due to mode issues
   - Simpler test setup

## Dependencies
- None - this is a foundational change that other tasks depend on

## Rollback Plan
1. Keep ATOMIC mode code in a separate branch for 30 days
2. Document how to re-enable if critical issues found
3. Have quick revert strategy for git commits

## Notes
- This change aligns with the principle: "There should be only one option for doing something"
- Will significantly reduce code complexity and developer confusion
- Should be done early as it affects many other components