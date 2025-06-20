"""
Workflow-based Tree Manager
Uses agentic workflows for all processing with unified buffering
"""

import logging
import asyncio
from typing import Optional, Set, List

from backend.tree_manager.base import TreeManagerInterface, TreeManagerMixin
from backend.tree_manager.decision_tree_ds import DecisionTree
from backend.tree_manager.unified_buffer_manager import UnifiedBufferManager
from backend.workflow_adapter import WorkflowAdapter
import sys
import os

# Add project root to Python path for imports
current_file = os.path.abspath(__file__)
backend_dir = os.path.dirname(os.path.dirname(current_file))
project_root = os.path.dirname(backend_dir)

# Add both project root and backend to path to handle all import scenarios
if project_root not in sys.path:
    sys.path.insert(0, project_root)
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

# Now import settings - this should work from any directory
import settings


class WorkflowTreeManager(TreeManagerInterface, TreeManagerMixin):
    """
    Tree manager that uses agentic workflows for processing with adaptive buffering
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
        self.decision_tree = decision_tree
        self._nodes_to_update: Set[int] = set()  # Use private attribute for interface property
        
        # Initialize unified buffer manager with adaptive processing
        self.buffer_manager = UnifiedBufferManager(
            buffer_size_threshold=settings.TEXT_BUFFER_SIZE_THRESHOLD
        )
        
        # Initialize workflow adapter (actions applied externally)
        self.workflow_adapter = WorkflowAdapter(
            decision_tree=decision_tree,
            state_file=workflow_state_file
        )
        
        logging.info(f"WorkflowTreeManager initialized with adaptive buffering and agentic workflow")
    
    @property
    def text_buffer_size_threshold(self) -> int:
        """Backward compatibility property for buffer size threshold"""
        return self.buffer_manager.buffer_size_threshold
    
    async def process_voice_input(self, transcribed_text: str):
        """
        Process incoming voice input using unified buffer management
        
        Args:
            transcribed_text: The transcribed text from voice recognition
        """
        # Add text to buffer and get text ready for processing
        text_to_process = self.buffer_manager.add_text(transcribed_text)
        
        if text_to_process:
            # Get transcript history for context
            transcript_history = self.buffer_manager.get_transcript_history()
            
            # Add root node to updates on first processing
            if self.buffer_manager.is_first_processing():
                self._nodes_to_update.add(0)
            
            # Process the text chunk
            await self._process_text_chunk(text_to_process, transcript_history)
    
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
        
        # Process through workflow
        result = await self.workflow_adapter.process_transcript(
            transcript=text_chunk,
            context=transcript_history_context
        )
        
        if result.success:
            logging.info(f"Workflow completed successfully. New nodes: {len(result.new_nodes)}")
            
            # Update buffer manager with incomplete remainder
            incomplete_remainder = result.metadata.get("incomplete_buffer", "") if result.metadata else ""
            self.buffer_manager.set_incomplete_remainder(incomplete_remainder)
            
            # Apply node actions (STREAMING mode returns actions without applying them)
            await self._apply_node_actions(result.node_actions)
            
            # Ensure root node is always included for markdown generation
            self._nodes_to_update.add(0)
            
            # Track nodes that were updated
            for action in result.node_actions:
                if action.action == "CREATE":
                    # For new nodes, we need to find their ID after creation
                    node_id = self.decision_tree.get_node_id_from_name(action.concept_name)
                    if node_id:
                        self._nodes_to_update.add(node_id)
                elif action.action == "APPEND":
                    node_id = self.decision_tree.get_node_id_from_name(action.concept_name)
                    if node_id:
                        self._nodes_to_update.add(node_id)
            
            # Log metadata
            if result.metadata:
                logging.info(f"Workflow metadata: {result.metadata}")
        else:
            logging.error(f"Workflow failed: {result.error_message}")
    
    def get_workflow_statistics(self) -> dict:
        """Get statistics from the workflow adapter"""
        return self.workflow_adapter.get_workflow_statistics()
    
    def clear_workflow_state(self):
        """Clear the workflow state and all buffers"""
        self.workflow_adapter.clear_workflow_state()
        self.buffer_manager.clear_buffers()
        self._nodes_to_update.clear()
        logging.info("Workflow state and all buffers cleared")
    
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
    
    async def _apply_node_actions(self, node_actions: List['NodeAction']) -> None:
        """
        Apply node actions to the decision tree with proper error handling
        
        Args:
            node_actions: List of actions to apply
        """
        for action in node_actions:
            try:
                if action.action == "CREATE":
                    parent_id = self.decision_tree.get_node_id_from_name(
                        action.neighbour_concept_name
                    )
                    if parent_id is None:
                        logging.error(f"Cannot create node '{action.concept_name}': parent '{action.neighbour_concept_name}' not found")
                        continue
                        
                    self.decision_tree.create_new_node(
                        name=action.concept_name,
                        parent_node_id=parent_id,
                        content=action.markdown_content_to_append,
                        summary=action.updated_summary_of_node,
                        relationship_to_parent=action.relationship_to_neighbour
                    )
                    
                elif action.action == "APPEND":
                    node_id = self.decision_tree.get_node_id_from_name(
                        action.concept_name
                    )
                    if node_id is None:
                        logging.error(f"Cannot append to node: '{action.concept_name}' not found")
                        continue
                        
                    node = self.decision_tree.tree.get(node_id)
                    if node is None:
                        logging.error(f"Node {node_id} exists in index but not in tree")
                        continue
                        
                    node.append_content(
                        action.markdown_content_to_append,
                        action.updated_summary_of_node,
                        action.labelled_text
                    )
            except Exception as e:
                logging.error(f"Error applying {action.action} action for '{getattr(action, 'concept_name', 'unknown')}': {str(e)}")
                # Continue processing other actions rather than failing completely 