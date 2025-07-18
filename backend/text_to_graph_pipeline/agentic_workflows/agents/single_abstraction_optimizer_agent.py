"""
SingleAbstractionOptimizerAgent - Optimizes individual nodes for cognitive clarity
"""

from typing import List, Union
from langgraph.graph import END

from ..core.agent import Agent
from ..core.state import SingleAbstractionOptimizerAgentState
from ..models import UpdateAction, CreateAction, BaseTreeAction, OptimizationResponse
from ...tree_manager.decision_tree_ds import DecisionTree


class SingleAbstractionOptimizerAgent(Agent):
    """Agent that optimizes individual nodes for cognitive clarity"""
    
    def __init__(self):
        super().__init__("SingleAbstractionOptimizerAgent", 
                         SingleAbstractionOptimizerAgentState)
        self._setup_workflow()
    
    def _setup_workflow(self):
        """Single prompt workflow"""
        self.add_prompt(
            "single_abstraction_optimizer",
            OptimizationResponse
        )
        self.add_dataflow("single_abstraction_optimizer", END)
    
    async def run(self, node_id: int, decision_tree: DecisionTree) -> List[BaseTreeAction]:
        """Analyze and optimize a single node
        
        Args:
            node_id: ID of the node to optimize
            decision_tree: The decision tree containing the node
            
        Returns:
            List of tree actions (UPDATE and/or CREATE actions)
        """
        node = decision_tree.tree.get(node_id)
        if not node:
            raise ValueError(f"Node {node_id} not found")
        
        # Get neighbors for context
        neighbors = decision_tree.get_neighbors(node_id)
        
        # Create initial state
        initial_state: SingleAbstractionOptimizerAgentState = {
            "node_id": node_id,
            "node_name": node.title,
            "node_content": node.content,
            "node_summary": node.summary,
            "neighbors": str(neighbors),
            # LLM response fields will be added by the workflow
            "reasoning": None,
            "update_original": None,
            "original_new_content": None,
            "original_new_summary": None,
            "create_child_nodes": None
        }
        
        # Run workflow
        app = self.compile()
        result = await app.ainvoke(initial_state)
        
        # Extract and convert to actions
        if result:
            return self._convert_to_typed_actions(result, node_id)
        return []
    
    def _convert_to_typed_actions(self, result: dict, node_id: int) -> List[BaseTreeAction]:
        """Convert response structure to properly typed actions"""
        typed_actions = []
        
        # The LLM response fields are merged directly into the state
        # Handle original node update if requested
        if result.get("update_original") and result.get("original_new_content"):
            typed_actions.append(UpdateAction(
                action="UPDATE",
                node_id=node_id,
                new_content=result["original_new_content"],
                new_summary=result["original_new_summary"]
            ))
        
        # Handle child node creation
        for child_spec in result.get("create_child_nodes", []):
            typed_actions.append(CreateAction(
                action="CREATE",
                parent_node_id=node_id,
                new_node_name=child_spec["name"],
                content=child_spec["content"],
                summary=child_spec["summary"],
                relationship=child_spec["relationship"]
            ))
        
        return typed_actions