"""
Unit tests for orphan topic grouping functionality.

Tests verify that orphan nodes (nodes with no parent) are grouped and merged
before processing to handle long contexts better.
"""

from typing import List
from unittest.mock import AsyncMock, Mock, patch

import pytest

from backend.text_to_graph_pipeline.agentic_workflows.models import (
    AppendAction, AppendAgentResult, CreateAction, SegmentModel)
from backend.text_to_graph_pipeline.chunk_processing_pipeline.tree_action_decider_workflow import (
    TreeActionDeciderWorkflow)
from backend.markdown_tree_manager.markdown_tree_ds import (
    MarkdownTree, Node)


class TestOrphanTopicGrouping:
    """Tests for grouping orphan nodes"""
    
    @pytest.fixture
    def decision_tree(self):
        """Create a basic decision tree for testing"""
        tree = MarkdownTree()
        node = Node(
            name="Root",
            node_id=1,
            content="Root content",
            summary="Root summary",
            parent_id=None
        )
        tree.tree[1] = node
        tree.next_node_id = 2
        return tree
    
    @pytest.fixture
    def workflow(self, decision_tree):
        """Create workflow instance with mocked agents"""
        workflow = TreeActionDeciderWorkflow(decision_tree)
        workflow.append_agent = AsyncMock()
        workflow.optimizer_agent = AsyncMock()
        return workflow
    
    @pytest.mark.asyncio
    async def test_single_orphan_no_merging(self, workflow, decision_tree):
        """Test that a single orphan node is created without merging"""
        # Arrange
        create_action = CreateAction(
            action="CREATE",
            parent_node_id=None,
            new_node_name="New Feature",
            content="This is a new feature description",
            summary="New feature summary",
            relationship=""
        )
        
        workflow.append_agent.run.return_value = AppendAgentResult(
            actions=[create_action],
            segments=[SegmentModel(
                reasoning="New topic",
                edited_text="This is a new feature description",
                raw_text="This is a new feature description",
                is_routable=True
            )]
        )
        
        workflow.optimizer_agent.run.return_value = []
        
        # Act
        with patch('backend.text_to_graph_pipeline.chunk_processing_pipeline.tree_action_decider_workflow.TreeActionApplier') as mock_applier:
            mock_applier_instance = Mock()
            mock_applier_instance.apply.return_value = {2}  # New node ID
            mock_applier.return_value = mock_applier_instance
            
            # Mock the node that would be created
            new_node = Node(
                name="New Feature",
                node_id=2,
                content="This is a new feature description",
                summary="New feature summary",
                parent_id=None
            )
            decision_tree.tree[2] = new_node
            
            with patch('backend.text_to_graph_pipeline.chunk_processing_pipeline.tree_action_decider_workflow.TextBufferManager') as mock_buffer:
                mock_buffer_instance = Mock()
                mock_buffer_instance.getBuffer.return_value = ""
                mock_buffer.return_value = mock_buffer_instance
                
                result = await workflow.run("This is a new feature description", decision_tree)
        
        # Assert
        # Verify apply was called with the original single action
        mock_applier_instance.apply.assert_called()
        applied_actions = mock_applier_instance.apply.call_args[0][0]
        assert len(applied_actions) == 1
        assert applied_actions[0].new_node_name == "New Feature"
    
    @pytest.mark.asyncio
    async def test_multiple_orphans_same_name_merged(self, workflow, decision_tree):
        """Test that multiple orphan nodes with the SAME NAME are merged into one"""
        # Arrange
        create_actions = [
            CreateAction(
                action="CREATE",
                parent_node_id=None,
                new_node_name="Feature Implementation",
                content="First part of the feature",
                summary="Feature part 1 summary",
                relationship=""
            ),
            CreateAction(
                action="CREATE",
                parent_node_id=None,
                new_node_name="Feature Implementation",
                content="Second part of the feature",
                summary="Feature part 2 summary",
                relationship=""
            ),
            CreateAction(
                action="CREATE",
                parent_node_id=None,
                new_node_name="Feature Implementation",
                content="Third part of the feature",
                summary="Feature part 3 summary",
                relationship=""
            )
        ]
        
        workflow.append_agent.run.return_value = AppendAgentResult(
            actions=create_actions,
            segments=[
                SegmentModel(reasoning="Part 1", edited_text="First part", raw_text="First part", is_routable=True),
                SegmentModel(reasoning="Part 2", edited_text="Second part", raw_text="Second part", is_routable=True),
                SegmentModel(reasoning="Part 3", edited_text="Third part", raw_text="Third part", is_routable=True)
            ]
        )
        
        workflow.optimizer_agent.run.return_value = []
        
        # Act
        with patch('backend.text_to_graph_pipeline.chunk_processing_pipeline.tree_action_decider_workflow.TreeActionApplier') as mock_applier:
            mock_applier_instance = Mock()
            mock_applier_instance.apply.return_value = {2}  # New merged node ID
            mock_applier.return_value = mock_applier_instance
            
            # Mock the node that would be created
            merged_node = Node(
                name="Feature Implementation",
                node_id=2,
                content="First part of the feature\n\nSecond part of the feature\n\nThird part of the feature",
                summary="Feature part 1 summary\n\nFeature part 2 summary\n\nFeature part 3 summary",
                parent_id=None
            )
            decision_tree.tree[2] = merged_node
            
            with patch('backend.text_to_graph_pipeline.chunk_processing_pipeline.tree_action_decider_workflow.TextBufferManager') as mock_buffer:
                mock_buffer_instance = Mock()
                mock_buffer_instance.getBuffer.return_value = ""
                mock_buffer.return_value = mock_buffer_instance
                
                result = await workflow.run("First part Second part Third part", decision_tree)
        
        # Assert
        # Verify apply was called with merged action
        mock_applier_instance.apply.assert_called()
        applied_actions = mock_applier_instance.apply.call_args[0][0]
        assert len(applied_actions) == 1
        
        # Check merged content
        merged_action = applied_actions[0]
        assert isinstance(merged_action, CreateAction)
        assert merged_action.new_node_name == "Feature Implementation"
        assert "First part of the feature" in merged_action.content
        assert "Second part of the feature" in merged_action.content
        assert "Third part of the feature" in merged_action.content
        assert merged_action.parent_node_id is None  # Still an orphan
    
    @pytest.mark.asyncio
    async def test_mixed_actions_same_name_orphans_merged(self, workflow, decision_tree):
        """Test that non-orphan actions are preserved while orphans with same name are merged"""
        # Arrange
        actions = [
            AppendAction(
                action="APPEND",
                target_node_id=1,
                target_node_name="Root",
                content="Appending to root"
            ),
            CreateAction(
                action="CREATE",
                parent_node_id=None,
                new_node_name="Topic A",
                content="First orphan",
                summary="Orphan 1 summary",
                relationship=""
            ),
            CreateAction(
                action="CREATE",
                parent_node_id=1,  # Not an orphan
                new_node_name="Child of Root",
                content="This is a child node",
                summary="Child summary",
                relationship="child of"
            ),
            CreateAction(
                action="CREATE",
                parent_node_id=None,
                new_node_name="Topic A",  # Same name as first orphan
                content="Second orphan",
                summary="Orphan 2 summary",
                relationship=""
            )
        ]
        
        workflow.append_agent.run.return_value = AppendAgentResult(
            actions=actions,
            segments=[
                SegmentModel(reasoning="Append", edited_text="Append", raw_text="Append", is_routable=True),
                SegmentModel(reasoning="O1", edited_text="O1", raw_text="O1", is_routable=True),
                SegmentModel(reasoning="Child", edited_text="Child", raw_text="Child", is_routable=True),
                SegmentModel(reasoning="O2", edited_text="O2", raw_text="O2", is_routable=True)
            ]
        )
        
        workflow.optimizer_agent.run.return_value = []
        
        # Act
        with patch('backend.text_to_graph_pipeline.chunk_processing_pipeline.tree_action_decider_workflow.TreeActionApplier') as mock_applier:
            mock_applier_instance = Mock()
            mock_applier_instance.apply.return_value = {1, 2, 3}
            mock_applier.return_value = mock_applier_instance
            
            # Mock the nodes that would be created
            # Node 1 already exists (Root)
            child_node = Node(
                name="Child of Root",
                node_id=2,
                content="This is a child node",
                summary="Child summary",
                parent_id=1
            )
            child_node.relationships[1] = "child of"
            merged_orphan_node = Node(
                name="Topic A",
                node_id=3,
                content="First orphan\n\nSecond orphan",
                summary="Orphan 1 summary\n\nOrphan 2 summary",
                parent_id=None
            )
            decision_tree.tree[2] = child_node
            decision_tree.tree[3] = merged_orphan_node
            
            with patch('backend.text_to_graph_pipeline.chunk_processing_pipeline.tree_action_decider_workflow.TextBufferManager') as mock_buffer:
                mock_buffer_instance = Mock()
                mock_buffer_instance.getBuffer.return_value = ""
                mock_buffer.return_value = mock_buffer_instance
                
                result = await workflow.run("Mixed content", decision_tree)
        
        # Assert
        mock_applier_instance.apply.assert_called()
        applied_actions = mock_applier_instance.apply.call_args[0][0]
        assert len(applied_actions) == 3  # Append + Non-orphan Create + Merged orphan
        
        # Check action types
        append_actions = [a for a in applied_actions if isinstance(a, AppendAction)]
        create_actions = [a for a in applied_actions if isinstance(a, CreateAction)]
        
        assert len(append_actions) == 1
        assert len(create_actions) == 2
        
        # Verify non-orphan create is preserved
        non_orphan_creates = [a for a in create_actions if a.parent_node_id is not None]
        assert len(non_orphan_creates) == 1
        assert non_orphan_creates[0].new_node_name == "Child of Root"
        
        # Verify orphans are merged
        orphan_creates = [a for a in create_actions if a.parent_node_id is None]
        assert len(orphan_creates) == 1
        merged_orphan = orphan_creates[0]
        assert merged_orphan.new_node_name == "Topic A"
        assert "First orphan" in merged_orphan.content
        assert "Second orphan" in merged_orphan.content
        assert merged_orphan.parent_node_id is None  # Still an orphan
    
    @pytest.mark.asyncio
    async def test_different_name_orphans_not_merged(self, workflow, decision_tree):
        """Test that orphan nodes with DIFFERENT names are NOT merged"""
        # Arrange
        create_actions = [
            CreateAction(
                action="CREATE",
                parent_node_id=None,
                new_node_name="Topic A",
                content="First orphan topic",
                summary="Topic A summary",
                relationship=""
            ),
            CreateAction(
                action="CREATE",
                parent_node_id=None,
                new_node_name="Topic B",
                content="Second orphan topic",
                summary="Topic B summary",
                relationship=""
            ),
            CreateAction(
                action="CREATE",
                parent_node_id=None,
                new_node_name="Topic C",
                content="Third orphan topic",
                summary="Topic C summary",
                relationship=""
            )
        ]
        
        workflow.append_agent.run.return_value = AppendAgentResult(
            actions=create_actions,
            segments=[
                SegmentModel(reasoning="Topic A", edited_text="A", raw_text="A", is_routable=True),
                SegmentModel(reasoning="Topic B", edited_text="B", raw_text="B", is_routable=True),
                SegmentModel(reasoning="Topic C", edited_text="C", raw_text="C", is_routable=True)
            ]
        )
        
        workflow.optimizer_agent.run.return_value = []
        
        # Act
        with patch('backend.text_to_graph_pipeline.chunk_processing_pipeline.tree_action_decider_workflow.TreeActionApplier') as mock_applier:
            mock_applier_instance = Mock()
            mock_applier_instance.apply.return_value = {2, 3, 4}  # Three separate nodes
            mock_applier.return_value = mock_applier_instance
            
            # Mock the nodes that would be created (all separate)
            node_a = Node(
                name="Topic A",
                node_id=2,
                content="First orphan topic",
                summary="Topic A summary",
                parent_id=None
            )
            node_b = Node(
                name="Topic B",
                node_id=3,
                content="Second orphan topic",
                summary="Topic B summary",
                parent_id=None
            )
            node_c = Node(
                name="Topic C",
                node_id=4,
                content="Third orphan topic",
                summary="Topic C summary",
                parent_id=None
            )
            decision_tree.tree[2] = node_a
            decision_tree.tree[3] = node_b
            decision_tree.tree[4] = node_c
            
            with patch('backend.text_to_graph_pipeline.chunk_processing_pipeline.tree_action_decider_workflow.TextBufferManager') as mock_buffer:
                mock_buffer_instance = Mock()
                mock_buffer_instance.getBuffer.return_value = ""
                mock_buffer.return_value = mock_buffer_instance
                
                result = await workflow.run("Different orphan topics", decision_tree)
        
        # Assert
        mock_applier_instance.apply.assert_called()
        applied_actions = mock_applier_instance.apply.call_args[0][0]
        assert len(applied_actions) == 3  # All three orphans preserved as separate actions
        
        # Verify all actions are CreateActions with different names
        create_actions = [a for a in applied_actions if isinstance(a, CreateAction)]
        assert len(create_actions) == 3
        
        names = [action.new_node_name for action in create_actions]
        assert "Topic A" in names
        assert "Topic B" in names
        assert "Topic C" in names
        
        # Verify all are still orphans
        for action in create_actions:
            assert action.parent_node_id is None
    
    @pytest.mark.asyncio 
    async def test_no_orphans_no_merging(self, workflow, decision_tree):
        """Test that when there are no orphans, no merging happens"""
        # Arrange
        actions = [
            AppendAction(
                action="APPEND",
                target_node_id=1,
                target_node_name="Root",
                content="Appending to root"
            ),
            CreateAction(
                action="CREATE",
                parent_node_id=1,
                new_node_name="Child 1",
                content="First child",
                summary="Child 1 summary",
                relationship="child of"
            ),
            CreateAction(
                action="CREATE",
                parent_node_id=1,
                new_node_name="Child 2",
                content="Second child",
                summary="Child 2 summary",
                relationship="child of"
            )
        ]
        
        workflow.append_agent.run.return_value = AppendAgentResult(
            actions=actions,
            segments=[
                SegmentModel(reasoning="Append", edited_text="Append", raw_text="Append", is_routable=True),
                SegmentModel(reasoning="C1", edited_text="C1", raw_text="C1", is_routable=True),
                SegmentModel(reasoning="C2", edited_text="C2", raw_text="C2", is_routable=True)
            ]
        )
        
        workflow.optimizer_agent.run.return_value = []
        
        # Act
        with patch('backend.text_to_graph_pipeline.chunk_processing_pipeline.tree_action_decider_workflow.TreeActionApplier') as mock_applier:
            mock_applier_instance = Mock()
            mock_applier_instance.apply.return_value = {1, 2, 3}
            mock_applier.return_value = mock_applier_instance
            
            # Mock the nodes that would be created
            # Node 1 already exists (Root)
            child1_node = Node(
                name="Child 1",
                node_id=2,
                content="First child",
                summary="Child 1 summary",
                parent_id=1
            )
            child1_node.relationships[1] = "child of"
            child2_node = Node(
                name="Child 2",
                node_id=3,
                content="Second child",
                summary="Child 2 summary",
                parent_id=1
            )
            child2_node.relationships[1] = "child of"
            decision_tree.tree[2] = child1_node
            decision_tree.tree[3] = child2_node
            
            with patch('backend.text_to_graph_pipeline.chunk_processing_pipeline.tree_action_decider_workflow.TextBufferManager') as mock_buffer:
                mock_buffer_instance = Mock()
                mock_buffer_instance.getBuffer.return_value = ""
                mock_buffer.return_value = mock_buffer_instance
                
                result = await workflow.run("No orphans", decision_tree)
        
        # Assert
        mock_applier_instance.apply.assert_called()
        applied_actions = mock_applier_instance.apply.call_args[0][0]
        assert len(applied_actions) == 3  # All actions preserved
        assert all(a == actions[i] for i, a in enumerate(applied_actions))