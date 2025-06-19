# Subtask: Implement Tree Reorganization Agent


WARNING, BAD TASK. A version of Tree Reorganization Agent exists at backend/agentic_workflows/agents/tree-reorginization-agent. The task actually should be to ensure that this is the version used and that references to the old version in tree_reorganization_agent.py` is removed from the codebase.

## Overview
Core functionality for automatic tree optimization is missing. The TODO states "Implement the actual agent logic" in `tree_reorganization_agent.py`. This agent should take a tree structure and historical text to produce an optimized tree that is more understandable, concise, and better represents the structure of ideas.

## Current State Analysis

### Problem Summary
- **File**: `backend/tree_reorganization_agent.py:15`
- **Status**: Skeleton implementation only
- **Purpose**: Automatically optimize tree structure for better organization
- **Input**: (tree_structure, historical_text)
- **Output**: optimized_tree_structure

### Related Components
1. **Enhanced Workflow Tree Manager**
   - Has TODO for LLM-based parent node rewriting
   - Suggests this feature is part of larger tree optimization strategy

2. **Background Rewrite System**
   - Currently exists but needs migration to LangGraph
   - Could be integrated with reorganization agent

3. **README-dev.md**
   - Mentions TROA (Tree Reorganization and Optimization Agent)
   - Indicates this produces "5/5 quality" compared to TADA's "2.5-3/5"

## Design Specification

### Agent Architecture
```
Input Processing → Tree Analysis → Optimization Strategy → Tree Transformation → Validation
```

### Core Capabilities
1. **Tree Analysis**
   - Identify redundant nodes
   - Find misplaced content
   - Detect poor hierarchical structure
   - Analyze node relationships

2. **Optimization Strategies**
   - Merge similar nodes
   - Split overly complex nodes
   - Reorganize hierarchy
   - Improve node naming
   - Balance tree depth

3. **Transformation Operations**
   - Move subtrees
   - Merge nodes
   - Split nodes
   - Rename nodes
   - Delete redundant nodes

## Implementation Plan

### Phase 1: Core Infrastructure (Day 1-2)
- [ ] Define agent state structure
- [ ] Implement tree analysis utilities
- [ ] Create optimization strategy framework
- [ ] Set up LangGraph workflow

### Phase 2: Analysis Components (Day 3-4)
- [ ] Implement redundancy detection
- [ ] Create hierarchy quality metrics
- [ ] Build content coherence analyzer
- [ ] Develop node relationship mapper

### Phase 3: Optimization Logic (Day 5-6)
- [ ] Implement merge strategy
- [ ] Create split strategy
- [ ] Build reorganization logic
- [ ] Develop naming improvement

### Phase 4: Integration & Testing (Day 7-8)
- [ ] Integrate with existing tree manager
- [ ] Add safety validations
- [ ] Create comprehensive tests
- [ ] Benchmark quality improvements

## Technical Approach

### Agent State Definition
```python
from typing import TypedDict, List, Dict, Any
from langgraph.graph import StateGraph

class TreeReorgState(TypedDict):
    tree: DecisionTree
    historical_text: str
    analysis_results: Dict[str, Any]
    optimization_plan: List[Dict[str, Any]]
    optimized_tree: DecisionTree
    quality_metrics: Dict[str, float]
```

### LangGraph Workflow
```python
from langgraph.graph import Graph, Node, Edge

class TreeReorganizationAgent:
    def __init__(self, llm):
        self.llm = llm
        self.workflow = self._build_workflow()
    
    def _build_workflow(self):
        workflow = StateGraph(TreeReorgState)
        
        # Add nodes
        workflow.add_node("analyze", self.analyze_tree)
        workflow.add_node("plan", self.create_optimization_plan)
        workflow.add_node("optimize", self.execute_optimization)
        workflow.add_node("validate", self.validate_results)
        
        # Add edges
        workflow.add_edge("analyze", "plan")
        workflow.add_edge("plan", "optimize")
        workflow.add_edge("optimize", "validate")
        
        # Set entry and exit
        workflow.set_entry_point("analyze")
        workflow.set_finish_point("validate")
        
        return workflow.compile()
```

### Analysis Components
```python
def analyze_tree(self, state: TreeReorgState) -> TreeReorgState:
    tree = state["tree"]
    
    analysis = {
        "redundancy_score": self._calculate_redundancy(tree),
        "hierarchy_quality": self._assess_hierarchy(tree),
        "content_distribution": self._analyze_content_distribution(tree),
        "naming_quality": self._evaluate_naming(tree),
        "relationship_map": self._map_relationships(tree)
    }
    
    state["analysis_results"] = analysis
    return state

def _calculate_redundancy(self, tree):
    # Use embeddings to find similar nodes
    # Identify potential merges
    pass

def _assess_hierarchy(self, tree):
    # Check tree balance
    # Identify overly deep or shallow areas
    # Find misplaced nodes
    pass
```

### Optimization Strategies
```python
class OptimizationStrategy:
    def __init__(self, llm):
        self.llm = llm
    
    def merge_similar_nodes(self, node1, node2):
        # LLM-powered content merging
        prompt = f"""
        Merge these two similar nodes into one coherent node:
        Node 1: {node1.name}
        Content: {node1.content}
        
        Node 2: {node2.name}
        Content: {node2.content}
        
        Create a merged node that preserves all important information.
        """
        return self.llm.generate(prompt)
    
    def split_complex_node(self, node):
        # LLM-powered node splitting
        prompt = f"""
        This node contains multiple concepts. Split it into separate nodes:
        Node: {node.name}
        Content: {node.content}
        
        Identify distinct concepts and create appropriate child nodes.
        """
        return self.llm.generate(prompt)
```

### Safety and Validation
```python
def validate_optimization(original_tree, optimized_tree, historical_text):
    validations = {
        "content_preserved": check_content_preservation(original_tree, optimized_tree),
        "structure_valid": validate_tree_structure(optimized_tree),
        "quality_improved": measure_quality_improvement(original_tree, optimized_tree),
        "text_alignment": check_historical_text_alignment(optimized_tree, historical_text)
    }
    
    if not all(validations.values()):
        raise ValidationError("Tree optimization failed validation")
    
    return validations
```

## Complexities and Risks

### Technical Complexities
1. **LLM Integration**
   - Prompt engineering for accurate analysis
   - Managing API costs
   - Handling LLM failures gracefully

2. **Tree Transformation**
   - Maintaining referential integrity
   - Preserving all content
   - Handling circular dependencies

3. **Quality Assessment**
   - Defining objective quality metrics
   - Balancing different optimization goals
   - Avoiding over-optimization

### Operational Risks
1. **Data Loss**: Must ensure no content is lost during reorganization
2. **Performance**: Large trees might take significant time to optimize
3. **Cost**: Multiple LLM calls could be expensive
4. **Stability**: Poor optimizations could make tree worse

### Mitigation Strategies
1. **Incremental Optimization**: Process subtrees independently
2. **Rollback Capability**: Keep original tree until validation passes
3. **Cost Controls**: Limit LLM calls per optimization
4. **Human Review**: Option for manual approval of changes

## Integration Points

### With Existing System
```python
# In enhanced_transcription_processor.py
def process_with_optimization(self, text):
    # TADA processing (real-time)
    initial_tree = self.tada_agent.process(text)
    
    # TROA processing (background)
    if self.enable_background_optimization:
        optimized_tree = self.troa_agent.optimize(initial_tree, text)
        return optimized_tree
    
    return initial_tree
```

### Configuration
```python
# settings.py
TREE_OPTIMIZATION_CONFIG = {
    "enable_background_optimization": True,
    "optimization_threshold": 10,  # Min nodes before optimization
    "max_optimization_time": 300,  # seconds
    "quality_improvement_threshold": 0.2,  # 20% improvement required
}
```

## Success Criteria

1. **Quality Metrics**
   - 30% reduction in tree depth variance
   - 25% improvement in content coherence score
   - 20% reduction in redundant nodes

2. **Performance Targets**
   - Optimization completes in < 5 seconds for 100-node tree
   - LLM costs < $0.10 per optimization
   - No content loss in 100% of cases

3. **User Experience**
   - Trees are noticeably more organized
   - Navigation is more intuitive
   - Related content is properly grouped

## Testing Strategy

### Unit Tests
- Test each analysis component independently
- Verify transformation operations
- Check validation logic

### Integration Tests
- Full workflow with sample trees
- Edge cases (empty tree, single node, circular refs)
- Performance tests with large trees

### Quality Tests
- Before/after comparisons
- Human evaluation of improvements
- Automated quality metrics

## Dependencies
- LangGraph installation and setup
- LLM API access (Gemini)
- Tree search performance fix (for efficient operations)

## Notes
- This is a complex feature that significantly improves system quality
- Should be implemented after core architecture fixes
- Consider feature flag for gradual rollout
- Monitor LLM costs carefully during initial deployment