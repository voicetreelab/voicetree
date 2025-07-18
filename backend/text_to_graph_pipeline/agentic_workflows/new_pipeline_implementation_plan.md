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

### Phase 3: Agents

#### What Needs to Be Done
1. **Create SingleAbstractionOptimizerAgent** (new file)
   - Single prompt agent using `single_abstraction_optimizer.md`
   - Input: node_id, node content/summary, neighbors
   - Output: `OptimizationResponse` with list of actions

2. **Rename & Refactor Current Agent**
   - Copy `tree_action_decider_agent.py` → `append_to_relevant_node_agent.py`
   - Remove `integration_decision` stage
   - Replace `relationship_analysis` → `identify_target` (using new prompt)
   - Output modified node IDs after append stage

3. **Create New TreeActionDeciderAgent** (wrapper)
   - Runs AppendToRelevantNodeAgent first
   - Takes modified node IDs and runs SingleAbstractionOptimizerAgent on each
   - Combines all actions and applies via TreeActionApplier

#### State Management Between Stages
```python
# Stage 3 output needs to include:
state["modified_node_ids"] = [1, 5, 7]  # IDs of nodes that had content appended

# Stage 4 processes each:
for node_id in state["modified_node_ids"]:
    # Run optimizer on this node
```

### Phase 4: Integration
0. Integration test, update our existing integration test backend/tests/integration_tests/chunk_processing_pipeline/test_pipeline_e2e_with_di.py, this is our E2E test for our system with the agent part (TreeActionDeciderAgent) mocked. 
1. Update workflow adapter
2. Add tests for new actions
3. Run benchmarker

## Key Design Decisions

- UPDATE replaces entire node content/summary
- SPLIT is not a separate action - it's UPDATE + CREATE actions
- Optimizer can return multiple actions (list) to handle complex operations
- Optimization uses immediate neighbors only (for now)
- Modified nodes tracked at node ID level

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
4. **Node Resolution**: Always convert node names to IDs before passing to TreeActionApplier