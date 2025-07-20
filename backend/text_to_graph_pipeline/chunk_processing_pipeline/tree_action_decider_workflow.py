"""
TreeActionDeciderWorkflow - Orchestrates the two-step tree update pipeline with workflow result handling.

Combines the functionality of TreeActionDecider and WorkflowAdapter into a single cohesive class.
"""

import logging
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Set, Union

from ..agentic_workflows.agents.append_to_relevant_node_agent import \
    AppendToRelevantNodeAgent
from ..agentic_workflows.agents.single_abstraction_optimizer_agent import \
    SingleAbstractionOptimizerAgent
from ..agentic_workflows.models import (AppendAction, AppendAgentResult,
                                        BaseTreeAction, CreateAction,
                                        UpdateAction)
from ..text_buffer_manager import TextBufferManager
from ..tree_manager.decision_tree_ds import DecisionTree
from .apply_tree_actions import TreeActionApplier


@dataclass
class WorkflowResult:
    """Result from workflow execution"""
    success: bool
    new_nodes: List[str]
    tree_actions: List[BaseTreeAction]
    error_message: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


class TreeActionDeciderWorkflow:
    """
    Orchestrates the two-step tree update pipeline with workflow result handling.
    NOT an agent - pure deterministic coordination with result wrapping.
    """
    
    def __init__(self, decision_tree: Optional[DecisionTree] = None) -> None:
        """
        Initialize the workflow
        
        Args:
            decision_tree: Optional decision tree instance (can be set later)
        """
        self.decision_tree: Optional[DecisionTree] = decision_tree
        self.append_agent: AppendToRelevantNodeAgent = AppendToRelevantNodeAgent()
        self.optimizer_agent: SingleAbstractionOptimizerAgent = SingleAbstractionOptimizerAgent()
        self.nodes_to_update: Set[int] = set()
        
        # Track previous buffer remainder to detect stuck text
        self._prev_buffer_remainder: str = ""  # What was left in buffer after last processing
    
    
    def get_workflow_statistics(self) -> Dict[str, Any]:
        """Get statistics about the workflow state"""
        if not self.decision_tree:
            return {"error": "No decision tree set"}
        
        return {
            "total_nodes": len(self.decision_tree.tree),
            "message": "Workflow is stateless - showing tree statistics"
        }
    
    def clear_workflow_state(self) -> None:
        """Clear the workflow state"""
        # Clear stuck text tracking
        self._prev_buffer_remainder = ""
    
    async def run(
        self, 
        transcript_text: str, 
        decision_tree: DecisionTree,
        transcript_history: str = ""
    ) -> List[BaseTreeAction]:
        """
        Wrapper method for backwards compatibility with tests.
        Runs the workflow and returns all optimization actions.
        
        Args:
            transcript_text: The text to process
            decision_tree: The decision tree to update
            transcript_history: Historical context
            
        Returns:
            List of optimization actions that were applied
        """
        # Set the decision tree
        self.decision_tree = decision_tree
        
        # Create temporary instances for the wrapper
        from ..text_buffer_manager import TextBufferManager
        buffer_manager = TextBufferManager()
        tree_action_applier = TreeActionApplier(decision_tree)
        
        # Store optimization actions for test compatibility
        self.optimization_actions_for_tests = []
        
        # Process the chunk
        await self.process_text_chunk(
            text_chunk=transcript_text,
            transcript_history_context=transcript_history,
            tree_action_applier=tree_action_applier,
            buffer_manager=buffer_manager
        )
        
        # Return the optimization actions for test compatibility
        return self.optimization_actions_for_tests
    
    async def process_text_chunk(
        self, 
        text_chunk: str, 
        transcript_history_context: str,
        tree_action_applier: TreeActionApplier,
        buffer_manager: TextBufferManager
    ) -> Set[int]:
        """
        Processes a text chunk through a single, deep, stateful workflow.
        This method directly applies actions in a two-phase process to the instance's
        decision tree, enabling a "Progressive Refinement" user experience.
        
        Args:
            text_chunk: The chunk of text to process.
            transcript_history_context: Historical context.
            tree_action_applier: The TreeActionApplier instance to use for applying actions.
            buffer_manager: The TextBufferManager instance for buffer operations.
            
        Returns:
            Set of node IDs that were updated
        """
        logging.info(f"Starting stateful workflow for text chunk ( {(text_chunk)})")
        print(f"Buffer full, sending to agentic workflow, text: {text_chunk}\n") 
        
        self.nodes_to_update.clear()
        
        
        # ======================================================================
        # PHASE 1: PLACEMENT (APPEND/CREATE)
        # ======================================================================
        logging.info("Running Phase 1: Placement Agent...")
        
        # The append_agent now returns both actions and segment information
        append_agent_result: AppendAgentResult = await self.append_agent.run(
            transcript_text=text_chunk,
            decision_tree=self.decision_tree,
            transcript_history=transcript_history_context
        )
        
        append_or_create_actions: List[AppendAction | CreateAction] = append_agent_result.actions

        
        # FOR EACH COMPLETED SEGMENT, REMOVE FROM BUFFER
        # note, you ABSOLUTELY HAVE TO do this per segment, not all at once for all completed text.
        for segment in append_agent_result.segments:
            if segment.is_routable:
                buffer_manager.flushCompletelyProcessedText(segment.text)
        
        if not append_or_create_actions:
            logging.info("Placement agent returned no actions. Ending workflow for this chunk.")
            logging.info(f"Incomplete segments remain in buffer for next processing")
            
            # Check for stuck text even when no actions are returned
            current_buffer: str = buffer_manager.getBuffer()
            if current_buffer and self._prev_buffer_remainder and self._prev_buffer_remainder in current_buffer:
                # Previous content still in buffer (exact match or as prefix) - remove it as stuck text
                logging.warning(f"No actions returned and previous buffer content still present: '{self._prev_buffer_remainder}...' - removing stuck text")
                buffer_manager.flushCompletelyProcessedText(self._prev_buffer_remainder)  
            
            return set() #  no actions to further process.
        

        # --- Orphan Merging ---
        # This logic is necessary before the first apply. Merge all create actions into a single node, so that they can be seperated by optimizer.
        orphan_creates: List[CreateAction] = [
            action for action in append_or_create_actions 
            if isinstance(action, CreateAction) and not action.parent_node_id
        ]
        
        # Process actions based on orphan merge logic
        actions_to_apply: List[BaseTreeAction] = append_or_create_actions
        
        if len(orphan_creates) > 1:
            logging.info(f"Merging {len(orphan_creates)} orphan nodes into one.")
            
            # Merge all orphan nodes into one grouped node
            merged_names: List[str] = []
            merged_contents: List[str] = []
            merged_summaries: List[str] = []
            
            for orphan in orphan_creates:
                merged_names.append(orphan.new_node_name)
                merged_contents.append(orphan.content)
                merged_summaries.append(orphan.summary)
            
            merged_orphan: CreateAction = CreateAction(
                action="CREATE",
                parent_node_id=None,
                new_node_name="\n\n".join(merged_names),
                content="\n\n".join(merged_contents),
                summary="\n\n".join(merged_summaries),
                relationship=""  # Empty for orphan nodes
            )
            
            # Get non-orphan actions
            non_orphan_actions: List[BaseTreeAction] = [
                action for action in append_or_create_actions 
                if not (isinstance(action, CreateAction))
            ]
            
            # Replace all orphan creates with the single merged one
            actions_to_apply = non_orphan_actions + [merged_orphan]

        # --- First Side Effect: Apply Placement ---
        modified_or_new_nodes = tree_action_applier.apply(actions_to_apply)
        
        logging.info(f"Phase 1 Complete. Nodes affected: {modified_or_new_nodes}")
        
        
        # ======================================================================
        # PHASE 2: OPTIMIZATION
        # ======================================================================
        logging.info("Running Phase 2: Optimization Agent...")

        # We now have the list of nodes that were just modified. We optimize them.
        all_optimization_actions: List[BaseTreeAction] = []
        for node_id in modified_or_new_nodes:
            logging.info(f"Optimizing node {node_id}...")
            
            # The optimizer runs on the tree which has ALREADY been mutated by Phase 1.
            optimization_actions: List[BaseTreeAction] = await self.optimizer_agent.run(
                node=self.decision_tree.tree[node_id],
                neighbours_context=self.decision_tree.get_neighbors(node_id)
            )
            
            if optimization_actions:
                logging.info(f"Optimizer generated {len(optimization_actions)} actions for node {node_id}. Applying them now.")
                # --- Second Side Effect: Apply Optimization ---
                # Apply these actions immediately.
                optimization_modified_nodes: Set[int] = tree_action_applier.apply(optimization_actions)
                
            else:
                logging.info(f"Optimizer had no changes for node {node_id}.")

        # Always store current buffer state for next processing to detect stuck text
        self._prev_buffer_remainder = buffer_manager.getBuffer()
        
        return -1 # changed to impure methhod with only sideeffects