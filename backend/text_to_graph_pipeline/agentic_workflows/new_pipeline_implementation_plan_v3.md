# VoiceTree Pipeline Implementation Plan v3 (2025-07-18)

## Executive Summary

This updated plan addresses the critical blockers discovered during Phase 2 implementation. The AppendToRelevantNodeAgent is implemented but non-functional due to template rendering issues. This document provides specific debugging steps and implementation guidance to unblock progress.

## Current Status Overview

### Phase 1: ✅ COMPLETED
- All legacy code removed
- ID-based operations throughout
- Unified action model implemented
- Infrastructure tests passing

### Phase 2: 🚧 BLOCKED
- AppendToRelevantNodeAgent: Implemented but segmentation returns empty chunks
- SingleAbstractionOptimizerAgent: Not started
- TreeActionDeciderAgent: Not started

## Critical Blockers Analysis

### 🔴 Blocker 1: Template Rendering Mismatch
**Issue**: Prompts use `{{variable}}` syntax but agent.py might use `str.format()`
**Impact**: Segmentation prompt fails to render, causing empty LLM responses
**Root Cause Location**: `agent.py` lines 104-109

### 🔴 Blocker 2: Schema Registration Missing
**Issue**: `TargetNodeResponse` not in SCHEMA_MAP
**Impact**: LLM integration fails for identify_target_node stage
**Root Cause Location**: `llm_integration.py` line 33

### 🔴 Blocker 3: State Variable Mismatch
**Issue**: Initial state may not have all required variables for prompt rendering
**Impact**: Template rendering fails with KeyError
**Root Cause Location**: `append_to_relevant_node_agent.py` lines 95-101

## Immediate Action Plan

### Step 1: Debug Segmentation (HIGH PRIORITY)

#### 1.1 Add Debug Logging
```python
# In agent.py, modify the node_fn around line 106:
def make_node_fn(pname: str):
    async def node_fn(state: Dict[str, Any]) -> Dict[str, Any]:
        print(f"\n=== DEBUG {pname} ===")
        print(f"State keys: {list(state.keys())}")
        print(f"Template value: {self.prompts[pname][:50]}...")
        
        # Get the prompt template
        template = self.prompts[pname]
        
        # Check if this is a file reference or inline template
        if not template.strip().startswith('{') and '\n' not in template:
            print(f"Loading from file: prompts/{pname}.md")
            prompt = prompt_loader.render_template(pname, **state)
        else:
            print(f"Using inline template")
            prompt = template.format(**state)
        
        print(f"Rendered prompt (first 500 chars): {prompt[:500]}")
        print(f"=== END DEBUG {pname} ===\n")
```

#### 1.2 Fix Schema Registration
```python
# In llm_integration.py, update imports and SCHEMA_MAP:
from models import (
    SegmentationResponse, 
    RelationshipResponse,
    TargetNodeResponse,  # Add this import
    OptimizationResponse  # Add this import
)

SCHEMA_MAP = {
    "segmentation": SegmentationResponse,
    "relationship_analysis": RelationshipResponse,
    "identify_target_node": TargetNodeResponse,  # Add this
    "optimize": OptimizationResponse,  # Add this
}
```

#### 1.3 Verify State Variables
```python
# In append_to_relevant_node_agent.py, add validation:
async def run(self, transcript_text: str, decision_tree: DecisionTree, 
              transcript_history: str = "") -> List[Union[AppendAction, CreateAction]]:
    
    # Format nodes with proper structure
    existing_nodes = self._format_nodes_for_prompt(decision_tree)
    
    print(f"DEBUG: existing_nodes format: {existing_nodes[:200]}...")
    
    # Create initial state with all required fields
    initial_state: AppendToRelevantNodeAgentState = {
        "transcript_text": transcript_text,
        "transcript_history": transcript_history or "",  # Ensure never None
        "existing_nodes": existing_nodes,
        "segments": None,
        "target_nodes": None,
        "chunks": None  # Add this - segmentation expects to write here
    }
```

### Step 2: Test and Fix Segmentation

1. **Run Single Test with Debug**:
   ```bash
   pytest backend/tests/integration_tests/agentic_workflows/agents_and_prompts_tests/AppendToRelevantNodeAgent/testAppendtoRelevantNodeAgent.py::TestAppendToRelevantNodeAgent::test_simple_append -v -s
   ```

2. **Expected Debug Output**:
   - Should see prompt being loaded from file
   - Should see rendered prompt with actual values
   - Should see LLM response structure

3. **Common Fixes**:
   - If KeyError: Add missing variable to initial state
   - If empty response: Check prompt format matches LLM expectations
   - If schema error: Verify response matches SegmentationResponse model

### Step 3: Complete AppendToRelevantNodeAgent

Once segmentation works:

1. **Fix Data Flow**:
   - Ensure `chunks` field is properly set after segmentation
   - Verify transform function receives non-empty chunks
   - Check `segments` field is correctly formatted for identify_target

2. **Run All Tests**:
   ```bash
   pytest backend/tests/integration_tests/agentic_workflows/agents_and_prompts_tests/AppendToRelevantNodeAgent/ -v
   ```

3. **Document Any Adjustments**:
   - LLM-specific prompt tweaks
   - Response parsing edge cases
   - Performance observations

## Phase 2 Completion Plan

### SingleAbstractionOptimizerAgent Implementation

#### Test First (TDD)
```python
# Create test file: 
# backend/tests/integration_tests/agentic_workflows/agents_and_prompts_tests/SingleAbstractionOptimizerAgent/testSingleAbstractionOptimizerAgent.py

class TestSingleAbstractionOptimizerAgent:
    # Test cases:
    # 1. Node needs no optimization
    # 2. Node should be split (multiple concepts)
    # 3. Node needs summary update
    # 4. Complex refactoring scenario
```

#### Implementation
```python
class SingleAbstractionOptimizerAgent(Agent):
    def __init__(self):
        super().__init__("SingleAbstractionOptimizerAgent", 
                         SingleAbstractionOptimizerAgentState)
        self._setup_workflow()
    
    def _setup_workflow(self):
        self.add_prompt(
            "optimize",
            "single_abstraction_optimizer",
            OptimizationResponse
        )
        self.add_dataflow("optimize", END)
    
    async def run(self, node_id: int, decision_tree: DecisionTree) -> List[BaseTreeAction]:
        # Get node and neighbors
        # Format for prompt
        # Call LLM
        # Return actions
```

### TreeActionDeciderAgent Implementation

#### Key Design Points
- Pure Python orchestration (no LangGraph)
- Coordinates two sub-agents
- Tracks modified nodes
- Returns optimization actions only

#### Implementation
```python
class TreeActionDeciderAgent:
    def __init__(self):
        self.append_agent = AppendToRelevantNodeAgent()
        self.optimizer_agent = SingleAbstractionOptimizerAgent()
    
    async def run(self, transcript_text: str, decision_tree: DecisionTree) -> List[BaseTreeAction]:
        # 1. Get placement actions
        placement_actions = await self.append_agent.run(...)
        
        # 2. Apply placement
        applier = TreeActionApplier(decision_tree)
        modified_node_ids = applier.apply(placement_actions)
        
        # 3. Optimize each modified node
        optimization_actions = []
        for node_id in modified_node_ids:
            actions = await self.optimizer_agent.run(node_id, decision_tree)
            optimization_actions.extend(actions)
        
        return optimization_actions
```

## Phase 3: Integration

1. Update ChunkProcessor to use TreeActionDeciderAgent
2. Update E2E tests for two-step behavior
3. Remove legacy agent references
4. Performance optimization

## Success Metrics

- [ ] All AppendToRelevantNodeAgent tests pass
- [ ] All SingleAbstractionOptimizerAgent tests pass  
- [ ] TreeActionDeciderAgent orchestration works correctly
- [ ] E2E pipeline test passes
- [ ] No legacy code remains

## Risk Mitigation

1. **If LLM responses are inconsistent**: Add retry logic with temperature adjustment
2. **If performance is slow**: Consider caching neighbor lookups
3. **If memory usage is high**: Implement streaming for large trees

## Timeline Estimate

- Debug segmentation: 2-4 hours
- Complete AppendToRelevantNodeAgent: 2 hours
- Implement SingleAbstractionOptimizerAgent: 4 hours
- Implement TreeActionDeciderAgent: 2 hours
- Integration and testing: 4 hours

**Total: 14-16 hours of focused work**

## Next Immediate Actions

1. Add debug logging to agent.py
2. Fix SCHEMA_MAP in llm_integration.py
3. Run test_simple_append with debug output
4. Fix issues based on debug findings
5. Proceed with remaining implementation

---

**Note**: This plan supersedes all previous versions. Focus on unblocking the segmentation issue first, as it's the critical path blocker.