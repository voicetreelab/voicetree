"""
Integration test for improved identify_target_node prompt with node IDs
Tests that the prompt correctly identifies target node IDs instead of names
"""

import pytest
import asyncio
import json
from backend.text_to_graph_pipeline.agentic_workflows.core.llm_integration import call_llm_structured
from backend.text_to_graph_pipeline.agentic_workflows.core.prompt_engine import PromptLoader
from backend.text_to_graph_pipeline.agentic_workflows.models import TargetNodeResponse


class TestIdentifyTargetNodeWithIDs:
    """Test the improved identify_target_node prompt that returns node IDs"""
    
    @pytest.fixture 
    def prompt_loader(self):
        """Get prompt loader instance"""
        return PromptLoader()
    
    async def test_existing_node_identification_with_ids(self, prompt_loader):
        """Test identifying segments that should go to existing nodes using IDs"""
        # Test data - now includes node IDs
        existing_nodes = """
        [
            {"id": 1, "name": "Voice Tree Architecture", "summary": "Overall system design and components"},
            {"id": 2, "name": "Database Design", "summary": "Schema and data model decisions"}
        ]
        """
        
        segments = """
        [
            {"text": "We need to add caching to improve voice tree performance", "is_complete": true},
            {"text": "The database indexes need optimization for faster queries", "is_complete": true}
        ]
        """
        
        # Load and run prompt
        prompt_text = prompt_loader.render_template(
            "identify_target_node",
            existing_nodes=existing_nodes,
            segments=segments
        )
        
        result = await call_llm_structured(
            prompt_text,
            stage_type="identify_target_node",
            output_schema=TargetNodeResponse
        )
        
        # Assertions
        assert len(result.target_nodes) == 2
        
        # First segment about caching should go to Architecture (ID 1)
        assert result.target_nodes[0].target_node_id == 1
        assert result.target_nodes[0].is_new_node == False
        assert "caching" in result.target_nodes[0].text
        
        # Second segment about DB should go to Database Design (ID 2)
        assert result.target_nodes[1].target_node_id == 2
        assert result.target_nodes[1].is_new_node == False
        assert "database" in result.target_nodes[1].text.lower()
    
    async def test_new_node_creation_with_special_id(self, prompt_loader):
        """Test identifying segments that need new nodes using special ID"""
        # Test data  
        existing_nodes = """
        [
            {"id": 1, "name": "Backend API", "summary": "REST API implementation"}
        ]
        """
        
        segments = """
        [
            {"text": "We should add user authentication with JWT tokens", "is_complete": true},
            {"text": "Need to implement real-time notifications using WebSockets", "is_complete": true}
        ]
        """
        
        # Load and run prompt
        prompt_text = prompt_loader.render_template(
            "identify_target_node",
            existing_nodes=existing_nodes,
            segments=segments
        )
        
        result = await call_llm_structured(
            prompt_text,
            stage_type="identify_target_node",
            output_schema=TargetNodeResponse
        )
        
        # Assertions
        assert len(result.target_nodes) == 2
        
        # Both should create new nodes (ID = -1)
        assert result.target_nodes[0].target_node_id == -1
        assert result.target_nodes[0].is_new_node == True
        assert result.target_nodes[0].new_node_name is not None
        assert "auth" in result.target_nodes[0].new_node_name.lower()
        
        assert result.target_nodes[1].target_node_id == -1
        assert result.target_nodes[1].is_new_node == True
        assert result.target_nodes[1].new_node_name is not None
        assert "notification" in result.target_nodes[1].new_node_name.lower() or \
               "websocket" in result.target_nodes[1].new_node_name.lower()
    
    async def test_mixed_existing_and_new_nodes(self, prompt_loader):
        """Test a mix of existing node references and new node creation"""
        existing_nodes = """
        [
            {"id": 5, "name": "Security Features", "summary": "Authentication and authorization systems"},
            {"id": 8, "name": "Performance Optimization", "summary": "Caching, indexing, and optimization strategies"}
        ]
        """
        
        segments = """
        [
            {"text": "Add role-based access control to the existing auth system", "is_complete": true},
            {"text": "Implement distributed tracing for debugging microservices", "is_complete": true},
            {"text": "Database query caching should use Redis for better performance", "is_complete": true}
        ]
        """
        
        prompt = prompt_engine.load_prompt("identify_target_node")
        messages = prompt_engine.format_prompt(
            prompt,
            existing_nodes=existing_nodes,
            segments=segments
        )
        
        response = await call_llm(messages)
        result = TargetNodeResponse.model_validate_json(response)
        
        assert len(result.target_nodes) == 3
        
        # First should go to Security Features
        assert result.target_nodes[0].target_node_id == 5
        assert result.target_nodes[0].is_new_node == False
        
        # Second should create new node for distributed tracing
        assert result.target_nodes[1].target_node_id == -1
        assert result.target_nodes[1].is_new_node == True
        assert result.target_nodes[1].new_node_name is not None
        
        # Third should go to Performance Optimization
        assert result.target_nodes[2].target_node_id == 8
        assert result.target_nodes[2].is_new_node == False


if __name__ == "__main__":
    pytest.main([__file__, "-v"])