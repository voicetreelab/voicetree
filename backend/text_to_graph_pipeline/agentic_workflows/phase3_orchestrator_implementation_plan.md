# Phase 3: TreeActionDecider Orchestrator Implementation Plan

## Overview

This document contains the detailed implementation plan for the TreeActionDecider orchestrator and integration with the existing chunk processing pipeline.

## Current State

- ✅ AppendToRelevantNodeAgent: Complete and tested
- ✅ SingleAbstractionOptimizerAgent: Complete (90%, minor state issue to resolve)
- ✅ TreeActionDecider tests: Written and failing as expected
- ❌ TreeActionDecider implementation: Not started
- ❌ Integration with ChunkProcessor: Not started

## Implementation Steps

### Step 1: Create TreeActionDecider Orchestrator (2 hours)

#### 1.1 Create Directory Structure
```bash
mkdir -p backend/text_to_graph_pipeline/orchestration
touch backend/text_to_graph_pipeline/orchestration/__init__.py
touch backend/text_to_graph_pipeline/orchestration/tree_action_decider.py
```

#### 1.2 Implement TreeActionDecider Class

```python
# backend/text_to_graph_pipeline/orchestration/tree_action_decider.py

from typing import List, Set, Union
from ..agentic_workflows.agents.append_to_relevant_node_agent import AppendToRelevantNodeAgent
from ..agentic_workflows.agents.single_abstraction_optimizer_agent import SingleAbstractionOptimizerAgent
from ..chunk_processing_pipeline.apply_tree_actions import TreeActionApplier
from ..agentic_workflows.models import UpdateAction, CreateAction, BaseTreeAction
from ..tree_manager.decision_tree_ds import DecisionTree

class TreeActionDecider:
    """
    Orchestrates the two-step tree update pipeline.
    NOT an agent - pure deterministic coordination.
    """
    
    def __init__(self):
        self.append_agent = AppendToRelevantNodeAgent()
        self.optimizer_agent = SingleAbstractionOptimizerAgent()
    
    async def run(
        self,
        transcript_text: str,
        decision_tree: DecisionTree,
        transcript_history: str = ""
    ) -> List[Union[UpdateAction, CreateAction]]:
        """
        Execute the two-step pipeline:
        1. Fast placement via AppendToRelevantNodeAgent
        2. Thoughtful optimization via SingleAbstractionOptimizerAgent
        
        Returns only optimization actions (placement actions are internal).
        """
        # Step 1: Get placement actions
        placement_actions = await self.append_agent.run(
            transcript_text=transcript_text,
            decision_tree=decision_tree,
            transcript_history=transcript_history
        )
        
        # Step 2: Apply placement actions internally
        applier = TreeActionApplier(decision_tree)
        modified_node_ids = applier.apply(placement_actions)
        
        # Step 3: Optimize each modified node
        optimization_actions = []
        for node_id in modified_node_ids:
            actions = await self.optimizer_agent.run(
                node_id=node_id,
                decision_tree=decision_tree
            )
            optimization_actions.extend(actions)
        
        return optimization_actions
```

#### 1.3 Key Implementation Details

1. **No Agent Inheritance**: TreeActionDecider is a plain class, not an Agent subclass
2. **Internal TreeActionApplier**: Creates its own instance for applying placement actions
3. **Track Modified Nodes**: Captures which nodes were touched by placement
4. **Return Only Optimization**: Placement actions stay internal

### Step 2: Update WorkflowAdapter (1 hour)

#### 2.1 Update Imports

```python
# backend/text_to_graph_pipeline/chunk_processing_pipeline/workflow_adapter.py

# FROM:
from backend.text_to_graph_pipeline.agentic_workflows.agents.tree_action_decider_agent import TreeActionDeciderAgent

# TO:
from backend.text_to_graph_pipeline.orchestration.tree_action_decider import TreeActionDecider
```

#### 2.2 Update process_full_buffer Method

```python
async def process_full_buffer(self, transcript: str, context: Optional[str] = None) -> WorkflowResult:
    try:
        # Call the orchestrator
        optimization_actions = await self.agent.run(
            transcript_text=transcript,
            decision_tree=self.decision_tree,
            transcript_history=context or ""
        )
        
        # Track new nodes from CREATE actions
        new_nodes = []
        for action in optimization_actions:
            if isinstance(action, CreateAction) and action.new_node_name:
                new_nodes.append(action.new_node_name)
        
        return WorkflowResult(
            success=True,
            new_nodes=new_nodes,
            tree_actions=optimization_actions,  # Only optimization actions
            metadata={
                "processed_text": transcript,
                "actions_generated": len(optimization_actions),
                "completed_chunks": [transcript]  # For buffer management
            }
        )
    except Exception as e:
        return WorkflowResult(
            success=False,
            new_nodes=[],
            tree_actions=[],
            error_message=f"Workflow execution failed: {str(e)}"
        )
```

### Step 3: Update ChunkProcessor (30 minutes)

#### 3.1 Fix Action Application

```python
# backend/text_to_graph_pipeline/chunk_processing_pipeline/chunk_processor.py

# In _process_text_chunk method, change:
# FROM:
updated_nodes = self.tree_action_applier.apply_integration_decisions(result.integration_decisions)

# TO:
updated_nodes = self.tree_action_applier.apply(result.tree_actions)
```

#### 3.2 Remove Legacy References

- Remove any references to "integration_decisions"
- Update variable names to reflect "tree_actions"

### Step 4: Run Tests & Debug (1-2 hours)

#### 4.1 Test Execution Order

1. Run TreeActionDecider unit tests:
   ```bash
   pytest backend/tests/integration_tests/agentic_workflows/agents_and_prompts_tests/tree_action_decider/test_tree_action_decider.py -xvs
   ```

2. Run integration tests:
   ```bash
   pytest backend/tests/integration_tests/agentic_workflows -xvs
   ```

3. Run E2E tests:
   ```bash
   pytest backend/tests/e2e -xvs
   ```

#### 4.2 Expected Issues & Solutions

| Issue | Solution |
|-------|----------|
| Import errors | Update all imports to use new orchestrator path |
| State field mismatch | Ensure WorkflowResult matches expected format |
| Empty optimization actions | This is correct for simple content |
| Buffer management | Ensure completed_chunks is populated |

### Step 5: Cleanup (30 minutes)

#### 5.1 Remove Old Code

1. Delete `backend/text_to_graph_pipeline/agentic_workflows/agents/tree_action_decider_agent.py`
2. Remove old imports from `__init__.py` files
3. Update any documentation references

#### 5.2 Update Documentation

1. Update README files
2. Update inline documentation
3. Update API documentation if applicable

## Testing Strategy

### Unit Tests
- TreeActionDecider orchestration logic
- Placement action application
- Optimization action aggregation

### Integration Tests
- Full pipeline flow with real LLMs
- Edge cases (empty tree, complex content)
- Error handling

### E2E Tests
- Voice input → Markdown output
- Multiple chunks processing
- Buffer management

## Success Criteria

1. All TreeActionDecider tests pass
2. Integration tests pass without modification
3. E2E tests show correct two-step behavior
4. No regression in existing functionality
5. Clean separation between orchestration and agents

## Risk Mitigation

1. **SingleAbstractionOptimizerAgent state issue**
   - Complete the fix before starting orchestrator
   - Have fallback to return empty list if optimization fails

2. **Integration complexity**
   - Keep old agent available as fallback during transition
   - Test each component in isolation first

3. **Performance concerns**
   - Monitor execution time for two-step vs old pipeline
   - Consider parallel optimization if needed

## Timeline

- **Day 1**: Implement TreeActionDecider (2 hrs)
- **Day 1**: Update WorkflowAdapter (1 hr)
- **Day 1**: Update ChunkProcessor & test (2 hrs)
- **Day 2**: Debug and cleanup (1 hr)

Total: 6 hours of focused work