# VoiceTree Pipeline Implementation Progress v2

## Current Status

### ✅ Completed (Previous Engineer)
- **Infrastructure**: `get_neighbors()`, `update_node()`, unified action models (`BaseTreeAction`, `UpdateAction`, `CreateAction`)
- **TreeActionApplier**: UPDATE action support, unified `apply()` method
- **Prompts**: All 3 prompts created (`segmentation.md`, `identify_target_node.md`, `single_abstraction_optimizer.md`)
- **ID-based operations**: Models updated to use node IDs instead of names
- **Tests**: All infrastructure tests passing (DecisionTree methods, TreeActionApplier UPDATE, unified action model)

### ❌ Not Started
- **Phase 1 Cleanup**: Remove all legacy code (name-based lookups, `IntegrationDecision`, multiple apply methods)
- **Phase 2 Agents**: `AppendToRelevantNodeAgent`, `SingleAbstractionOptimizerAgent`, new `TreeActionDeciderAgent`
- **Phase 3 Integration**: Update `ChunkProcessor` and E2E tests

## Key Clarifications

1. **AppendAction model needed** - Clean separation: `AppendAction` for adding to existing nodes, `CreateAction` for new nodes, `UpdateAction` for modifications
2. **Translation layer** - Deterministic Python code in `AppendToRelevantNodeAgent.run()` converts `TargetNodeIdentification` → `AppendAction`/`CreateAction`
3. **No backward compatibility** - Delete all legacy code immediately
4. **Prompts already updated** - Previous engineer completed prompt modifications
5. **Delegate isolated tasks** - Use sub-agents for well-defined cleanup tasks
6. **Follow TDD** - Write tests first, then implement

## Implementation Plan

### Phase 1: Complete Cleanup (High Priority) ✅
1. [x] Create `AppendAction` model in models.py
2. [x] Update TreeActionApplier to handle `AppendAction` in unified `apply()` method
3. [x] Remove `get_node_id_from_name()` from DecisionTree
4. [x] Remove `IntegrationDecision` model
5. [x] Simplify TreeActionApplier - keep only `apply(actions: List[BaseTreeAction])`
6. [x] Remove all name-based fallback logic
7. [x] Create comprehensive behavioral tests for tree actions

Progress notes:
- Added `AppendAction(BaseTreeAction)` with `target_node_id` and `content` fields
- Updated TreeActionApplier's unified `apply()` method to handle APPEND actions
- Added `_apply_append_action_unified()` method that uses `node.append_content()`
- Removed `get_node_id_from_name()` method from DecisionTree
- Removed `IntegrationDecision` model and updated all imports
- Made `apply_optimization_actions()` and `apply_mixed_actions()` private
- Removed name-based fallback in `_apply_create_action_from_optimizer()`
- Created behavioral tests that verify ID-only operations work correctly

### Phase 2: Agent Implementation (TDD)
1. [ ] Run existing tests for `AppendToRelevantNodeAgent` (expect failure)
2. [ ] Implement `AppendToRelevantNodeAgent`
   - Input: raw text + tree state
   - Output: List[TargetNodeIdentification | CreateAction]
3. [ ] Run existing tests for `SingleAbstractionOptimizerAgent` (expect failure)
4. [ ] Implement `SingleAbstractionOptimizerAgent`
   - Input: node_id + tree state
   - Output: List[UpdateAction | CreateAction]
5. [ ] Run existing tests for new `TreeActionDeciderAgent` (expect failure)
6. [ ] Implement new `TreeActionDeciderAgent`
   - Orchestrates: text → placement → apply → optimization → final actions

Progress notes:

### Phase 3: Integration
1. [ ] Update `ChunkProcessor` to use new agent
2. [ ] Update E2E tests for two-step behavior

## Architecture Notes

- **Stateless agents**: Pure functions that propose actions
- **ID-only operations**: No fuzzy name matching in pipeline
- **Two-step flow**: Fast placement → Thoughtful optimization
- **Action types**: `TargetNodeIdentification` (append), `CreateAction` (new), `UpdateAction` (modify)
