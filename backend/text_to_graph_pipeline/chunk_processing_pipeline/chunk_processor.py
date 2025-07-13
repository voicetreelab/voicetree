"""
Chunk Processing Pipeline
Processes text chunks through agentic workflows and updates the tree
"""

import logging
import asyncio
import inspect
import time
import traceback
import os
from datetime import datetime
from typing import Optional, Set, List

from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import DecisionTree
from backend.text_to_graph_pipeline.text_buffer_manager import TextBufferManager, BufferConfig
from backend.text_to_graph_pipeline.tree_manager.tree_to_markdown import TreeToMarkdownConverter
from backend.text_to_graph_pipeline.agentic_workflows.schema_models import IntegrationDecision
from .workflow_adapter import WorkflowAdapter
from backend import settings


# Output directory configuration
output_dir_base = "markdownTreeVault" # todo, move this to config file
date_str = datetime.now().strftime("%Y-%m-%d")
output_dir_default = os.path.join(output_dir_base, date_str)


class ChunkProcessor:
    """
    Processes text chunks through the agentic workflow pipeline.
    
    This class:
    1. Receives text chunks from the buffer manager
    2. Gathers context from the decision tree
    3. Calls agentic workflows for processing
    4. Updates the tree with the results
    """
    
    def __init__(
        self,
        decision_tree: DecisionTree,
        converter: Optional[TreeToMarkdownConverter] = None,
        workflow_state_file: Optional[str] = None,
        output_dir: str = output_dir_default
    ):
        """
        Initialize the chunk processor (combines workflow tree manager and transcription processor)
        
        Args:
            decision_tree: The decision tree instance
            converter: Optional markdown converter (will create one if not provided)
            workflow_state_file: Optional path to persist workflow state
            output_dir: Directory for markdown output
        """
        self.decision_tree = decision_tree
        self.nodes_to_update: Set[int] = set()
        self.converter = converter or TreeToMarkdownConverter(decision_tree.tree)
        self.output_dir = output_dir
        
        # Initialize text buffer manager with configuration
        buffer_config = BufferConfig(
            buffer_size_threshold=settings.TEXT_BUFFER_SIZE_THRESHOLD
        )
        self.buffer_manager = TextBufferManager(config=buffer_config)
        
        # Initialize workflow adapter
        self.workflow_adapter = WorkflowAdapter(
            decision_tree=decision_tree,
            state_file=workflow_state_file
        )
        
        logging.info(f"ChunkProcessor initialized with adaptive buffering and agentic workflow")
    
    @property
    def text_buffer_size_threshold(self) -> int:
        """Backward compatibility property for buffer size threshold"""
        return self.buffer_manager.config.buffer_size_threshold
    
    async def process_and_convert(self, text: str):
        """
        Process transcribed text and convert to markdown (main entry point)
        
        Args:
            text: The transcribed text to process
        """
        try:
            # logging.info(f"Processing transcribed text: {text}")
            text = text.replace("Thank you.", "")  # todo, whisper keeps on hallucinating thank you
            start_time = time.time()

            # logging.info(f"ChunkProcessor.process_and_convert calling process_voice_input with: '{text}'")
            await self.process_voice_input(text)

            self.converter.convert_node(output_dir=self.output_dir,
                                        nodes_to_update=self.nodes_to_update)

            self.nodes_to_update.clear()

            elapsed_time = time.time() - start_time
            # logging.info(f"Processing transcribed text took: {elapsed_time:.4f} seconds")

        except Exception as e:
            logging.error(
                f"Error in process_and_convert: {e} "
                f"- Type: {type(e)} - Traceback: {traceback.format_exc()}")

    async def process_voice_input(self, transcribed_text: str):
        """
        Process incoming voice input using unified buffer management
        
        Args:
            transcribed_text: The transcribed text from voice recognition
        """
        # logging.info(f"process_voice_input called with text: '{transcribed_text}'")
        # logging.info(f"process_voice_input called from: {inspect.stack()[1].function}")
        
        # Add text to buffer - incomplete text is maintained internally
        result = self.buffer_manager.add_text(transcribed_text)
        
        if result.is_ready and result.text:
            # Get transcript history for context
            transcript_history = self.buffer_manager.get_transcript_history()
            
            # Add root node to updates on first processing
            if self.buffer_manager.is_first_processing():
                self.nodes_to_update.add(0)
            
            # Process the text chunk
            await self._process_text_chunk(result.text, transcript_history)
    
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
            
            # Flush completed text from buffer
            if result.metadata and "completed_text" in result.metadata:
                completed_text = result.metadata["completed_text"]
                self.buffer_manager.flush_completed_text(completed_text)
                if completed_text:
                    logging.info(f"Flushed completed text: '{completed_text[:50]}...'")
            else:
                # No completed text information, log warning
                logging.warning("Workflow didn't return completed text information")
            
            # Apply the integration decisions to the decision tree
            await self._apply_integration_decisions(result.integration_decisions)
            
            # Ensure root node is always included for markdown generation
            self.nodes_to_update.add(0)
            
            # Log metadata
            if result.metadata:
                logging.info(f"Workflow metadata: {result.metadata}")
        else:
            logging.error(f"Workflow failed: {result.error_message}")
    
    async def _apply_integration_decisions(self, integration_decisions: List[IntegrationDecision]):
        """
        Apply integration decisions from workflow result to the decision tree
        
        Args:
            integration_decisions: List of IntegrationDecision objects to apply
        """
        logging.info(f"Applying {len(integration_decisions)} integration decisions")
        for decision in integration_decisions:
            if decision.action == "CREATE":
                # Find parent node ID from name
                # or none if not specified
                parent_id = None  
                if decision.target_node:
                    parent_id = self.decision_tree.get_node_id_from_name(decision.target_node)
                
                # Create new node
                new_node_id = self.decision_tree.create_new_node(
                    name=decision.new_node_name,
                    parent_node_id=parent_id,
                    content=decision.content,
                    summary=decision.new_node_summary,
                    relationship_to_parent=decision.relationship_for_edge
                )
                logging.info(f"Created new node '{decision.new_node_name}' with ID {new_node_id}")
                # Add the new node to the update set
                self.nodes_to_update.add(new_node_id)
                
            elif decision.action == "APPEND":
                # Find target node and append content
                if not decision.target_node:
                    logging.warning(f"APPEND decision for '{decision.name}' has no target_node - skipping")
                    continue
                    
                node_id = self.decision_tree.get_node_id_from_name(decision.target_node)
                if node_id is not None:
                    node = self.decision_tree.tree[node_id]
                    node.append_content(
                        decision.content,
                        None,  # APPEND decisions don't have new_node_summary in IntegrationDecision
                        decision.name  # Use the chunk name as the label
                    )
                    logging.info(f"Appended content to node '{decision.target_node}' (ID {node_id})")
                    # Add the updated node to the update set
                    self.nodes_to_update.add(node_id) #todo maybe we could hide this within the append_content method. Or track recently_updated_nodes there.
                else:
                    logging.warning(f"Could not find node '{decision.target_node}' for APPEND action")
    
    def get_workflow_statistics(self) -> dict:
        """Get statistics from the workflow adapter"""
        return self.workflow_adapter.get_workflow_statistics()
    
    def clear_workflow_state(self):
        """Clear the workflow state and all buffers"""
        self.workflow_adapter.clear_workflow_state()
        self.buffer_manager.clear()
        self.nodes_to_update.clear()
        logging.info("Workflow state and all buffers cleared")
    
    async def finalize(self):
        """Finalize processing - convert any remaining nodes to markdown"""
        try:
            logging.info("Finalizing transcription processing")
            self.converter.convert_node(output_dir=self.output_dir,
                                        nodes_to_update=self.nodes_to_update)
            self.nodes_to_update.clear()
        except Exception as e:
            logging.error(f"Error in finalize: {e} - Type: {type(e)} - Traceback: {traceback.format_exc()}")

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