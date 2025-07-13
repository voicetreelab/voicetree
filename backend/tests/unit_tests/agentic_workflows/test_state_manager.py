"""
Unit tests for VoiceTreeStateManager
"""

import pytest
import json
from pathlib import Path
from unittest.mock import Mock, patch, mock_open, MagicMock
from datetime import datetime
import tempfile
import os

from backend.text_to_graph_pipeline.agentic_workflows.core.state_manager import VoiceTreeStateManager


class TestVoiceTreeStateManager:
    """Test suite for VoiceTreeStateManager class"""
    
    def test_init_without_state_file(self):
        """Test initialization without a state file"""
        manager = VoiceTreeStateManager()
        
        assert manager.state_file is None
        assert manager.nodes == {}
        assert manager.execution_history == []
    
    def test_init_with_new_state_file(self):
        """Test initialization with a new state file path"""
        manager = VoiceTreeStateManager("new_state.json")
        
        assert manager.state_file == Path("new_state.json")
        assert manager.nodes == {}
        assert manager.execution_history == []
    
    @patch('pathlib.Path.exists')
    @patch('builtins.open', new_callable=mock_open, read_data='{"nodes": {"Node1": {"name": "Node1"}}, "execution_history": []}')
    def test_init_with_existing_state_file(self, mock_file, mock_exists):
        """Test initialization with an existing state file"""
        mock_exists.return_value = True
        
        manager = VoiceTreeStateManager("existing_state.json")
        
        assert manager.nodes == {"Node1": {"name": "Node1"}}
        assert manager.execution_history == []
        mock_file.assert_called_once_with(Path("existing_state.json"), 'r')
    
    def test_get_existing_node_names(self):
        """Test getting list of existing node names"""
        manager = VoiceTreeStateManager()
        manager.nodes = {
            "Node1": {"name": "Node1"},
            "Node2": {"name": "Node2"},
            "Node3": {"name": "Node3"}
        }
        
        names = manager.get_existing_node_names()
        
        assert sorted(names) == ["Node1", "Node2", "Node3"]
    
    def test_get_node_summaries_empty(self):
        """Test getting node summaries when no nodes exist"""
        manager = VoiceTreeStateManager()
        
        assert manager.get_node_summaries() == "No existing nodes"
    
    def test_get_node_summaries_with_nodes(self):
        """Test getting formatted node summaries"""
        manager = VoiceTreeStateManager()
        manager.nodes = {
            "Root Node": {
                "name": "Root Node",
                "summary": "Main topic",
                "parent": None
            },
            "Child Node": {
                "name": "Child Node",
                "summary": "Subtopic",
                "parent": "Root Node"
            },
            "Simple Node": {
                "name": "Simple Node"
            }
        }
        
        summaries = manager.get_node_summaries()
        
        assert "- Root Node: Main topic" in summaries
        assert "- Child Node: Subtopic (child of Root Node)" in summaries
        assert "- Simple Node" in summaries
    
    @patch('backend.text_to_graph_pipeline.agentic_workflows.core.state_manager.datetime')
    def test_add_nodes_basic(self, mock_datetime):
        """Test adding new nodes"""
        mock_datetime.now.return_value.isoformat.return_value = "2024-01-01T12:00:00"
        
        manager = VoiceTreeStateManager()
        execution_result = {
            "integration_decisions": [
                {
                    "new_node_name": "Node1",
                    "new_node_summary": "Summary 1",
                    "target_node": None,
                    "content": "Content 1",
                    "name": "chunk1"
                }
            ]
        }
        
        manager.add_nodes(["Node1"], execution_result)
        
        assert "Node1" in manager.nodes
        assert manager.nodes["Node1"]["name"] == "Node1"
        assert manager.nodes["Node1"]["summary"] == "Summary 1"
        assert manager.nodes["Node1"]["created_at"] == "2024-01-01T12:00:00"
        assert len(manager.execution_history) == 1
    
    @patch('backend.text_to_graph_pipeline.agentic_workflows.core.state_manager.datetime')
    def test_add_nodes_with_parent(self, mock_datetime):
        """Test adding nodes with parent relationships"""
        mock_datetime.now.return_value.isoformat.return_value = "2024-01-01T12:00:00"
        
        manager = VoiceTreeStateManager()
        execution_result = {
            "integration_decisions": [
                {
                    "new_node_name": "Child",
                    "target_node": "Parent",
                    "new_node_summary": "Child summary"
                }
            ]
        }
        
        manager.add_nodes(["Child"], execution_result)
        
        assert manager.nodes["Child"]["parent"] == "Parent"
    
    @patch('builtins.open', new_callable=mock_open)
    @patch('backend.text_to_graph_pipeline.agentic_workflows.core.state_manager.datetime')
    def test_add_nodes_saves_state(self, mock_datetime, mock_file):
        """Test that adding nodes saves state when state file is configured"""
        mock_datetime.now.return_value.isoformat.return_value = "2024-01-01T12:00:00"
        
        manager = VoiceTreeStateManager("state.json")
        manager.add_nodes(["Node1"], {})
        
        # Verify save was called
        mock_file.assert_called_with(Path("state.json"), 'w')
    
    def test_add_nodes_no_decision_found(self):
        """Test adding nodes when no matching decision is found"""
        manager = VoiceTreeStateManager()
        execution_result = {"integration_decisions": []}
        
        manager.add_nodes(["Node1"], execution_result)
        
        assert "Node1" in manager.nodes
        assert manager.nodes["Node1"]["summary"] == ""
        assert manager.nodes["Node1"]["parent"] is None
    
    @patch('backend.text_to_graph_pipeline.agentic_workflows.core.state_manager.datetime')
    def test_update_node(self, mock_datetime):
        """Test updating an existing node"""
        mock_datetime.now.return_value.isoformat.return_value = "2024-01-01T13:00:00"
        
        manager = VoiceTreeStateManager()
        manager.nodes = {"Node1": {"name": "Node1", "summary": "Old"}}
        
        manager.update_node("Node1", {"summary": "New", "extra": "data"})
        
        assert manager.nodes["Node1"]["summary"] == "New"
        assert manager.nodes["Node1"]["extra"] == "data"
        assert manager.nodes["Node1"]["updated_at"] == "2024-01-01T13:00:00"
    
    def test_update_node_nonexistent(self):
        """Test updating a node that doesn't exist"""
        manager = VoiceTreeStateManager()
        
        # Should not raise an error
        manager.update_node("NonExistent", {"summary": "New"})
        
        assert "NonExistent" not in manager.nodes
    
    @patch('builtins.open', new_callable=mock_open)
    def test_update_node_saves_state(self, mock_file):
        """Test that updating nodes saves state when state file is configured"""
        manager = VoiceTreeStateManager("state.json")
        manager.nodes = {"Node1": {"name": "Node1"}}
        
        manager.update_node("Node1", {"summary": "New"})
        
        mock_file.assert_called_with(Path("state.json"), 'w')
    
    def test_get_related_nodes(self):
        """Test getting related nodes (parent and children)"""
        manager = VoiceTreeStateManager()
        manager.nodes = {
            "Parent": {"name": "Parent", "parent": None},
            "Target": {"name": "Target", "parent": "Parent"},
            "Child1": {"name": "Child1", "parent": "Target"},
            "Child2": {"name": "Child2", "parent": "Target"},
            "Unrelated": {"name": "Unrelated", "parent": "Other"}
        }
        
        related = manager.get_related_nodes("Target")
        
        assert sorted(related) == ["Child1", "Child2", "Parent"]
    
    def test_get_related_nodes_no_relations(self):
        """Test getting related nodes when node has no relations"""
        manager = VoiceTreeStateManager()
        manager.nodes = {"Isolated": {"name": "Isolated"}}
        
        related = manager.get_related_nodes("Isolated")
        
        assert related == []
    
    @patch('builtins.open', new_callable=mock_open)
    @patch('backend.text_to_graph_pipeline.agentic_workflows.core.state_manager.datetime')
    def test_save_state(self, mock_datetime, mock_file):
        """Test saving state to file"""
        mock_datetime.now.return_value.isoformat.return_value = "2024-01-01T12:00:00"
        
        manager = VoiceTreeStateManager("state.json")
        manager.nodes = {"Node1": {"name": "Node1"}}
        manager.execution_history = [{"test": "data"}]
        
        manager.save_state()
        
        # Verify file was opened for writing
        mock_file.assert_called_once_with(Path("state.json"), 'w')
        
        # Get what was written
        handle = mock_file()
        written_data = ''.join(call.args[0] for call in handle.write.call_args_list)
        data = json.loads(written_data)
        
        assert data["nodes"] == {"Node1": {"name": "Node1"}}
        assert data["execution_history"] == [{"test": "data"}]
        assert data["last_saved"] == "2024-01-01T12:00:00"
    
    def test_save_state_no_file(self):
        """Test save_state when no state file is configured"""
        manager = VoiceTreeStateManager()
        manager.nodes = {"Node1": {"name": "Node1"}}
        
        # Should not raise an error
        manager.save_state()
    
    @patch('pathlib.Path.exists')
    @patch('builtins.open', new_callable=mock_open, read_data='{"nodes": {"Node1": {"name": "Node1"}}, "execution_history": [{"test": "data"}]}')
    def test_load_state(self, mock_file, mock_exists):
        """Test loading state from file"""
        mock_exists.return_value = True
        
        manager = VoiceTreeStateManager()
        manager.state_file = Path("state.json")
        
        manager.load_state()
        
        assert manager.nodes == {"Node1": {"name": "Node1"}}
        assert manager.execution_history == [{"test": "data"}]
        mock_file.assert_called_once_with(Path("state.json"), 'r')
    
    def test_load_state_no_file(self):
        """Test load_state when no state file exists"""
        manager = VoiceTreeStateManager()
        
        # Should not raise an error
        manager.load_state()
        
        assert manager.nodes == {}
    
    def test_clear_state_with_file(self):
        """Test clearing state with file deletion"""
        # Create a real temp file that exists with valid JSON
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump({"nodes": {}, "execution_history": []}, f)
            temp_path = Path(f.name)
        
        try:
            manager = VoiceTreeStateManager(str(temp_path))
            manager.nodes = {"Node1": {"name": "Node1"}}
            manager.execution_history = [{"test": "data"}]
            
            # Verify file exists before clear
            assert temp_path.exists()
            
            manager.clear_state()
            
            assert manager.nodes == {}
            assert manager.execution_history == []
            assert not temp_path.exists()  # File should be deleted
        finally:
            # Cleanup if test fails
            if temp_path.exists():
                temp_path.unlink()
    
    def test_clear_state_no_file(self):
        """Test clearing state without file"""
        manager = VoiceTreeStateManager()
        manager.nodes = {"Node1": {"name": "Node1"}}
        
        manager.clear_state()
        
        assert manager.nodes == {}
        assert manager.execution_history == []
    
    def test_get_statistics(self):
        """Test getting statistics"""
        manager = VoiceTreeStateManager()
        manager.nodes = {
            "Root1": {"name": "Root1", "parent": None},
            "Root2": {"name": "Root2", "parent": None},
            "Child1": {"name": "Child1", "parent": "Root1"},
            "Child2": {"name": "Child2", "parent": "Root1"}
        }
        manager.execution_history = [{"test": 1}, {"test": 2}]
        
        stats = manager.get_statistics()
        
        assert stats["total_nodes"] == 4
        assert stats["total_executions"] == 2
        assert "nodes_by_parent" in stats
        assert "recent_additions" in stats
    
    def test_count_nodes_by_parent(self):
        """Test counting nodes by parent"""
        manager = VoiceTreeStateManager()
        manager.nodes = {
            "Root1": {"name": "Root1", "parent": None},
            "Root2": {"name": "Root2", "parent": None},
            "Child1": {"name": "Child1", "parent": "Root1"},
            "Child2": {"name": "Child2", "parent": "Root1"},
            "Grandchild": {"name": "Grandchild", "parent": "Child1"}
        }
        
        counts = manager._count_nodes_by_parent()
        
        # The implementation uses node_data.get("parent", "root") but None is still None, not "root"
        # Only missing keys become "root"
        assert counts["root"] == 0  # Only nodes without a parent key at all
        assert counts[None] == 2  # Root1 and Root2 have parent=None
        assert counts["Root1"] == 2  # Child1 and Child2
        assert counts["Child1"] == 1  # Grandchild
    
    def test_get_recent_additions(self):
        """Test getting recent node additions"""
        manager = VoiceTreeStateManager()
        manager.nodes = {
            "Old": {"name": "Old", "created_at": "2024-01-01T10:00:00"},
            "Middle": {"name": "Middle", "created_at": "2024-01-01T11:00:00"},
            "New": {"name": "New", "created_at": "2024-01-01T12:00:00"},
            "Newest": {"name": "Newest", "created_at": "2024-01-01T13:00:00"}
        }
        
        recent = manager._get_recent_additions(2)
        
        assert recent == ["Newest", "New"]
    
    def test_get_recent_additions_with_missing_created_at(self):
        """Test getting recent additions when some nodes lack created_at"""
        manager = VoiceTreeStateManager()
        manager.nodes = {
            "No Date": {"name": "No Date"},
            "With Date": {"name": "With Date", "created_at": "2024-01-01T12:00:00"}
        }
        
        recent = manager._get_recent_additions(5)
        
        # Nodes without created_at should be sorted to the end
        assert "With Date" in recent
        assert len(recent) == 2


class TestVoiceTreeStateManagerIntegration:
    """Integration tests using real file operations"""
    
    def test_full_lifecycle_with_real_file(self):
        """Test full lifecycle with actual file operations"""
        # Create temp file path without creating the file yet
        temp_fd, temp_path = tempfile.mkstemp(suffix='.json')
        os.close(temp_fd)  # Close the file descriptor
        os.unlink(temp_path)  # Remove the empty file
        
        try:
            # Create manager and add nodes
            manager1 = VoiceTreeStateManager(temp_path)
            manager1.add_nodes(["Node1"], {
                "integration_decisions": [{
                    "new_node_name": "Node1",
                    "new_node_summary": "Test node"
                }]
            })
            
            # Create new manager instance and verify state persisted
            manager2 = VoiceTreeStateManager(temp_path)
            assert "Node1" in manager2.nodes
            assert manager2.nodes["Node1"]["summary"] == "Test node"
            
            # Clear state
            manager2.clear_state()
            
            # Verify file is deleted
            assert not Path(temp_path).exists()
            
        finally:
            # Cleanup if file still exists
            if Path(temp_path).exists():
                Path(temp_path).unlink()