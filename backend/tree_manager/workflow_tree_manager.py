"""
Workflow-based Tree Manager
Uses agentic workflows for all processing
"""

import logging
import asyncio
from typing import Optional, Set

from backend.tree_manager.text_to_tree_manager import (
    ContextualTreeManager,
    extract_complete_sentences
)
from backend.tree_manager.decision_tree_ds import DecisionTree
from backend.workflow_adapter import WorkflowAdapter, WorkflowMode
import settings


class WorkflowTreeManager(ContextualTreeManager):
    """
    Tree manager that uses agentic workflows for processing
    """
    
    def __init__(
        self,
        decision_tree: DecisionTree,
        workflow_state_file: Optional[str] = None
    ):
        """
        Initialize the workflow tree manager
        
        Args:
            decision_tree: The decision tree instance
            workflow_state_file: Optional path to persist workflow state
        """
        super().__init__(decision_tree)
        
        self.workflow_adapter = WorkflowAdapter(
            decision_tree=decision_tree,
            state_file=workflow_state_file,
            mode=WorkflowMode.ATOMIC
        )
        logging.info("WorkflowTreeManager initialized with agentic workflow")
    
    async def _process_text_chunk(self, text_chunk: str, transcript_history_context: str):
        """
        Process a text chunk using the agentic workflow
        
        Args:
            text_chunk: The chunk of text to process
            transcript_history_context: Historical context
        """
        await self._process_with_workflow(text_chunk, transcript_history_context)
    
    async def _process_with_workflow(self, text_chunk: str, transcript_history_context: str):
        """
        Process text using the agentic workflow
        
        Args:
            text_chunk: The chunk of text to process
            transcript_history_context: Historical context
        """
        logging.info("Processing text chunk with agentic workflow")
        
        # Combine text chunk with future lookahead for complete context
        full_transcript = text_chunk
        if self.future_lookahead_history:
            full_transcript += " " + self.future_lookahead_history
        
        # Process through workflow
        result = await self.workflow_adapter.process_transcript(
            transcript=full_transcript,
            context=transcript_history_context
        )
        
        if result.success:
            logging.info(f"Workflow completed successfully. New nodes: {len(result.new_nodes)}")
            
            # Apply the node actions to the decision tree
            await self._apply_node_actions_from_result(result.node_actions)
            
            # Ensure root node is always included for markdown generation
            self.nodes_to_update.add(0)
            
            # Track nodes that were updated
            for action in result.node_actions:
                if action.action == "CREATE":
                    # For new nodes, we need to find their ID after creation
                    node_id = self.decision_tree.get_node_id_from_name(action.concept_name)
                    if node_id:
                        self.nodes_to_update.add(node_id)
                elif action.action == "APPEND":
                    node_id = self.decision_tree.get_node_id_from_name(action.concept_name)
                    if node_id:
                        self.nodes_to_update.add(node_id)
                        
                        # Check if background rewrite is needed
                        node = self.decision_tree.tree[node_id]
                        if hasattr(node, 'num_appends') and node.num_appends % settings.BACKGROUND_REWRITE_EVERY_N_APPEND == 0:
                            asyncio.create_task(
                                self.rewriter.rewrite_node_in_background(self.decision_tree, node_id)
                            ).add_done_callback(
                                lambda res: self.nodes_to_update.add(node_id)
                            )
            
            # Log metadata
            if result.metadata:
                logging.info(f"Workflow metadata: {result.metadata}")
        else:
            logging.error(f"Workflow failed: {result.error_message}")
    
    async def _apply_node_actions_from_result(self, node_actions):
        """
        Apply node actions from workflow result to the decision tree
        
        Args:
            node_actions: List of NodeAction objects to apply
        """
        for action in node_actions:
            if action.action == "CREATE":
                # Find parent node ID
                parent_id = 0  # Default to root
                if action.neighbour_concept_name and action.neighbour_concept_name != "Root":
                    parent_id = self.decision_tree.get_node_id_from_name(action.neighbour_concept_name)
                    if parent_id is None:
                        parent_id = 0  # Fallback to root if parent not found
                
                # Create new node
                new_node_id = self.decision_tree.create_new_node(
                    name=action.concept_name,
                    parent_node_id=parent_id,
                    content=action.markdown_content_to_append,
                    summary=action.updated_summary_of_node,
                    relationship_to_parent=action.relationship_to_neighbour
                )
                logging.info(f"Created new node '{action.concept_name}' with ID {new_node_id}")
                
            elif action.action == "APPEND":
                # Find target node and append content
                node_id = self.decision_tree.get_node_id_from_name(action.concept_name)
                if node_id is not None:
                    node = self.decision_tree.tree[node_id]
                    node.append_content(
                        action.markdown_content_to_append,
                        action.updated_summary_of_node,
                        action.labelled_text
                    )
                    logging.info(f"Appended content to node '{action.concept_name}' (ID {node_id})")
                else:
                    logging.warning(f"Could not find node '{action.concept_name}' for APPEND action")
    
    def get_workflow_statistics(self) -> dict:
        """Get statistics from the workflow adapter"""
        return self.workflow_adapter.get_workflow_statistics()
    
    def clear_workflow_state(self):
        """Clear the workflow state"""
        self.workflow_adapter.clear_workflow_state()
        logging.info("Workflow state cleared")
    
    def save_tree_structure(self):
        """Save the current tree structure (for benchmarking/analysis)"""
        logging.info("Saving final tree structure")
        node_count = len(self.decision_tree.tree)
        root_children = len(self.decision_tree.tree[0].children) if 0 in self.decision_tree.tree else 0
        
        logging.info(f"Tree structure: {node_count} total nodes, root has {root_children} direct children")
        
        # Log the tree hierarchy
        for node_id, node in self.decision_tree.tree.items():
            if node_id == 0:
                continue  # Skip root for cleaner output
            parent_name = self.decision_tree.tree[node.parent_id].title if node.parent_id is not None else "None"
            logging.info(f"Node {node_id}: '{node.title}' (parent: '{parent_name}')")
        
        return {"total_nodes": node_count, "root_children": root_children} 