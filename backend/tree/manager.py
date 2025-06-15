"""
Unified Tree Manager for VoiceTree
Consolidates functionality from ContextualTreeManager, WorkflowTreeManager, and EnhancedWorkflowTreeManager
"""

import asyncio
import logging
import time
from typing import Set, Optional, List, Dict, Any
from pathlib import Path

from backend.core import get_config, LLMClient, NodeAction, WorkflowResult, ProcessResult
from backend.tree.buffer import BufferManager
from backend.tree.storage import TreeStorage
from backend.workflows.pipeline import WorkflowPipeline


class TreeManager:
    """
    Unified tree manager that handles all voice input processing
    Replaces the multiple existing tree manager implementations
    """
    
    def __init__(
        self,
        tree_storage: TreeStorage,
        state_file: Optional[str] = None,
        enable_background_optimization: bool = True
    ):
        """
        Initialize the unified tree manager
        
        Args:
            tree_storage: Tree storage implementation
            state_file: Optional path for workflow state persistence
            enable_background_optimization: Whether to enable TROA background optimization
        """
        self.config = get_config()
        self.tree_storage = tree_storage
        self.enable_background_optimization = enable_background_optimization
        
        # Core components
        self.llm_client = LLMClient(self.config.llm)
        self.buffer_manager = BufferManager(self.config.buffer)
        self.workflow_pipeline = WorkflowPipeline(
            llm_client=self.llm_client,
            state_file=state_file or self.config.state_file
        )
        
        # State tracking
        self.nodes_to_update: Set[int] = set()
        self.processing_active = False
        self.statistics = {
            "total_voice_inputs": 0,
            "total_processing_time_ms": 0.0,
            "total_nodes_created": 0,
            "total_nodes_updated": 0,
            "buffer_overflows": 0
        }
        
        # Background optimization task
        self._background_task: Optional[asyncio.Task] = None
        
        logging.info(f"TreeManager initialized with buffer threshold {self.config.buffer.text_buffer_size_threshold}")
    
    async def process_voice_input(self, transcribed_text: str) -> ProcessResult:
        """
        Process incoming voice input with unified buffer management
        
        Args:
            transcribed_text: The transcribed text from voice recognition
            
        Returns:
            ProcessResult indicating what happened and current state
        """
        start_time = time.time()
        self.statistics["total_voice_inputs"] += 1
        
        try:
            # Add text to buffer and check if ready for processing
            buffer_result = self.buffer_manager.add_text(transcribed_text)
            
            if not buffer_result.ready_for_processing:
                # Still buffering
                return ProcessResult.buffering(
                    buffer_size=buffer_result.current_size,
                    threshold=buffer_result.threshold
                )
            
            # Buffer is ready, process the text
            text_to_process = buffer_result.text_to_process
            context = self.buffer_manager.get_context()
            
            logging.info(f"Processing {len(text_to_process)} characters of buffered text")
            
            # Process through workflow pipeline
            workflow_result = await self._process_through_workflow(text_to_process, context)
            
            # Apply results to tree
            nodes_updated = await self._apply_workflow_result(workflow_result)
            
            # Update statistics
            processing_time_ms = (time.time() - start_time) * 1000
            self.statistics["total_processing_time_ms"] += processing_time_ms
            
            # Handle incomplete remainder
            if workflow_result.incomplete_remainder:
                self.buffer_manager.set_incomplete_remainder(workflow_result.incomplete_remainder)
            
            # Start background optimization if enabled
            if self.enable_background_optimization and workflow_result.success:
                await self._schedule_background_optimization()
            
            return ProcessResult.processed_successfully(workflow_result, nodes_updated)
            
        except Exception as e:
            processing_time_ms = (time.time() - start_time) * 1000
            self.statistics["total_processing_time_ms"] += processing_time_ms
            
            logging.error(f"Error processing voice input: {e}")
            
            # Create failed workflow result
            failed_result = WorkflowResult(success=False)
            failed_result.mark_failed(str(e))
            
            return ProcessResult.processed_successfully(failed_result, [])
    
    async def _process_through_workflow(self, text: str, context: Dict[str, Any]) -> WorkflowResult:
        """
        Process text through the workflow pipeline
        
        Args:
            text: Text to process
            context: Context information
            
        Returns:
            WorkflowResult with processing outcomes
        """
        # Prepare existing nodes context for workflow
        existing_nodes = self._prepare_existing_nodes_context()
        
        # Run workflow pipeline
        return await self.workflow_pipeline.process(
            transcript=text,
            existing_nodes=existing_nodes,
            context=context
        )
    
    async def _apply_workflow_result(self, workflow_result: WorkflowResult) -> List[int]:
        """
        Apply workflow results to the tree storage
        
        Args:
            workflow_result: Results from workflow processing
            
        Returns:
            List of node IDs that were updated
        """
        nodes_updated = []
        
        if not workflow_result.success:
            return nodes_updated
        
        # Apply each node action
        for action in workflow_result.node_actions:
            try:
                if action.action == "CREATE":
                    node_id = await self._create_node(action)
                    if node_id is not None:
                        nodes_updated.append(node_id)
                        self.statistics["total_nodes_created"] += 1
                        
                elif action.action == "APPEND":
                    node_id = await self._append_to_node(action)
                    if node_id is not None:
                        nodes_updated.append(node_id)
                        self.statistics["total_nodes_updated"] += 1
                        
            except Exception as e:
                logging.error(f"Failed to apply node action {action.action}: {e}")
                workflow_result.add_warning(f"Failed to apply {action.action} for {action.concept_name}: {e}")
        
        # Track nodes for markdown generation
        self.nodes_to_update.update(nodes_updated)
        
        # Always include root node for updates
        if nodes_updated:
            self.nodes_to_update.add(0)
        
        return nodes_updated
    
    async def _create_node(self, action: NodeAction) -> Optional[int]:
        """
        Create a new node based on the action
        
        Args:
            action: NodeAction with CREATE details
            
        Returns:
            ID of created node, or None if failed
        """
        # Find parent node ID
        parent_id = 0  # Default to root
        if action.parent_concept_name and action.parent_concept_name != "Root":
            parent_id = self.tree_storage.find_node_by_name(action.parent_concept_name)
            if parent_id is None:
                logging.warning(f"Parent node '{action.parent_concept_name}' not found, using root")
                parent_id = 0
        
        # Create the node
        node_id = self.tree_storage.create_node(
            name=action.concept_name,
            content=action.content,
            summary=action.summary,
            parent_id=parent_id,
            relationship=action.relationship or "child of"
        )
        
        logging.info(f"Created node {node_id}: '{action.concept_name}' (parent: {parent_id})")
        return node_id
    
    async def _append_to_node(self, action: NodeAction) -> Optional[int]:
        """
        Append content to an existing node
        
        Args:
            action: NodeAction with APPEND details
            
        Returns:
            ID of updated node, or None if failed
        """
        node_id = self.tree_storage.find_node_by_name(action.concept_name)
        if node_id is None:
            logging.warning(f"Cannot append - node '{action.concept_name}' not found")
            return None
        
        # Append content and update summary
        success = self.tree_storage.append_to_node(
            node_id=node_id,
            content=action.content,
            summary=action.summary
        )
        
        if success:
            logging.info(f"Appended to node {node_id}: '{action.concept_name}'")
            return node_id
        else:
            logging.error(f"Failed to append to node {node_id}")
            return None
    
    def _prepare_existing_nodes_context(self) -> str:
        """
        Prepare existing nodes context for workflow processing
        
        Returns:
            Formatted string describing existing nodes
        """
        all_nodes = self.tree_storage.get_all_nodes()
        
        if not all_nodes:
            return "No existing nodes"
        
        # Sort by recency (most recent first)
        sorted_nodes = sorted(
            all_nodes.items(),
            key=lambda x: getattr(x[1], 'created_at', 0),
            reverse=True
        )
        
        node_descriptions = []
        for node_id, node in sorted_nodes[:10]:  # Limit to 10 most recent
            if node_id == 0:  # Skip root
                continue
                
            desc = f"- {getattr(node, 'title', 'Untitled')}: {getattr(node, 'summary', 'No summary')}"
            
            # Add parent info
            parent_id = getattr(node, 'parent_id', None)
            if parent_id is not None and parent_id in all_nodes:
                parent_title = getattr(all_nodes[parent_id], 'title', 'Root')
                desc += f" (child of {parent_title})"
            
            node_descriptions.append(desc)
        
        return "\n".join(node_descriptions) if node_descriptions else "No existing nodes"
    
    async def _schedule_background_optimization(self) -> None:
        """
        Schedule background optimization (TROA) if enabled
        """
        if not self.enable_background_optimization:
            return
        
        # Cancel existing background task if running
        if self._background_task and not self._background_task.done():
            self._background_task.cancel()
        
        # Schedule new optimization task
        self._background_task = asyncio.create_task(
            self._run_background_optimization()
        )
    
    async def _run_background_optimization(self) -> None:
        """
        Run background optimization (TROA system)
        """
        await asyncio.sleep(self.config.workflow.optimization_interval_minutes * 60)
        
        try:
            logging.info("Starting background optimization (TROA)")
            
            # TODO: Implement TROA optimization logic
            # This would include:
            # - Node merging for similar concepts
            # - Relationship optimization
            # - Content consolidation
            # - Structure improvements
            
            logging.info("Background optimization completed")
            
        except asyncio.CancelledError:
            logging.info("Background optimization cancelled")
        except Exception as e:
            logging.error(f"Background optimization failed: {e}")
    
    def get_nodes_to_update(self) -> Set[int]:
        """Get set of node IDs that need markdown updates"""
        return self.nodes_to_update.copy()
    
    def clear_nodes_to_update(self) -> None:
        """Clear the set of nodes that need updates"""
        self.nodes_to_update.clear()
    
    def get_statistics(self) -> Dict[str, Any]:
        """Get comprehensive statistics about tree manager operation"""
        llm_stats = self.llm_client.get_statistics()
        buffer_stats = self.buffer_manager.get_statistics()
        tree_stats = self.tree_storage.get_statistics()
        workflow_stats = self.workflow_pipeline.get_statistics()
        
        combined_stats = {
            **self.statistics,
            "llm": llm_stats,
            "buffer": buffer_stats,
            "tree": tree_stats,
            "workflow": workflow_stats,
            "background_optimization_enabled": self.enable_background_optimization
        }
        
        # Calculate derived metrics
        if self.statistics["total_voice_inputs"] > 0:
            combined_stats["average_processing_time_ms"] = (
                self.statistics["total_processing_time_ms"] / self.statistics["total_voice_inputs"]
            )
        
        return combined_stats
    
    def reset_statistics(self) -> None:
        """Reset all statistics"""
        self.statistics = {
            "total_voice_inputs": 0,
            "total_processing_time_ms": 0.0,
            "total_nodes_created": 0,
            "total_nodes_updated": 0,
            "buffer_overflows": 0
        }
        self.llm_client.reset_statistics()
        self.buffer_manager.reset_statistics()
        self.tree_storage.reset_statistics()
        self.workflow_pipeline.reset_statistics()
    
    async def shutdown(self) -> None:
        """Gracefully shutdown the tree manager"""
        # Cancel background tasks
        if self._background_task and not self._background_task.done():
            self._background_task.cancel()
            try:
                await self._background_task
            except asyncio.CancelledError:
                pass
        
        # Save any pending state
        await self.tree_storage.save_state()
        
        logging.info("TreeManager shutdown completed") 