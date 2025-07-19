# Conditional Routing Problem in Agentic Workflows

## The Problem

The `AppendToRelevantNodeAgent` workflow has two stages:
1. **Segmentation**: Breaks transcript into segments and marks them as complete/incomplete
2. **Target Node Identification**: For each complete segment, identifies where to place it in the tree

When a transcript chunk contains only incomplete segments (e.g., sentences cut off mid-thought), we want to skip the target node identification stage entirely to avoid unnecessary LLM calls.

Currently, the workflow architecture doesn't support conditional routing between stages. The workflow always proceeds linearly through all defined stages, even when intermediate transforms set empty data.

### Current Flow
```
segmentation → transform → identify_target_node → END
                    ↓
              (sets segments=[])
                    ↓
              (still proceeds to next stage)
```

### Desired Flow
```
segmentation → transform → [if segments empty] → END
                    ↓
              [if segments not empty]
                    ↓
            identify_target_node → END
```

## The Hacky Solution (Currently Implemented)

Modified `Agent.compile()` to add a hardcoded special case:

```python
# In agent.py compile method
if from_prompt == "segmentation" and to_prompt == "identify_target_node":
    # Add conditional edge based on whether segments is empty
    def route_segments(state: Dict[str, Any]) -> str:
        segments = state.get("segments", [])
        return "identify_target_node" if segments else END
    
    graph.add_conditional_edges(
        transformer_name,
        route_segments,
        {
            "identify_target_node": to_prompt,
            END: END
        }
    )
```

### Why This is Bad
1. **Breaks Abstraction**: The Agent class now has knowledge of specific workflow implementations
2. **Not Scalable**: Every conditional routing need requires modifying the core Agent class
3. **Tight Coupling**: Creates dependencies between the framework and specific agents
4. **Maintenance Nightmare**: As more agents need conditional logic, this approach becomes unmaintainable

## Clean Architectural Approaches

### 1. Conditional Edges as First-Class Citizens

Add proper API support for conditional routing in the Agent class:

```python
class Agent:
    def add_conditional_dataflow(
        self, 
        from_prompt: str, 
        routing_fn: Callable[[Dict], str],
        routes: Dict[str, str],
        transform: Optional[Callable] = None
    ):
        """Add a conditional edge that routes based on state"""
        self.conditional_dataflows.append({
            "from": from_prompt,
            "routing_fn": routing_fn,
            "routes": routes,
            "transform": transform
        })
```

Usage:
```python
def should_identify_targets(state):
    return "identify" if state.get("segments") else "skip"

self.add_conditional_dataflow(
    "segmentation",
    should_identify_targets,
    {
        "identify": "identify_target_node",
        "skip": END
    },
    transform=self._prepare_for_target_identification
)
```

### 2. Optional Nodes with Conditions

Allow nodes to be marked as optional with execution conditions:

```python
self.add_prompt(
    "identify_target_node", 
    TargetNodeResponse,
    optional=True,
    condition=lambda state: bool(state.get("segments"))
)
```

### 3. Transform Functions with Routing Decisions

Allow transforms to return routing decisions along with state:

```python
def _prepare_for_target_identification(self, state: Dict[str, Any]) -> Tuple[Dict[str, Any], Optional[str]]:
    # ... transform logic ...
    if not complete_segments:
        return transformed_state, "END"  # Skip to end
    return transformed_state, None  # Continue normally
```

### 4. Early Exit Mechanism

Add a special state key that signals workflow termination:

```python
def _prepare_for_target_identification(self, state: Dict[str, Any]) -> Dict[str, Any]:
    # ... transform logic ...
    if not complete_segments:
        return {
            **state,
            "_workflow_action": "terminate",
            "segments": [],
            "target_nodes": []
        }
    return transformed_state
```

### 5. Declarative Workflow Definition

Move to a more declarative approach where the entire workflow is defined upfront:

```python
workflow_config = {
    "nodes": [
        {"name": "segmentation", "prompt": "segmentation.md", "output": SegmentationResponse},
        {"name": "identify_target_node", "prompt": "identify_target_node.md", "output": TargetNodeResponse}
    ],
    "edges": [
        {
            "from": "segmentation",
            "to": "identify_target_node",
            "transform": "_prepare_for_target_identification",
            "condition": "has_complete_segments"
        }
    ],
    "conditions": {
        "has_complete_segments": lambda state: bool(state.get("segments"))
    }
}

agent = Agent.from_config("AppendToRelevantNode", workflow_config)
```

## Recommendation

The cleanest approach would be **Option 1: Conditional Edges as First-Class Citizens**. This:
- Maintains clean separation of concerns
- Provides a general solution for all conditional routing needs
- Doesn't require changing the transform function signature
- Aligns with LangGraph's existing conditional edge support
- Is explicit and easy to understand

This would involve:
1. Adding `add_conditional_dataflow` method to the Agent class
2. Updating the compile method to handle conditional dataflows
3. Migrating the hacky solution to use the new API
4. Documenting the pattern for other agents to follow

The implementation would be straightforward and would remove the need for any special-case logic in the framework.