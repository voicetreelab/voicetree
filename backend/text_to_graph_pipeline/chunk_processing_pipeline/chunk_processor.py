"""
Chunk Processing Pipeline
Processes text chunks through agentic workflows and updates the tree
"""

import asyncio
import inspect
import logging
import os
import time
import traceback
from datetime import datetime
from typing import Any, List, Optional, Set

from backend import settings
from backend.text_to_graph_pipeline.text_buffer_manager import \
    TextBufferManager
from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import \
    DecisionTree
from backend.text_to_graph_pipeline.tree_manager.tree_to_markdown import \
    TreeToMarkdownConverter

from .apply_tree_actions import TreeActionApplier
from .tree_action_decider_workflow import TreeActionDeciderWorkflow

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
        output_dir: str = output_dir_default,
        workflow: Optional[TreeActionDeciderWorkflow] = None
    ):
        """
        Initialize the chunk processor (combines workflow tree manager and transcription processor)
        
        Args:
            decision_tree: The decision tree instance
            converter: Optional markdown converter (will create one if not provided)
            output_dir: Directory for markdown output
            workflow: Optional workflow instance (will create one if not provided)
        """
        self.decision_tree = decision_tree
        self.nodes_to_update: Set[int] = set()
        self.converter = converter or TreeToMarkdownConverter(decision_tree.tree)
        self.output_dir = output_dir
        
        # Set the output_dir on the decision tree for automatic markdown writing
        if hasattr(decision_tree, 'output_dir'):
            decision_tree.output_dir = output_dir
        
        # Initialize text buffer manager with configuration
        self.buffer_manager = TextBufferManager()
        self.buffer_manager.init(bufferFlushLength=settings.TEXT_BUFFER_SIZE_THRESHOLD)
        
        # Initialize tree action applier
        self.tree_action_applier = TreeActionApplier(decision_tree)
        
        # Initialize workflow
        self.workflow = workflow or TreeActionDeciderWorkflow(decision_tree=decision_tree)
        
        logging.info(f"ChunkProcessor initialized with adaptive buffering and agentic workflow")
    
    @property
    def text_buffer_size_threshold(self) -> int:
        """Backward compatibility property for buffer size threshold"""
        return self.buffer_manager.bufferFlushLength
    
    async def process_new_text_and_update_markdown(self, text: str):
        """
        Process transcribed text and convert to markdown (main entry point)
        
        Args:
            text: The transcribed text to process
        """
        try:
            # logging.info(f"Processing transcribed text: {text}")
            text = text.replace("Thank you.", "")  # todo, whisper keeps on hallucinating thank you
            start_time = time.time()

            # logging.info(f"ChunkProcessor.process_and_convert calling process_new_text with: '{text}'")
            await self.process_new_text(text)
            
            # Markdown writing now happens automatically in DecisionTree methods
            # No need to manually call converter.convert_node anymore

            elapsed_time = time.time() - start_time
            # logging.info(f"Processing transcribed text took: {elapsed_time:.4f} seconds")

        except Exception as e:
            logging.error(
                f"Error in process_and_convert: {e} "
                f"- Type: {type(e)} - Traceback: {traceback.format_exc()}")

    async def process_new_text(self, transcribed_text: str):
        """
        Process incoming voice input using unified buffer management
        
        Args:
            transcribed_text: The transcribed text from voice recognition
        """
        # logging.info(f"process_new_text called with text: '{transcribed_text}'")
        # logging.info(f"process_new_text called from: {inspect.stack()[1].function}")
        
        # Add text to buffer - incomplete text is maintained internally
        self.buffer_manager.addText(transcribed_text)
        
        # Check if buffer is ready to be processed
        text_to_process = self.buffer_manager.getBufferTextWhichShouldBeProcessed()
        if text_to_process:
            # Get transcript history for context
            transcript_history = self.buffer_manager.get_transcript_history()
            
            # Process the text chunk
            updated_nodes = await self.workflow.process_text_chunk(
                text_chunk=text_to_process,
                transcript_history_context=transcript_history,
                tree_action_applier=self.tree_action_applier,
                buffer_manager=self.buffer_manager
            )
    
    def get_workflow_statistics(self) -> dict:
        """Get statistics from the workflow adapter"""
        return self.workflow.get_workflow_statistics()
    
    def clear_workflow_state(self):
        """Clear all buffers and reset state"""
        self.buffer_manager.clear()
        self.nodes_to_update.clear()
        logging.info("All buffers and state cleared")
    
    async def finalize(self):
        """Finalize processing - convert any remaining nodes to markdown"""
        try:
            logging.info("Finalizing transcription processing")
            
            # Check if there's anything in the buffer that wasn't processed
            final_buffer = self.buffer_manager.getBuffer()
            if final_buffer:
                logging.warning(f"WARNING: Buffer still has {len(final_buffer)} chars during finalize")
            
            # Markdown writing now happens automatically in DecisionTree methods
            # No need to manually call converter.convert_node anymore
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
            parent_name = self.decision_tree.tree[node.parent_id].title if node.parent_id is not None else "None"
            logging.info(f"Node {node_id}: '{node.title}' (parent: '{parent_name}')")
        
        return {"total_nodes": node_count, "root_children": root_children}
    
    