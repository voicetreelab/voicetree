# VoiceTree TODO Compilation

This document contains all TODO, FIXME, XXX, HACK, BUG, OPTIMIZE, and REFACTOR comments found across the VoiceTree project, organized by category.

## Architecture & Design

### Workflow System Architecture
- **File**: `backend/workflow_adapter.py:18`
  - **TODO**: "we don't want multiple definitions - can we avoid this?"
  - **Context**: NodeAction is defined locally to avoid circular imports
  
- **File**: `backend/workflow_adapter.py:38`
  - **TODO**: "WE DON'T NEED TWO DIFFERENT MODES"
  - **Context**: WorkflowMode enum has ATOMIC and STREAMING modes

- **File**: `backend/workflow_adapter.py:177-178`
  - **TODO**: "What??? why do this"
  - **TODO**: "let UnifiedBufferManager handle chunking for us here, then don't have a seperate 'buffer' here that just force processes????"
  - **Context**: Force processing buffer regardless of threshold

- **File**: `backend/workflow_adapter.py:189`
  - **TODO**: "why is this if statement actually necessary? seems confusing and unnecessary"
  - **Context**: Re-running with proper existing nodes if needed

- **File**: `backend/workflow_adapter.py:216`
  - **TODO**: "don't have two different modes? Why did we even want this initially?"
  - **Context**: Applying changes in atomic mode

- **File**: `backend/workflow_adapter.py:127`
  - **TODO**: "avoid this fuckaround, only one mode pls"
  - **Context**: Duplicate node creation issue with WorkflowAdapter modes

### Relationship Handling
- **File**: `backend/workflow_adapter.py:77`
  - **TODO**: "why the hell do we have this? relationship_for_edge vs relationship"
  - **Context**: Confusing dual naming for relationship fields

### Import System
- **File**: `backend/enhanced_transcription_processor.py:241`
  - **TODO**: "why the hell do we need backwards compatibility here? we should only ever have one option for doing something"
  - **Context**: TranscriptionProcessor backward compatibility wrapper

## Data Structures & Algorithms

### Tree Operations
- **File**: `backend/tree_manager/decision_tree_ds.py:107`
  - **TODO**: "this won't scale"
  - **Context**: get_node_id_from_name using linear search through all nodes

### Text Processing
- **File**: `backend/tree_manager/text_to_tree_manager.py:94`
  - **TODO**: "just use a regex"
  - **Context**: Finding last sentence ending manually instead of using regex

- **File**: `backend/tree_manager/text_to_tree_manager.py:133`
  - **TODO**: "this is a hacky way handle edge case of where there is leftover in text_Buffer, now not ending on a space"
  - **Context**: Handling whitespace after clearing processed text

- **File**: `backend/tree_manager/text_to_tree_manager.py:160`
  - **TODO**: "have seperate buffer for incomplete nodes"
  - **Context**: Currently skipping incomplete nodes

## Configuration & Settings

### Parameter Tuning
- **File**: `backend/settings.py:43`
  - **TODO**: "lower or higher?"
  - **Context**: TRANSCRIPT_HISTORY_MULTIPLIER parameter value optimization

### File Paths
- **File**: `backend/enhanced_transcription_processor.py:42`
  - **TODO**: "make relative"
  - **Context**: Hardcoded absolute path for output directory

### Settings Usage
- **File**: `backend/README-dev.md:32-33`
  - **TODO**: "remove options: enable_background_optimization=True"
  - **TODO**: "use BACKGROUND_REWRITE_EVERY_N_APPEND, not minutes optimization_interval_minutes=2"
  - **Context**: Configuration options that should be simplified

## LLM Integration

### Prompt Engineering
- **File**: `backend/tree_manager/LLM_engine/background_rewrite.py:17`
  - **TODO**: "correct?"
  - **Context**: Don't rewrite the root node - questioning if this is correct behavior

- **File**: `backend/tree_manager/LLM_engine/background_rewrite.py:35`
  - **TODO**: "mention that transcript history won't include new user content"
  - **Context**: Rewrite prompt needs clarification

- **File**: `backend/tree_manager/LLM_engine/background_rewrite.py:36`
  - **TODO**: "include siblings"
  - **Context**: Rewrite should consider sibling nodes

- **File**: `backend/tree_manager/LLM_engine/background_rewrite.py:38`
  - **TODO**: "could we also re-write siblings??!!"
  - **Context**: Potential optimization to rewrite related nodes together

- **File**: `backend/tree_manager/LLM_engine/background_rewrite.py:40`
  - **TODO**: "explain why the nodes become messy"
  - **Context**: Need better explanation in prompt about why nodes degrade

## Testing

### Test Improvements
- **File**: `backend/tests/integration_tests/agentic_workflows/test_voicetree_improvements.py:39`
  - **TODO**: "Add minimum length validation if needed"
  - **Context**: Short transcript handling in segmentation error test

- **File**: `backend/tests/unit_tests/test_contextual_tree_manager.py:55,115`
  - **TODO**: "REMOVE (OLD)"
  - **TODO**: "flaky, (no longer needed?)"
  - **Context**: Old test methods that should be removed or fixed

## Quality & Benchmarking

### Benchmarker Enhancements
- **File**: `backend/benchmarker/quality_tests/quality_LLM_benchmarker.py:17`
  - **TODO**: "include photo of tree?"
  - **Context**: Visual representation in quality evaluation

- **File**: `backend/benchmarker/quality_tests/quality_LLM_benchmarker.py:19`
  - **TODO**: "include best representation of tree as text in prompt"
  - **Context**: Better tree representation for LLM evaluation

## Documentation

### New Agent Documentation
- **File**: `README-dev.md:30`
  - **TODO**: "new agent being created that automatically optimises the tree. i.e. takes (tree_structure, historical_text) -> optimized_tree_structure"
  - **Context**: Document the tree-reorganizing-agent

## Code Cleanup

### Unused Code
- **File**: `backend/workflow_adapter.py:265-272`
  - **TODO**: Multiple commented-out code blocks that should be removed if no longer needed
  - **Context**: Parent relationship and modification tracking code

## Priority Recommendations

### High Priority
1. **Workflow Mode Simplification**: Remove dual mode system (ATOMIC/STREAMING) - multiple TODOs indicate confusion
2. **Tree Scaling**: Fix linear search in `get_node_id_from_name` - won't scale
3. **Import System**: Remove backward compatibility wrappers - "only one option for doing something"

### Medium Priority
1. **Relationship Field Naming**: Unify "relationship" vs "relationship_for_edge"
2. **Buffer Management**: Clarify buffer handling between WorkflowAdapter and UnifiedBufferManager
3. **Configuration Cleanup**: Remove deprecated options and use consistent settings

### Low Priority
1. **Regex Usage**: Replace manual sentence ending detection with regex
2. **Test Cleanup**: Remove old/flaky tests
3. **Documentation**: Add tree-reorganizing-agent documentation

## Notes for Future Development

1. The system has evolved from multiple implementations to a unified approach, but legacy code and backward compatibility wrappers remain
2. The dual-mode workflow system (ATOMIC vs STREAMING) appears to be unnecessary complexity
3. Several TODOs indicate uncertainty about design decisions that should be resolved
4. The import system was previously fixed (removing 40+ sys.path hacks) but some complexity remains