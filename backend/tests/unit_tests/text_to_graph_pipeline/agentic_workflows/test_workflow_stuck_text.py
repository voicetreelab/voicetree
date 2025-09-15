"""
Test stuck text removal functionality in TreeActionDeciderWorkflow
"""

import pytest
from unittest.mock import Mock, AsyncMock
from backend.text_to_graph_pipeline.chunk_processing_pipeline.tree_action_decider_workflow import TreeActionDeciderWorkflow
from backend.text_to_graph_pipeline.text_buffer_manager.buffer_manager import TextBufferManager
from backend.text_to_graph_pipeline.chunk_processing_pipeline.apply_tree_actions import TreeActionApplier
from backend.tree_manager.markdown_tree_ds import MarkdownTree
from backend.text_to_graph_pipeline.agentic_workflows.models import UpdateAction, BaseTreeAction


class TestWorkflowStuckTextRemoval:
    
    @pytest.mark.asyncio
    async def test_stuck_text_removed_when_no_actions_returned(self):
        """Test that stuck text is removed when no actions are returned repeatedly"""
        # Setup
        workflow = TreeActionDeciderWorkflow()
        tree = MarkdownTree()
        tree.create_new_node("Root", None, "Root content", "Root summary")
        workflow.decision_tree = tree
        
        buffer_manager = TextBufferManager()
        buffer_manager.init(100)
        tree_action_applier = TreeActionApplier(tree)
        
        # Mock the placement result to return no actions (incomplete segments)
        placement_result = Mock()
        placement_result.actions = []  # No actions - all segments incomplete
        placement_result.segments = []  # No segments - make it iterable
        placement_result.completed_text = ""  # No completed text
        
        workflow.append_agent.run = AsyncMock(return_value=placement_result)
        workflow.optimizer_agent.run = AsyncMock(return_value=[])
        
        # First processing - add text to buffer
        buffer_manager._buffer = "Uh, uh, some"
        await workflow.process_text_chunk(
            text_chunk="Uh, uh, some",
            transcript_history_context="",
            tree_action_applier=tree_action_applier,
            buffer_manager=buffer_manager
        )
        
        # Buffer should still have the text since nothing was completed
        assert buffer_manager.getBuffer() == "Uh, uh, some"
        assert workflow._prev_buffer_remainder == "Uh, uh, some"
        
        # Process 4 more times to reach the stuck text threshold (5 iterations total)
        for i in range(4):
            await workflow.process_text_chunk(
                text_chunk="Uh, uh, some",
                transcript_history_context="",
                tree_action_applier=tree_action_applier,
                buffer_manager=buffer_manager
            )
        
        # After 5 iterations, the stuck buffer should be cleared
        assert buffer_manager.getBuffer() == ""
        
    @pytest.mark.asyncio
    async def test_stuck_text_removal_after_flush_failure(self):
        """Test stuck text removal when flush fails due to buffer mismatch"""
        # Setup
        workflow = TreeActionDeciderWorkflow()
        tree = MarkdownTree()
        tree.create_new_node("Root", None, "Root content", "Root summary")
        workflow.decision_tree = tree
        
        buffer_manager = TextBufferManager()
        buffer_manager.init(100)
        tree_action_applier = TreeActionApplier(tree)
        
        # Mock the placement result
        placement_result = Mock()
        placement_result.actions = [UpdateAction(action="UPDATE", node_id=1, new_content="test", new_summary="test summary")]
        placement_result.segments = []  # Make it iterable
        placement_result.completed_text = "Text that is not in buffer"  # This will cause flush to fail
        
        workflow.append_agent.run = AsyncMock(return_value=placement_result)
        workflow.optimizer_agent.run = AsyncMock(return_value=[])
        
        # First processing - buffer has different text than what agent tries to flush
        buffer_manager._buffer = "Uh, some incomplete text"
        await workflow.process_text_chunk(
            text_chunk="Uh, some incomplete text",
            transcript_history_context="",
            tree_action_applier=tree_action_applier,
            buffer_manager=buffer_manager
        )
        
        # Buffer should be unchanged since flush failed
        assert buffer_manager.getBuffer() == "Uh, some incomplete text"
        assert workflow._prev_buffer_remainder == "Uh, some incomplete text"
        
        # Process 4 more times to reach the stuck text threshold (5 iterations total)
        placement_result.completed_text = "Still not in buffer"
        for i in range(4):
            await workflow.process_text_chunk(
                text_chunk="Uh, some incomplete text",
                transcript_history_context="",
                tree_action_applier=tree_action_applier,
                buffer_manager=buffer_manager
            )
        
        # After 5 iterations, the stuck buffer should be cleared
        assert buffer_manager.getBuffer() == ""
        
    @pytest.mark.asyncio
    async def test_clear_workflow_state_resets_tracking(self):
        """Test that clear_workflow_state resets stuck text tracking"""
        workflow = TreeActionDeciderWorkflow()
        workflow._prev_buffer_remainder = "some stuck text"
        
        workflow.clear_workflow_state()
        
        assert workflow._prev_buffer_remainder == ""