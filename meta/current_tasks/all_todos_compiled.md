# VoiceTree Project - Complete TODO List & Task Plan

## Executive Summary

This document compiles all TODO items found across the VoiceTree codebase as of 2025-06-19. The TODOs reveal key architectural decisions pending, technical debt to address, and opportunities for system improvement.

**Total TODOs Found**: 28 distinct items across 9 Python files and 3 documentation files

## Progress Tracking

### Overall Progress
- [x] Phase 1: Critical Architecture Fixes (8/8 tasks) ✅ STREAMING MODE COMPLETE
- [ ] Phase 2: Complete Core Features (0/4 tasks)
- [ ] Phase 3: Enhancement & Polish (0/6 tasks)
- [ ] Phase 4: Configuration & Documentation (0/8 tasks)

**Total Progress: 8/26 tasks completed**

## Critical Architecture Issues

### 1. Workflow Mode Confusion (HIGH PRIORITY)
The system currently supports both ATOMIC and STREAMING modes, but multiple TODOs indicate this is causing unnecessary complexity:

- **File**: `backend/workflow_adapter.py:47-48`
  - TODO: "why backwards compat? There should be only one option for doing something!"
  - Context: Dual mode system maintaining backward compatibility unnecessarily
  
- **File**: `backend/workflow_adapter.py:114-115`
  - TODO: "Remove this redundant param"
  - Context: `streaming` parameter is redundant with `execution_type`

- **File**: `backend/settings.py:95`
  - TODO: "'STREAMING' or None or maybe 'ATOMIC'? Not actually sure"
  - Context: Developer confusion about which mode to use

**Recommendation**: Remove ATOMIC mode entirely and standardize on STREAMING mode as the single execution path.

**✅ Phase 1 Analysis Complete**: Confirmed STREAMING mode is architecturally superior. See `/meta/current_tasks/phase1_analysis_atomic_vs_streaming.md` for detailed analysis.

### 2. Tree Search Performance Issue (HIGH PRIORITY)
- **File**: `backend/tree_manager/utils.py:28-30`
  - TODO: "THIS WONT SCALE - uses linear search"
  - Function: `get_node_id_from_name()`
  - Impact: Performance will degrade as tree grows

**Recommendation**: Implement a hash-based lookup or maintain an index for O(1) node name lookups.

## System Components TODOs

### Tree Manager System (5 TODOs)

1. **Enhanced Workflow Manager Cleanup**
   - File: `backend/tree_manager/enhanced_workflow_tree_manager.py:141`
   - TODO: "delete this class"
   - Status: Appears to be deprecated code

2. **LLM Rewriting Feature**
   - File: `backend/tree_manager/enhanced_workflow_tree_manager.py:164-165`
   - TODO: "also rewrite parent node using LLM, and potentially rename"
   - Enhancement: Improve tree quality through LLM-based node optimization

3. **Background Rewrite System**
   - File: `backend/tree_manager/LLM_engine/background_rewrite.py:52`
   - TODO: "migrate to LangGraph"
   - Technical debt: Using older implementation pattern

### Enhanced Transcription Processor (3 TODOs)

1. **Mode Selection**
   - File: `backend/enhanced_transcription_processor.py:125`
   - TODO: "streaming = what do I set it to? Does it come from a param? There isn't a good example."
   - Shows confusion about proper initialization

2. **Agent Integration**
   - File: `backend/tree_reorganization_agent.py:15`
   - TODO: "Implement the actual agent logic"
   - Critical: Core functionality not yet implemented

### Configuration & Settings (3 TODOs)

1. **Voice Module Path**
   - File: `backend/settings.py:24`
   - TODO: "Fix the voice-to-text module import path"
   - Current: `voice_to_text.voice_to_text`
   - Needs: Proper module organization

2. **Output Directory**
   - File: `backend/settings.py:37`
   - TODO: "update to shared directory: unified_benchmark_reports"
   - Standardization needed for output locations

3. **Execution Type Default**
   - File: `backend/settings.py:95`
   - TODO: Clarify default execution type

### Testing Infrastructure (2 TODOs)

1. **Flaky Test**
   - File: `backend/tests/unit_tests/test_tree_manager_day3.py:213`
   - TODO: "Fix flaky test"
   - Test: `test_full_reorganization`

2. **Old Test Cleanup**
   - File: `backend/tests/unit_tests/test_unified_buffer_manager.py:1`
   - TODO: "delete - old"
   - Deprecated test file

### Quality & Benchmarking (2 TODOs)

1. **Benchmark Function**
   - File: `backend/benchmarker/unified_voicetree_benchmarker.py:64`
   - TODO: "populate this function"
   - Function: `benchmark_execution_time()`

2. **Quality Log Enhancement**
   - File: `backend/benchmarker/quality_tests/quality_LLM_benchmarker.py:203`
   - TODO: "Simplify the quality_log output"

### Documentation (1 TODO)

1. **Tree Reorganization Agent**
   - File: `README-dev.md:28-35`
   - TODO: Document new tree-reorganizing-agent
   - Status: Agent being created for automatic tree optimization

## Implementation Plan

### Phase 1: Critical Architecture Fixes (Week 1)

#### 1. Standardize on STREAMING mode ✅ COMPLETED
- [x] ~~Remove ATOMIC mode code from `backend/workflow_adapter.py`~~
- [x] ~~Remove redundant `streaming` parameter in `backend/workflow_adapter.py:114-115`~~
- [x] ~~Update `backend/settings.py:95` to clarify execution type default as STREAMING~~
- [x] ~~Update all references to use STREAMING only~~
- [x] ~~Update documentation to reflect single execution mode~~
- [x] ~~Add proper error handling to _apply_node_actions~~

#### 2. Fix Tree Search Performance
- [ ] Implement hash-based node lookup in `backend/tree_manager/utils.py:28-30`
- [ ] Add performance tests for node lookups
- [ ] Benchmark improvement (target: < 1ms for 10,000 nodes)

### Phase 2: Complete Core Features (Week 2)

#### 1. Implement Tree Reorganization Agent
- [ ] Complete agent logic in `backend/tree_reorganization_agent.py:15`
- [ ] Add comprehensive tests for tree reorganization agent
- [ ] Document functionality in README-dev.md

#### 2. Clean up deprecated code
- [ ] Delete `EnhancedWorkflowTreeManager` class in `backend/tree_manager/enhanced_workflow_tree_manager.py:141`
- [ ] Delete old test file `backend/tests/unit_tests/test_unified_buffer_manager.py`
- [ ] Remove deprecated test in `backend/tests/integration_tests/test_reproduction_issues.py:108`
- [ ] Update all imports after cleanup

### Phase 3: Enhancement & Polish (Week 3)

#### 1. LLM Integration Improvements
- [ ] Implement parent node rewriting using LLM in `backend/tree_manager/enhanced_workflow_tree_manager.py:164-165`
- [ ] Migrate background rewrite to LangGraph in `backend/tree_manager/LLM_engine/background_rewrite.py:52`
- [ ] Update prompts in `backend/tree_manager/LLM_engine/prompts/prompt_utils.py:21`

#### 2. Testing & Quality
- [ ] Fix flaky test in `backend/tests/unit_tests/test_tree_manager_day3.py:213`
- [ ] Implement `benchmark_execution_time()` in `backend/benchmarker/unified_voicetree_benchmarker.py:64`
- [ ] Simplify quality log output in `backend/benchmarker/quality_tests/quality_LLM_benchmarker.py:203`

### Phase 4: Configuration & Documentation (Week 4)

#### 1. Standardize Configuration
- [ ] Fix voice-to-text module import path in `backend/settings.py:24`
- [ ] Update output directory to `unified_benchmark_reports` in `backend/settings.py:37`
- [ ] Remove redundant code in `backend/agentic_workflows/nodes.py:11`
- [ ] Move quality module from `backend/benchmarker/quality/` to `backend/agentic_workflows/quality/`
- [ ] Clarify execution configuration in `backend/agentic_workflows/infrastructure_executor.py` (lines 50, 119, 138, 148)

#### 2. Update Documentation
- [ ] Document tree reorganization agent in `README-dev.md:28-35`
- [ ] Update developer guides with new architecture
- [ ] Add architecture decision records for STREAMING-only mode

## Success Metrics

1. **Performance**: Tree search operations < 1ms for trees with 10,000 nodes
2. **Code Quality**: Zero flaky tests, all deprecated code removed
3. **Developer Experience**: Single clear execution path, no mode confusion
4. **Documentation**: All new features documented with examples

## Risk Mitigation

1. **Backward Compatibility**: Though TODOs suggest removing it, ensure migration path for existing users
2. **Performance Regression**: Benchmark all changes, especially tree operations
3. **Feature Completeness**: Prioritize completing tree reorganization agent as it's core functionality

## Minor TODOs & Code Cleanup

### Additional Items to Address
- [ ] Fix streaming mode confusion in `backend/enhanced_transcription_processor.py:125`
- [ ] Remove print statement in `backend/tree_manager/workflow_tree_manager.py:161`
- [ ] Fix "uses message instead of text" in `backend/tree_manager/workflow_tree_manager.py:148`
- [ ] Clarify streaming parameter in `backend/tree_manager/text_to_tree_manager.py:55`
- [ ] Verify outputs handling in `backend/benchmarker/debug_workflow.py:107`
- [ ] Remove backwards compatibility wrapper in `backend/enhanced_transcription_processor.py:241`
- [ ] Make output directory relative (not absolute) in `backend/enhanced_transcription_processor.py:42`

## Appendix: Raw TODO List by File

### Python Files (28 TODOs)

1. **backend/tree_manager/utils.py**
   - Line 28-30: "THIS WONT SCALE" - Linear search in get_node_id_from_name()

2. **backend/tree_manager/workflow_tree_manager.py**
   - Line 148: "uses message instead of text"
   - Line 161: "remove print"

3. **backend/tree_manager/enhanced_workflow_tree_manager.py**
   - Line 141: "delete this class"
   - Line 164-165: "also rewrite parent node using LLM"

4. **backend/enhanced_transcription_processor.py**
   - Line 125: Streaming mode confusion

5. **backend/settings.py**
   - Line 24: Fix voice-to-text import path
   - Line 37: Update to unified_benchmark_reports
   - Line 95: Clarify execution type default

6. **backend/workflow_adapter.py**
   - Line 47-48: Question backward compatibility
   - Line 114-115: Remove redundant param

7. **backend/tree_reorganization_agent.py**
   - Line 15: Implement agent logic

8. **backend/benchmarker/unified_voicetree_benchmarker.py**
   - Line 64: Populate benchmark_execution_time()

9. **backend/benchmarker/debug_workflow.py**
   - Line 107: "Check what happens with the outputs?"

10. **backend/tree_manager/text_to_tree_manager.py**
    - Line 55: "streaming = ?"

11. **backend/agentic_workflows/infrastructure_executor.py**
    - Line 50, 119, 138, 148: Multiple "What is correct?" comments

12. **backend/tests/integration_tests/test_reproduction_issues.py**
    - Line 108: "Delete?"

13. **backend/agentic_workflows/nodes.py**
    - Line 11: "remove / can be handled by standard library"

14. **backend/benchmarker/quality/__init__.py**
    - Line 1: "move to agentic_workflows/quality"

15. **backend/tree_manager/LLM_engine/prompts/prompt_utils.py**
    - Line 21: "Update this"

16. **backend/tree_manager/LLM_engine/background_rewrite.py**
    - Line 52: "migrate to LangGraph"

17. **backend/tests/unit_tests/test_tree_manager_day3.py**
    - Line 213: "Fix flaky test"

18. **backend/tests/unit_tests/test_unified_buffer_manager.py**
    - Line 1: "delete - old"

19. **backend/benchmarker/quality_tests/quality_LLM_benchmarker.py**
    - Line 203: "Simplify the quality_log output"

### Markdown Files (1 TODO)

1. **README-dev.md**
   - Line 28-35: Document tree-reorganizing-agent

### Text Files (1 TODO)

1. **meta/current_tasks/current_tasks_index.txt**
   - Contains project task planning notes