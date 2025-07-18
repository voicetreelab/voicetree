# VoiceTree New Pipeline Implementation Plan

## Overview
Transition from current 3-stage pipeline to new 4-stage pipeline with optimization focus.

## Context for Next Engineer (Phase 3-4)

### What's Already Built
- **Infrastructure**: DecisionTree methods (`get_neighbors`, `update_node`) and TreeActionApplier (`apply_optimization_actions`, `apply_mixed_actions`) 
- **Models**: `UpdateAction`, `CreateAction`, `OptimizationDecision` returning list of actions
- **Prompts**: All 3 prompts created and tested (`segmentation.md`, `identify_target_node.md`, `single_abstraction_optimizer.md`)

### Agent Architecture Pattern
This codebase uses a specific LangGraph pattern (see `backend/text_to_graph_pipeline/agentic_workflows/core/agent.py`):
- Agents inherit from base `Agent` class
- Use `add_prompt()` to register prompts with structured output models
- Use `add_dataflow()` to define pipeline flow
- Prompts auto-load from `prompts/` directory

### Critical Implementation Notes
1. **Node Name Resolution**: The optimizer outputs node names, but TreeActionApplier needs IDs. Use `decision_tree.get_node_id_from_name()`
2. **Modified Node Tracking**: Stage 3 must output node IDs that were modified for Stage 4 to process
3. **SPLIT = UPDATE + CREATE**: Never a separate action. Optimizer returns list: `[UpdateAction(parent), CreateAction(child1), CreateAction(child2), ...]`
4. **Current Agent Rename**: Existing `TreeActionDeciderAgent` becomes `AppendToRelevantNodeAgent` (stages 1-3 only)

## Pipeline Stages

### Stage 1: Segmentation (Modified)
- Remove title generation from chunks
- Keep atomic idea extraction and completeness detection
- Output: segments without names

### Stage 2: Identify Target Node (New)
- For each segment, find most relevant existing node
- If no relevant node, create hypothetical node name immediately
- Output: segment → target node mapping

### Stage 3: Append Content
- Append each segment to its identified target node
- Track which nodes were modified
- Output: list of modified node IDs

### Stage 4: Single Abstraction Optimization (New)
- For each modified node:
  - Input: node content, summary, immediate neighbors (summaries only)
  - Apply optimization techniques from VoiceTree_Math.md
  - Output: UPDATE or SPLIT actions

## New Tree Actions

### UPDATE Action
```python
class UpdateAction:
    action: Literal["UPDATE"] 
    node_id: int
    new_content: str
    new_summary: str
```

### SPLIT Implementation
SPLIT is not a separate action type. It's implemented as:
1. UPDATE the original node to contain only parent content
2. CREATE new child nodes

The optimizer returns a list of actions that can include multiple CREATE and UPDATE actions to achieve the split.

## Implementation Steps
We will be following TDD for this project. A slightly different take on TDD where initially we just want a high level test, that doesn't go into any detail, just tests input -> expected output (behaviour) at whatever level of abstraction we are working on (method, module, prompt, agent, etc.)

### Phase 1: Core Infrastructure

0. Write high level behavioural tests for get_neighbours & update_node, focused on outcomme/behaviours not implementation details. 

1. Add UPDATE/SPLIT to models.py
2. Implement DecisionTree methods:
   - `get_neighbors(node_id) -> List[NodeSummary]`
   - `update_node(node_id, content, summary)`
   - Handle SPLIT in TreeActionApplier (create nodes first, then relationships)

Progress notes:
- Commit 4c20a15: Added behavioral tests for get_neighbors() and update_node() methods in test_decision_tree_ds.py
- Commit 4c20a15: Added new tree action models (UPDATE, SPLIT) and pipeline stage models to models.py
- Commit 4c20a15: Removed name field from ChunkModel to align with new segmentation approach
- Commit 74a98ff: Implemented get_neighbors() and update_node() methods in DecisionTree class (delegated to sub-agent)

### Phase 2: Prompts
0. Create input/fuzzy(output) test cases for the each of the prompts:
see backend/tests/integration_tests/agentic_workflows/SingleAbstractionOptimizerAgent/testSingleAbstractionOptimizerAgent.py
0. Segmentation prompt test can be skipped for now since we know it works well and we aren't modifying it much
0. Identify target node, simple input/output test just for sanity check
Note these tests should actually call the LLM. 

1. Modify segmentation.md (remove name field)
2. Create identify_target_node.md (simplified relationship_analysis)
3. Create single_abstraction_optimizer.md (with techniques from math doc)

Progress notes:
- Commit e6b4db2: Created test cases for identify_target_node and single_abstraction_optimizer prompts
- Commit e6b4db2: Modified segmentation.md to remove name field (delegated to sub-agent)
- Commit e6b4db2: Created identify_target_node.md prompt (delegated to sub-agent)
- Commit e6b4db2: Created single_abstraction_optimizer.md incorporating VoiceTree_Math optimization techniques

### Phase 2.5: TreeActionApplier Updates
0. Write behavioral tests for TreeActionApplier UPDATE support
1. Update models to allow optimizer to return multiple actions (for SPLIT = UPDATE + CREATEs)
2. Implement UPDATE action support in TreeActionApplier

Progress notes:
- Commit e53411f: Fixed model mismatch - created CreateAction model for optimizer output
- Commit e53411f: Updated prompts and tests to use CreateAction instead of IntegrationDecision
- Commit e53411f: Wrote tests for TreeActionApplier UPDATE support (not passing yet)
- Commit 4865fa3: Implemented UPDATE action support in TreeActionApplier - all tests pass

### Phase 2.75: Critical Improvements (Added)

Based on issues identified in improvements.md, the following critical improvements were made before Phase 3:

#### 1. **Eliminated Name-to-ID Resolution Ambiguity**
**Problem**: The pipeline relied on fuzzy string matching to resolve node names to IDs, which was inherently unreliable and could lead to mis-routing of content.

**Solution Implemented**:
- Updated `TargetNodeIdentification` model to use `target_node_id` instead of `target_node_name`
- Modified `identify_target_node.md` prompt to work with node IDs directly
- Updated `IntegrationDecision` and `CreateAction` models to support ID-based fields
- Modified `TreeActionApplier` to use node IDs directly, with fallback for legacy name-based code

**Files Modified**:
- `models.py`: Added `target_node_id`, `parent_node_id` fields to relevant models
- `identify_target_node.md`: Updated prompt to output node IDs
- `apply_tree_actions.py`: Updated to prefer ID-based fields over name-based

**Tests Added**:
- `test_identify_target_node_v2.py`: Integration tests for ID-based prompt
- `test_tree_action_applier_with_ids.py`: Unit tests for ID-based action handling

#### 2. **Unified Action Model**
**Problem**: Multiple similar action models and methods (`apply_optimization_actions`, `apply_mixed_actions`) made the code convoluted.

**Solution Implemented**:
- Created `BaseTreeAction` base class
- Made `UpdateAction` and `CreateAction` inherit from `BaseTreeAction`
- Added unified `apply()` method to `TreeActionApplier` that handles all action types

**Files Modified**:
- `models.py`: Added `BaseTreeAction` base class
- `apply_tree_actions.py`: Added unified `apply()` method

**Tests Added**:
- `test_unified_action_model.py`: Tests for unified action handling

#### 3. **Summary Generation Cleanup** (In Progress)
**Problem**: The `append_content` method takes a summary argument, but summaries should only be generated by the optimizer after deciding final content.

**Work Started**:
- Created tests documenting desired behavior
- Identified that `Node.append_content` currently updates summary
- Plan: Remove summary parameter and update logic from append_content

**Challenges Encountered**:
1. **Complex Model Interdependencies**: Updating models to use IDs required careful coordination between prompt outputs, model definitions, and TreeActionApplier logic
2. **Backward Compatibility**: Had to maintain support for legacy name-based code while transitioning to ID-based approach
3. **Testing LLM Prompts**: Integration tests for prompts required handling JSON extraction from LLM responses

#### Phase 2.9: Pre-Flight Cleanup (Do This First)
Before building new agents, we must remove the "scaffolding" and "legacy code" that is confusing the current agent. This phase is about simplification.
Goal: Create a clean, unambiguous foundation for the new agents.
Remove Legacy Name-Based Logic:
Action: Go into apply_tree_actions.py. Delete any if/else logic that checks for target_node_name as a fallback to target_node_id. The system will now only support IDs. If an ID is missing, it's an error, not something to work around.
Action: Delete the decision_tree.get_node_id_from_name() method entirely. Its existence is a temptation for incorrect usage. User-facing search is a separate feature for later; it has no place in the agentic pipeline.
Why: This forces the entire pipeline to conform to the new, robust, ID-based standard and removes a major source of confusion.
Solidify the Unified apply_actions Method:
Action: In apply_tree_actions.py, deprecate and remove apply_optimization_actions and apply_mixed_actions. There should only be one public method: apply(actions: List[BaseTreeAction]).
Action: Remove the IntegrationDecision model from models.py. It's a legacy model from the old pipeline. The new AppendToRelevantNodeAgent will produce CreateAction and AppendAction (which we will define) directly.
Why: One entry point, one set of action models. This dramatically simplifies the TreeActionApplier and makes its usage obvious.
Create a Dedicated AppendAction:
Action: In models.py, create a new AppendAction(BaseTreeAction) model. It will contain action: Literal["APPEND"], target_node_id: int, and content: str.
Action: Update the TreeActionApplier.apply() method to handle this new AppendAction.
Why: This decouples the initial "append" step from the more complex "optimization" step. The first agent produces simple Append/Create actions, and the second agent produces Update/Create actions. Clear separation of concerns.

#### Phase 3: Building the Agents (TDD Approach)
Now, with a clean foundation, we can build the agents one by one, following the test outlines.
Step 3.1: Implement AppendToRelevantNodeAgent
Goal: A simple agent that takes text segments and outputs a list of [AppendAction | CreateAction].
Write the Test First:
File: backend/tests/integration_tests/agentic_workflows/AppendToRelevantNodeAgent/testAppendtoRelevantNodeAgent.py
Action: Implement the test cases from the test outline provided previously. The test will instantiate the agent, call its .run() method with a mock tree and input text, and assert that the output is the expected list of AppendAction or CreateAction objects. This test will fail initially.
Implement the Agent:
File: backend/text_to_graph_pipeline/agentic_workflows/agents/append_to_relevant_node_agent.py
Action: Create the new agent file. This agent will have a simple dataflow:
Call the segmentation.md prompt.
Call the identify_target_node.md prompt.
Transform the output: Loop through the TargetNodeResponse and create a list of AppendAction (if target_node_id is present) or CreateAction (if target_node_id is null) objects.
This agent does not modify the tree. It only outputs the plan to do so.
Step 3.2: Implement SingleAbstractionOptimizerAgent
Goal: An agent that takes a node_id and outputs a list of [UpdateAction | CreateAction] to refactor it.
Write the Test First:
File: backend/tests/integration_tests/agentic_workflows/SingleAbstractionOptimizerAgent/testSingleAbstractionOptimizerAgent.py
Action: Implement the test cases from the test outline. The test will instantiate the agent, call its .run() method with a mock tree and a node_id, and assert that the output is the expected list of refactoring actions. This test will fail initially.
Implement the Agent:
File: backend/text_to_graph_pipeline/agentic_workflows/agents/single_abstraction_optimizer_agent.py
Action: Create the new agent file. Its dataflow is very simple:
Take node_id as input.
Use the node_id to get the node's content and its neighbors from the DecisionTree.
Call the single_abstraction_optimizer.md prompt.
Return the resulting OptimizationResponse.
Step 3.3: Implement TreeActionDeciderAgent (The Wrapper)
Goal: A coordinator that runs the full pipeline logic.
Write the Test First:
File: backend/tests/integration_tests/agentic_workflows/tree_action_decider/test_tree_action_decider.py
Action: Implement the end-to-end test cases from the outline. This is the most important test. It will mock the DecisionTree and TreeActionApplier, then call the TreeActionDeciderAgent.run() method. It will assert that the final list of actions passed to the applier is correct.
Implement the Agent:
File: backend/text_to_graph_pipeline/agentic_workflows/agents/tree_action_decider_agent.py
Action: This agent orchestrates the entire flow:
It takes the raw text as input.
It runs the AppendToRelevantNodeAgent to get a list of initial Append/Create actions.
It applies these initial actions to the tree using TreeActionApplier. This updates the tree state.
It captures the modified_node_ids that the TreeActionApplier returns from this first step.
It then loops through modified_node_ids:
For each id, it runs the SingleAbstractionOptimizerAgent.
It collects all the resulting refactoring actions (Update/Create) into a final list.
It returns this final list of refactoring actions. (The application of these actions happens outside the agent, in the main ChunkProcessor.)

#### Phase 4: Final Integration
This phase connects the fully-functional TreeActionDeciderAgent to the rest of the system.
Update the ChunkProcessor:
Action: Modify chunk_processor.py to call the new TreeActionDeciderAgent.
Action: The ChunkProcessor will receive the final list of refactoring actions from the agent and use the TreeActionApplier to apply them to the tree.
Run the E2E Test:
Action: Update and run the E2E test file (test_pipeline_e2e_with_di.py). Since the agent's output is now a list of actions, the mock agent will need to be updated to produce this new format. This test will confirm the entire system, from text input to markdown file output, works correctly.
This revised plan is more direct, eliminates legacy traps, and provides a clear, step-by-step TDD path for the agent to follow, significantly reducing the chances of it getting stuck.

## Key Design Decisions

- UPDATE replaces entire node content/summary
- SPLIT is not a separate action - it's UPDATE + CREATE actions
- Optimizer can return multiple actions (list) to handle complex operations
- Optimization uses immediate neighbors only (for now)
- Modified nodes tracked at node ID level
- **NEW**: Agents work with node IDs, not names (eliminates fuzzy matching issues)
- **NEW**: All tree actions inherit from BaseTreeAction for unified handling
- **NEW**: Summary generation happens only in optimizer, not during append

## Quick Reference for Implementation

### Example Files to Study
- **Agent Pattern**: `backend/text_to_graph_pipeline/agentic_workflows/agents/tree_action_decider_agent.py`
- **State Definition**: `backend/text_to_graph_pipeline/agentic_workflows/core/state.py` 
- **Models**: `backend/text_to_graph_pipeline/agentic_workflows/models.py`
- **TreeActionApplier Usage**: `backend/text_to_graph_pipeline/chunk_processing_pipeline/chunk_processor.py`

### Key Methods You'll Use
```python
# Getting neighbors for optimizer
neighbors = decision_tree.get_neighbors(node_id)  # Returns List[Dict] with id, name, summary, relationship

# Applying optimizer actions
applier = TreeActionApplier(decision_tree)
updated_nodes = applier.apply_mixed_actions(actions)  # For UPDATE + CREATE combos
```

### Common Gotchas to Avoid
1. **State Updates**: The VoiceTreeState is a TypedDict - you must include ALL fields when updating
2. **Prompt Loading**: Prompts must be in `prompts/` directory with exact filename matching prompt name
3. **Model Validation**: OptimizationResponse expects `optimization_decision.actions` to be a list (can be empty)
4. **Node Resolution**: ~~Always convert node names to IDs before passing to TreeActionApplier~~ (FIXED: Now using IDs directly)
5. **LLM Response Parsing**: LLM may return JSON in code blocks - extract with regex
6. **Model Inheritance**: Pydantic models need explicit defaults for Optional fields
7. **Backward Compatibility**: New ID fields coexist with legacy name fields during transition