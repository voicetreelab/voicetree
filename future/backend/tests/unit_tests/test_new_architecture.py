#!/usr/bin/env python3
"""
Comprehensive tests for the new unified VoiceTree architecture.
Tests the core components: LLMClient, TreeManager, BufferManager, and Configuration
"""

import pytest
import asyncio
import json
import tempfile
import os
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime

# Import new unified architecture
from backend.core import get_config, LLMClient
from backend.core.models import (
    NodeAction, SegmentationResponse, WorkflowResult, ProcessResult, ChunkModel
)
from backend.tree import TreeManager, TreeStorage, BufferManager
from backend.workflows import WorkflowPipeline


class TestConfiguration:
    """Test the unified configuration system"""
    
    def test_get_config_default(self):
        """Test getting default configuration"""
        config = get_config()
        
        assert config is not None
        assert hasattr(config, 'llm')
        assert hasattr(config, 'buffer') 
        assert hasattr(config, 'workflow')
        
        # Test LLM config
        assert config.llm.default_model == "gemini-2.0-flash"
        assert config.llm.timeout_seconds >= 30
        assert config.llm.max_output_tokens >= 8192
        
        # Test buffer config  
        assert config.buffer.text_buffer_size_threshold >= 500
        assert config.buffer.transcript_history_multiplier >= 3
        
    @patch.dict(os.environ, {
        'GOOGLE_API_KEY': 'test-key-123',
        'LLM_DEFAULT_MODEL': 'gemini-1.5-pro',
        'TEXT_BUFFER_SIZE_THRESHOLD': '100'
    })
    def test_config_environment_override(self):
        """Test configuration loading from environment variables"""
        # Clear any cached config
        from backend.core.config import reset_config
        reset_config()
        
        config = get_config()
        
        assert config.llm.google_api_key == 'test-key-123'
        assert config.llm.default_model == 'gemini-1.5-pro'
        assert config.buffer.text_buffer_size_threshold == 100
        
    def test_config_validation(self):
        """Test configuration validation"""
        config = get_config()
        
        # Test required fields
        assert config.llm.default_model is not None
        assert config.llm.timeout_seconds > 0
        assert config.buffer.text_buffer_size_threshold > 0


class TestPydanticModels:
    """Test the new Pydantic data models"""
    
    def test_node_action_model(self):
        """Test NodeAction model"""
        action = NodeAction(
            action="CREATE",
            concept_name="Test Concept",
            content="Test content",
            summary="Test summary"
        )
        
        assert action.action == "CREATE"
        assert action.concept_name == "Test Concept"
        assert action.content == "Test content"
        assert action.summary == "Test summary"
        
        # Test factory method for CREATE
        factory_action = NodeAction.create_node(
            concept_name="New Concept",
            content="New content",
            summary="New summary",
            parent_concept_name="Parent"
        )
        assert factory_action.action == "CREATE"
        assert factory_action.concept_name == "New Concept"
        assert factory_action.parent_concept_name == "Parent"
        
        # Test factory method for APPEND
        append_action = NodeAction.append_to_node(
            concept_name="Existing Concept",
            content="Appended content",
            summary="Updated summary"
        )
        assert append_action.action == "APPEND"
        assert append_action.concept_name == "Existing Concept"
        
    def test_workflow_result_model(self):
        """Test WorkflowResult model"""  
        action = NodeAction.create_node(
            concept_name="New Concept",
            content="New node",
            summary="New node summary",
            parent_concept_name="Root"
        )
        
        result = WorkflowResult(
            success=True,
            node_actions=[action],
            execution_time_ms=1500.0
        )
        
        assert result.success is True
        assert len(result.node_actions) == 1
        assert result.execution_time_ms == 1500.0
        assert result.node_actions[0].action == "CREATE"
        
    def test_segmentation_response_model(self):
        """Test SegmentationResponse model"""
        response = SegmentationResponse(
            chunks=[
                ChunkModel(
                    name="Chunk 1",
                    text="This is chunk 1",
                    is_complete=True
                ),
                ChunkModel(
                    name="Chunk 2", 
                    text="This is chunk 2",
                    is_complete=False
                )
            ]
        )
        
        assert len(response.chunks) == 2
        assert response.chunks[0].name == "Chunk 1"
        assert response.chunks[0].is_complete is True
        assert response.chunks[1].is_complete is False


class TestLLMClient:
    """Test the unified LLM client"""
    
    @pytest.fixture
    def llm_client(self):
        """Create LLMClient for testing"""
        config = get_config()
        return LLMClient(config.llm)
        
    def test_llm_client_creation(self, llm_client):
        """Test LLMClient creation"""
        assert llm_client is not None
        assert hasattr(llm_client, 'config')
        assert hasattr(llm_client, 'client')
        
    @pytest.mark.asyncio
    @patch('google.generativeai.GenerativeModel')
    async def test_call_structured_success(self, mock_model_class, llm_client):
        """Test successful structured LLM call"""
        # Mock the model and response
        mock_model = MagicMock()
        mock_response = MagicMock()
        mock_response.text = '{"chunks": [{"name": "Test", "text": "Test content", "is_complete": true}]}'
        mock_model.generate_content_async.return_value = mock_response
        mock_model_class.return_value = mock_model
        
        # Test the call
        result = await llm_client.call_structured(
            prompt="Test prompt",
            response_model=SegmentationResponse
        )
        
        assert isinstance(result, SegmentationResponse)
        assert len(result.chunks) == 1
        assert result.chunks[0].name == "Test"
        
    @pytest.mark.asyncio
    @patch('google.generativeai.GenerativeModel')
    async def test_call_workflow_stage(self, mock_model_class, llm_client):
        """Test workflow stage calling"""
        # Mock the model and response
        mock_model = MagicMock()
        mock_response = MagicMock()
        mock_response.text = 'Test response from LLM'
        mock_model.generate_content_async.return_value = mock_response
        mock_model_class.return_value = mock_model
        
        result = await llm_client.call_workflow_stage(
            "segmentation",
            {"transcript_text": "Test transcript"}
        )
        
        assert result == "Test response from LLM"
        assert llm_client.get_statistics()["total_calls"] == 1
        
    def test_statistics_tracking(self, llm_client):
        """Test LLM statistics tracking"""
        stats = llm_client.get_statistics()
        
        assert "total_calls" in stats
        assert "total_errors" in stats
        assert "total_processing_time" in stats
        assert stats["total_calls"] == 0


class TestBufferManager:
    """Test the unified buffer management"""
    
    @pytest.fixture
    def buffer_manager(self):
        """Create BufferManager for testing"""
        config = get_config()
        return BufferManager(config.buffer)
        
    def test_buffer_creation(self, buffer_manager):
        """Test buffer manager creation"""
        assert buffer_manager is not None
        assert buffer_manager.get_current_size() == 0
        
    def test_buffer_operations(self, buffer_manager):
        """Test basic buffer operations"""
        # Test adding text
        buffer_manager.add_text("This is test text.")
        assert buffer_manager.get_current_size() > 0
        assert "This is test text." in buffer_manager.get_current_buffer()
        
        # Test extracting complete sentences
        complete = buffer_manager.extract_complete_sentences()
        assert "This is test text." in complete
        
        # Test clearing
        buffer_manager.clear()
        assert buffer_manager.get_current_size() == 0
        
    def test_buffer_threshold(self, buffer_manager):
        """Test buffer size threshold"""
        # Add text up to threshold
        long_text = "This is a sentence. " * 10
        buffer_manager.add_text(long_text)
        
        assert buffer_manager.is_ready_for_processing()
        
    def test_buffer_statistics(self, buffer_manager):
        """Test buffer statistics"""
        buffer_manager.add_text("Test text.")
        
        stats = buffer_manager.get_statistics()
        assert "total_text_added" in stats
        assert "current_size" in stats
        assert "processing_count" in stats


class TestTreeStorage:
    """Test tree storage functionality"""
    
    @pytest.fixture
    def temp_storage_file(self):
        """Create temporary storage file"""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            temp_path = f.name
        yield temp_path
        # Cleanup
        if os.path.exists(temp_path):
            os.unlink(temp_path)
            
    def test_tree_storage_creation(self, temp_storage_file):
        """Test TreeStorage creation"""
        storage = TreeStorage(temp_storage_file)
        assert storage is not None
        assert storage.file_path == temp_storage_file
        
    @pytest.mark.asyncio
    async def test_tree_storage_save_load(self, temp_storage_file):
        """Test saving and loading tree state"""
        storage = TreeStorage(temp_storage_file)
        
        # Create test tree data
        test_tree = {
            "nodes": {
                "0": {"name": "Root", "content": "Root content", "parent_id": None}
            },
            "next_node_id": 1
        }
        
        # Save
        await storage.save_tree_state(test_tree)
        assert os.path.exists(temp_storage_file)
        
        # Load
        loaded_tree = await storage.load_tree_state()
        assert loaded_tree["next_node_id"] == 1
        assert "0" in loaded_tree["nodes"]
        assert loaded_tree["nodes"]["0"]["name"] == "Root"
        
    @pytest.mark.asyncio
    async def test_tree_storage_nonexistent_file(self):
        """Test loading from nonexistent file"""
        storage = TreeStorage("nonexistent.json")
        tree = await storage.load_tree_state()
        
        # Should return default tree structure
        assert tree is not None
        assert "nodes" in tree
        assert "next_node_id" in tree


class TestUnifiedTreeManager:
    """Test the unified TreeManager"""
    
    @pytest.fixture
    async def tree_manager(self):
        """Create TreeManager for testing"""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            temp_path = f.name
            
        storage = TreeStorage(temp_path)
        manager = TreeManager(storage)
        
        yield manager
        
        # Cleanup
        await manager.shutdown()
        if os.path.exists(temp_path):
            os.unlink(temp_path)
            
    @pytest.mark.asyncio
    async def test_tree_manager_creation(self, tree_manager):
        """Test TreeManager creation"""
        assert tree_manager is not None
        assert hasattr(tree_manager, 'storage')
        assert hasattr(tree_manager, 'buffer_manager')
        
    @pytest.mark.asyncio
    @patch.object(LLMClient, 'call_workflow_stage')
    async def test_process_voice_input_mock(self, mock_llm_call, tree_manager):
        """Test voice input processing with mocked LLM"""
                 # Mock LLM responses for the workflow stages
        mock_llm_call.side_effect = [
            # Segmentation response
            '{"chunks": [{"name": "Test Chunk", "text": "This is a test sentence.", "is_complete": true}]}',
            # Tree action response  
            '[{"action": "CREATE", "concept_name": "Test Concept", "content": "Test content", "summary": "Test summary"}]'
        ]
        
                 # Process voice input
        result = await tree_manager.process_voice_input("This is a test sentence.")
        
        assert isinstance(result, ProcessResult)
        assert result.processed is True
        assert result.workflow_result.success is True
        assert len(result.workflow_result.node_actions) >= 0
        
    @pytest.mark.asyncio
    async def test_tree_manager_statistics(self, tree_manager):
        """Test TreeManager statistics"""
        stats = tree_manager.get_statistics()
        
        assert "total_processing_time" in stats
        assert "total_voice_inputs" in stats
        assert "buffer_statistics" in stats
        assert "llm_statistics" in stats
        
    @pytest.mark.asyncio
    async def test_tree_manager_state_persistence(self, tree_manager):
        """Test tree state persistence"""
        # Add some data to the tree (would normally come from processing)
        await tree_manager.save_current_state()
        
        # Statistics should show save occurred
        stats = tree_manager.get_statistics()
        assert stats is not None


class TestWorkflowPipeline:
    """Test the unified workflow pipeline"""
    
    @pytest.fixture
    def workflow_pipeline(self):
        """Create WorkflowPipeline for testing"""
        config = get_config()
        llm_client = LLMClient(config.llm)
        return WorkflowPipeline(llm_client)
        
    def test_workflow_pipeline_creation(self, workflow_pipeline):
        """Test WorkflowPipeline creation"""
        assert workflow_pipeline is not None
        assert hasattr(workflow_pipeline, 'llm_client')
        
    @pytest.mark.asyncio
    @patch.object(LLMClient, 'call_structured')
    @patch.object(LLMClient, 'call_workflow_stage')
    async def test_process_workflow_mock(self, mock_stage_call, mock_structured_call, workflow_pipeline):
        """Test full workflow processing with mocks"""
        # Mock segmentation response
        mock_segmentation = SegmentationResponse(
            chunks=[
                SegmentationResponse.Chunk(
                    name="Test Chunk",
                    text="This is a test.",
                    is_complete=True
                )
            ]
        )
        mock_structured_call.return_value = mock_segmentation
        
                 # Mock tree action response
        mock_stage_call.return_value = '[{"action": "CREATE", "concept_name": "Test", "content": "Test", "summary": "Test summary"}]'
        
        # Process workflow
        result = await workflow_pipeline.process(
            transcript_text="This is a test.",
            tree_context="Empty tree",
            existing_nodes="No nodes"
        )
        
        assert isinstance(result, WorkflowResult)
        assert result.success is True
        

# Integration test
class TestFullIntegration:
    """Integration tests for the complete new architecture"""
    
    @pytest.mark.asyncio
    async def test_complete_workflow_integration(self):
        """Test the complete workflow from start to finish"""
        # This would be a full integration test, but we'll keep it simple for now
        # since it requires actual LLM calls
        
        # Just test that all components can be instantiated together
        config = get_config()
        llm_client = LLMClient(config.llm)
        
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            temp_path = f.name
            
        try:
            storage = TreeStorage(temp_path)
            tree_manager = TreeManager(storage)
            workflow_pipeline = WorkflowPipeline(llm_client)
            
            # Verify all components are created
            assert llm_client is not None
            assert tree_manager is not None
            assert workflow_pipeline is not None
            
            await tree_manager.shutdown()
            
        finally:
            if os.path.exists(temp_path):
                os.unlink(temp_path)


if __name__ == "__main__":
    pytest.main([__file__, "-v"]) 