"""
SingleAbstractionOptimizerAgent - Optimizes individual nodes for cognitive clarity
"""

from typing import List, Union, Dict, Any, Optional
from langgraph.graph import END

from ..core.agent import Agent
from ..core.state import SingleAbstractionOptimizerAgentState
from ..models import UpdateAction, CreateAction, BaseTreeAction, OptimizationResponse
from ...tree_manager.decision_tree_ds import DecisionTree, Node


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
            OptimizationResponse,
            model_name="gemini-2.5-flash-lite"
        )
        self.add_dataflow("single_abstraction_optimizer", END)
    
    async def run(self, node:Node, neighbours_context: str) -> List[BaseTreeAction]:
        """Analyze and optimize a single node
        
        Args:
            node: The node to optimize
            neighbours_context: Context about neighboring nodes
            
        Returns:
            List of tree actions (UPDATE and/or CREATE actions)
        """
        
        # Get neighbors for context
        
        # Create initial state
        initial_state: SingleAbstractionOptimizerAgentState = {
            "node_id": node.id,
            "node_name": node.title,
            "node_content": node.content,
            "node_summary": node.summary,
            "neighbors": str(neighbours_context),
            "transcript_history": "", 
            # Agent response field
            "single_abstraction_optimizer_response": None
        }
        
        # Run workflow
        app = self.compile()
        result = await app.ainvoke(initial_state)
        
        # Extract and convert to actions
        if result:
            return self._convert_to_typed_actions(result, node.id)
        return []
    
    def _convert_to_typed_actions(self, result: dict, node_id: int) -> List[BaseTreeAction]:
        """Convert response structure to properly typed actions"""
        from ..core.boundary_converters import dicts_to_models, dict_to_model
        from ..models import ChildNodeSpec
        
        # === ENTRY BOUNDARY: Get typed optimization response ===
        # The optimization response is now stored as a typed object
        optimization: OptimizationResponse = result.get("single_abstraction_optimizer_response")
        
        # dict_to_model only returns None if input is None/empty
        # If we get here with None, something is very wrong
        if optimization is None:
            raise RuntimeError(
                f"Failed to create OptimizationResponse from non-empty data: {result}. "
                "This should never happen - dict_to_model should have raised ValueError."
            )
        
        # === CORE LOGIC: Work with Pydantic models ===
        typed_actions = []
        
        # Handle original node update if requested
        if optimization.original_new_content:
            typed_actions.append(UpdateAction(
                action="UPDATE",
                node_id=node_id,
                new_content=optimization.original_new_content,
                new_summary=optimization.original_new_summary
            ))
        
        # Handle child node creation
        for child_spec in optimization.create_new_nodes:
            # Validate that child_spec is actually a ChildNodeSpec
            if not hasattr(child_spec, 'name'):
                raise RuntimeError(
                    f"Invalid child_spec structure. Expected ChildNodeSpec but got: {child_spec}. "
                    f"Type: {type(child_spec)}. This usually means the LLM returned extra fields "
                    f"that don't exist in the model."
                )
            
            typed_actions.append(CreateAction(
                action="CREATE",
                parent_node_id=node_id,
                target_node_name=child_spec.target_node_name,
                new_node_name=child_spec.name,
                content=child_spec.content,
                summary=child_spec.summary,
                relationship=child_spec.relationship
            ))
        
        return typed_actions