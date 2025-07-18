# TreeActionDecider Orchestrator

## Overview
The TreeActionDecider is a simple orchestrator (NOT an Agent) that coordinates the two-step pipeline for processing voice transcripts into tree actions.

## Location
This should be implemented in: `backend/text_to_graph_pipeline/orchestration/tree_action_decider.py`

## Purpose
This orchestrator implements the new two-step pipeline:
1. **Fast Placement**: Use AppendToRelevantNodeAgent to quickly decide where content goes
2. **Thoughtful Optimization**: Use SingleAbstractionOptimizerAgent on modified nodes

## Implementation Requirements

### Class Structure
```python
class TreeActionDecider:
    """Orchestrates the two-step tree update pipeline"""
    
    def __init__(self):
        self.append_agent = AppendToRelevantNodeAgent()
        self.optimizer_agent = SingleAbstractionOptimizerAgent()
    
    async def run(
        self,
        transcript_text: str,
        decision_tree: DecisionTree,
        transcript_history: str = ""
    ) -> List[Union[UpdateAction, CreateAction]]:
        """Execute the complete two-step pipeline"""
```

### Pipeline Steps
1. **Get placement actions** from AppendToRelevantNodeAgent
   - Returns List[Union[AppendAction, CreateAction]]
   
2. **Apply placement actions** using TreeActionApplier
   - Returns set of modified node IDs
   
3. **Optimize each modified node** using SingleAbstractionOptimizerAgent
   - Returns List[Union[UpdateAction, CreateAction]]
   
4. **Return final optimization actions**
   - These are the actions that actually update the tree structure

### Key Design Decisions
- This is NOT a subclass of Agent - it's a simple orchestrator
- It returns only optimization actions (not placement actions)
- When no optimization is needed, it returns an empty list
- It tracks which nodes were modified to optimize only those

### Expected Behavior
- Simple atomic content → CREATE action → no optimization needed → empty list
- Complex append → APPEND action → node becomes overloaded → optimization actions returned
- Multiple segments → some APPEND, some CREATE → optimize each modified node