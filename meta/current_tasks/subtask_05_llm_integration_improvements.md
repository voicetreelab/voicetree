# Subtask: LLM Integration Improvements and Migration

## Overview
Multiple LLM-related improvements are needed, including migrating to LangGraph, implementing parent node rewriting, and updating prompts. These improvements will enhance the quality of tree generation and optimization.

## Current State Analysis

### Components Requiring Updates
1. **Background Rewrite System**
   - File: `backend/tree_manager/LLM_engine/background_rewrite.py:52`
   - TODO: "migrate to LangGraph"
   - Current: Using older implementation pattern

2. **Parent Node Rewriting**
   - File: `backend/tree_manager/enhanced_workflow_tree_manager.py:164-165`
   - TODO: "also rewrite parent node using LLM, and potentially rename"
   - Status: Feature not implemented

3. **Prompt Updates**
   - File: `backend/tree_manager/LLM_engine/prompts/prompt_utils.py:21`
   - TODO: "Update this"
   - Status: Prompts need optimization

### Current LLM Usage
- Direct Gemini API calls
- No standardized prompt management
- Limited error handling
- No cost tracking

## Implementation Plan

### Phase 1: LangGraph Migration Setup (Day 1-2)
- [ ] Install and configure LangGraph
- [ ] Create base LangGraph workflow structure
- [ ] Design state management for LLM operations
- [ ] Set up error handling and retries

### Phase 2: Migrate Background Rewrite (Day 3-4)
- [ ] Convert background_rewrite.py to LangGraph
- [ ] Implement proper state management
- [ ] Add cost tracking
- [ ] Improve error handling

### Phase 3: Parent Node Rewriting (Day 5-6)
- [ ] Design parent node rewriting logic
- [ ] Implement LLM prompts for rewriting
- [ ] Add node renaming capability
- [ ] Integrate with tree update flow

### Phase 4: Prompt Optimization (Day 7)
- [ ] Audit all existing prompts
- [ ] Optimize for clarity and performance
- [ ] Add prompt versioning
- [ ] Create prompt testing framework

## Technical Approach

### LangGraph Base Structure
```python
from langgraph.graph import StateGraph, State
from langgraph.prebuilt import ToolExecutor
from typing import TypedDict, Annotated, Sequence
import operator

class LLMState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], operator.add]
    tree_context: Dict[str, Any]
    cost_tracker: Dict[str, float]
    error_count: int

class BaseLLMWorkflow:
    def __init__(self, llm, max_retries=3):
        self.llm = llm
        self.max_retries = max_retries
        self.workflow = self._build_workflow()
    
    def _build_workflow(self):
        workflow = StateGraph(LLMState)
        
        # Add error handling
        workflow.add_node("process", self._process_with_retry)
        workflow.add_node("handle_error", self._handle_error)
        
        # Conditional edge based on success
        workflow.add_conditional_edges(
            "process",
            self._check_success,
            {
                "success": END,
                "error": "handle_error"
            }
        )
        
        workflow.set_entry_point("process")
        return workflow.compile()
```

### Background Rewrite Migration
```python
from langgraph.graph import StateGraph
from typing import TypedDict, Optional

class RewriteState(TypedDict):
    node_id: str
    original_content: str
    rewritten_content: Optional[str]
    parent_node: Optional[Dict]
    improvement_score: float
    cost: float

class BackgroundRewriteWorkflow:
    def __init__(self, llm):
        self.llm = llm
        self.workflow = self._build_workflow()
    
    def _build_workflow(self):
        workflow = StateGraph(RewriteState)
        
        # Workflow nodes
        workflow.add_node("analyze_node", self.analyze_node_quality)
        workflow.add_node("generate_rewrite", self.generate_improved_content)
        workflow.add_node("validate_improvement", self.validate_improvement)
        workflow.add_node("update_parent", self.rewrite_parent_node)
        workflow.add_node("apply_changes", self.apply_changes_to_tree)
        
        # Workflow edges
        workflow.add_edge("analyze_node", "generate_rewrite")
        workflow.add_edge("generate_rewrite", "validate_improvement")
        
        # Conditional edge for parent rewriting
        workflow.add_conditional_edges(
            "validate_improvement",
            self._should_rewrite_parent,
            {
                "yes": "update_parent",
                "no": "apply_changes"
            }
        )
        
        workflow.add_edge("update_parent", "apply_changes")
        
        workflow.set_entry_point("analyze_node")
        workflow.set_finish_point("apply_changes")
        
        return workflow.compile()
```

### Parent Node Rewriting Implementation
```python
class ParentNodeRewriter:
    def __init__(self, llm):
        self.llm = llm
    
    async def rewrite_parent_node(self, state: RewriteState) -> RewriteState:
        """Rewrite parent node based on child changes"""
        
        parent = state["parent_node"]
        if not parent:
            return state
        
        prompt = f"""
        A child node has been rewritten. Update the parent node to reflect this change.
        
        Parent Node:
        Name: {parent['name']}
        Content: {parent['content']}
        
        Updated Child:
        Original: {state['original_content']}
        New: {state['rewritten_content']}
        
        Rewrite the parent node to:
        1. Better summarize the updated child content
        2. Maintain consistency with other children
        3. Improve clarity and organization
        
        Also suggest a better name if appropriate.
        """
        
        response = await self.llm.agenerate([prompt])
        
        # Parse response for new content and name
        state["parent_rewrite"] = self._parse_parent_rewrite(response)
        
        return state
    
    def _parse_parent_rewrite(self, response):
        # Extract new content and potential new name
        return {
            "new_content": extracted_content,
            "new_name": extracted_name,
            "rationale": extracted_rationale
        }
```

### Prompt Management System
```python
from enum import Enum
from typing import Dict, Any
import json

class PromptType(Enum):
    NODE_ANALYSIS = "node_analysis"
    NODE_REWRITE = "node_rewrite"
    PARENT_UPDATE = "parent_update"
    TREE_REORGANIZATION = "tree_reorganization"

class PromptManager:
    def __init__(self, version="v1"):
        self.version = version
        self.prompts = self._load_prompts()
    
    def _load_prompts(self) -> Dict[PromptType, str]:
        # Load from versioned prompt files
        with open(f"prompts/{self.version}/prompts.json") as f:
            return json.load(f)
    
    def get_prompt(self, prompt_type: PromptType, **kwargs) -> str:
        template = self.prompts[prompt_type.value]
        return template.format(**kwargs)
    
    def optimize_prompt(self, prompt_type: PromptType, performance_data: Dict):
        """Use performance data to improve prompts"""
        # Analyze which prompts lead to better outcomes
        # Update prompt templates based on analysis
        pass
```

### Cost Tracking Integration
```python
class CostTracker:
    def __init__(self):
        self.costs = {
            "input_tokens": 0,
            "output_tokens": 0,
            "total_cost": 0.0
        }
    
    def track_llm_call(self, input_text: str, output_text: str, model: str):
        input_tokens = self._count_tokens(input_text)
        output_tokens = self._count_tokens(output_text)
        
        # Gemini pricing (example)
        input_cost = input_tokens * 0.000125  # $0.125 per million
        output_cost = output_tokens * 0.000375  # $0.375 per million
        
        self.costs["input_tokens"] += input_tokens
        self.costs["output_tokens"] += output_tokens
        self.costs["total_cost"] += (input_cost + output_cost)
        
        return {
            "call_cost": input_cost + output_cost,
            "total_cost": self.costs["total_cost"]
        }
```

## Complexities and Risks

### Technical Complexities
1. **LangGraph Learning Curve**
   - New framework requires learning
   - Different patterns than direct API calls
   - State management complexity

2. **Prompt Engineering**
   - Balancing quality vs cost
   - Handling edge cases
   - Maintaining consistency

3. **Parent-Child Relationships**
   - Maintaining tree integrity
   - Cascading updates
   - Circular dependencies

### Operational Risks
1. **Cost Explosion**: Uncontrolled LLM calls
2. **Quality Regression**: Poor prompts reducing quality
3. **Performance**: Slower than direct API calls
4. **Debugging**: Complex workflows harder to debug

### Mitigation Strategies
1. **Gradual Migration**: Move one component at a time
2. **Cost Limits**: Implement hard limits on API calls
3. **A/B Testing**: Compare old vs new implementations
4. **Comprehensive Logging**: Track all LLM interactions

## Testing Strategy

### Unit Tests
```python
def test_parent_rewriting():
    # Test with mock LLM
    mock_llm = MockLLM(responses={...})
    rewriter = ParentNodeRewriter(mock_llm)
    
    state = {
        "parent_node": {"name": "Old Parent", "content": "..."},
        "rewritten_content": "New child content"
    }
    
    result = rewriter.rewrite_parent_node(state)
    assert "parent_rewrite" in result
    assert result["parent_rewrite"]["new_name"] != "Old Parent"
```

### Integration Tests
```python
def test_full_rewrite_workflow():
    # Test complete workflow
    workflow = BackgroundRewriteWorkflow(llm)
    tree = create_test_tree()
    
    result = workflow.process_tree(tree)
    
    # Verify improvements
    assert measure_tree_quality(result) > measure_tree_quality(tree)
    assert result.cost < MAX_COST_THRESHOLD
```

### Prompt Testing
```python
def test_prompt_effectiveness():
    # Test different prompt versions
    prompts = ["v1", "v2", "v3"]
    results = []
    
    for version in prompts:
        manager = PromptManager(version)
        quality = test_prompt_quality(manager)
        results.append((version, quality))
    
    # Select best performing version
    best_version = max(results, key=lambda x: x[1])
```

## Success Criteria

1. **Migration Success**
   - All LLM calls using LangGraph
   - No regression in functionality
   - Improved error handling

2. **Feature Completeness**
   - Parent node rewriting works reliably
   - Prompts produce better results
   - Cost tracking accurate

3. **Quality Improvements**
   - 20% improvement in tree quality scores
   - Reduced LLM costs through better prompts
   - Faster processing through optimized workflows

4. **Developer Experience**
   - Clear debugging capabilities
   - Easy to add new LLM features
   - Comprehensive documentation

## Dependencies
- LangGraph installation
- Updated Gemini API setup
- Tree reorganization agent (for integration)

## Rollback Plan
1. Keep old implementation behind feature flag
2. Ability to switch between old/new per request
3. Gradual rollout with monitoring

## Notes
- LangGraph provides better structure for complex LLM workflows
- Parent node rewriting is critical for tree quality
- Prompt optimization can significantly reduce costs
- Consider implementing prompt caching for repeated patterns