# VoiceTree New Pipeline Implementation Plan

## Overview
Transition from current 3-stage pipeline to new 4-stage pipeline with optimization focus.

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

### Phase 3: Agents
Note: renaming TreeActionDeciderAgent to AppendToRelevantNodeAgent.
The combination of AppendToRelevantNodeAgent and SingleAbstractionOptimizerAgent will be called TreeActionDeciderAgent.

0. Live behavioural test for SingleAbstractionOptimizerAgent, backend/tests/integration_tests/agentic_workflows/SingleAbstractionOptimizerAgent/testSingleAbstractionOptimizerAgent.py (this may be the same as the test you did in phase 2 for the prompt, since this agent should ideally just be a single prompt)
0. Live behavioural test for AppendToRelevantNodeAgent, backend/tests/integration_tests/agentic_workflows/AppendToRelevantNodeAgent/testAppendtoRelevantNodeAgent.py
0. Live behavioural test for TreeActionDeciderAgent, backend/tests/integration_tests/agentic_workflows/tree_action_decider/test_tree_action_decider.py

1. Create SingleAbstractionOptimizerAgent
2. Refactor TreeActionDeciderAgent:
   - Remove integration_decision stage
   - Add identify_target + optimization stages
   - Track modified nodes between stages

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