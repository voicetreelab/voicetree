"""
TreeActionDecider - Orchestrates the two-step tree update pipeline.

This is NOT an agent - it's a deterministic orchestrator that coordinates
the workflow between agents.
"""

from typing import List, Union

from ..agentic_workflows.agents.append_to_relevant_node_agent import AppendToRelevantNodeAgent
from ..agentic_workflows.agents.single_abstraction_optimizer_agent import SingleAbstractionOptimizerAgent
from ..agentic_workflows.models import UpdateAction, CreateAction
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
        
        Args:
            transcript_text: New transcript content to process
            decision_tree: Current tree state
            transcript_history: Previous transcript context
            
        Returns:
            List of optimization actions (UpdateAction or CreateAction)
        """
        # Step 1: Get placement actions from AppendToRelevantNodeAgent
        placement_actions = await self.append_agent.run(
            transcript_text=transcript_text,
            decision_tree=decision_tree,
            transcript_history=transcript_history
        )
        
        # If no placement actions, return empty list
        if not placement_actions:
            return []
        
        # Step 2: Apply placement actions internally to get modified node IDs
        # Import here to avoid circular imports
        from backend.text_to_graph_pipeline.chunk_processing_pipeline.apply_tree_actions import TreeActionApplier
        
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