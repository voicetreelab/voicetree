"""
Integration test for identify_target_node prompt
Tests that the prompt correctly identifies target nodes for segments
"""

import pytest
import asyncio
from backend.text_to_graph_pipeline.agentic_workflows.core.llm_integration import get_llm
from backend.text_to_graph_pipeline.agentic_workflows.core.prompt_engine import PromptEngine
from backend.text_to_graph_pipeline.agentic_workflows.models import TargetNodeResponse


class TestIdentifyTargetNodePrompt:
    """Test the identify_target_node prompt with real LLM calls"""
    
    @pytest.fixture
    def llm(self):
        """Get LLM instance for testing"""
        return get_llm()
    
    @pytest.fixture 
    def prompt_engine(self):
        """Get prompt engine instance"""
        return PromptEngine()
    
    async def test_existing_node_identification(self, llm, prompt_engine):
        """Test identifying segments that should go to existing nodes"""
        # Test data
        existing_nodes = """
        [
            {"name": "Voice Tree Architecture", "summary": "Overall system design and components"},
            {"name": "Database Design", "summary": "Schema and data model decisions"}
        ]
        """
        
        segments = """
        [
            {"text": "We need to add caching to improve voice tree performance", "is_complete": true},
            {"text": "The database indexes need optimization for faster queries", "is_complete": true}
        ]
        """
        
        # Load and run prompt
        prompt = prompt_engine.load_prompt("identify_target_node")
        messages = prompt_engine.format_prompt(
            prompt,
            existing_nodes=existing_nodes,
            segments=segments
        )
        
        response = await llm.ainvoke(messages)
        result = TargetNodeResponse.model_validate_json(response.content)
        
        # Assertions
        assert len(result.target_nodes) == 2
        
        # First segment about caching should go to Architecture
        assert result.target_nodes[0].target_node_name == "Voice Tree Architecture"
        assert result.target_nodes[0].is_new_node == False
        assert "caching" in result.target_nodes[0].text
        
        # Second segment about DB should go to Database Design  
        assert result.target_nodes[1].target_node_name == "Database Design"
        assert result.target_nodes[1].is_new_node == False
        assert "database" in result.target_nodes[1].text.lower()
    
    async def test_new_node_creation(self, llm, prompt_engine):
        """Test identifying segments that need new nodes"""
        # Test data  
        existing_nodes = """
        [
            {"name": "Backend API", "summary": "REST API implementation"}
        ]
        """
        
        segments = """
        [
            {"text": "We should add user authentication with JWT tokens", "is_complete": true},
            {"text": "Need to implement real-time notifications using WebSockets", "is_complete": true}
        ]
        """
        
        # Load and run prompt
        prompt = prompt_engine.load_prompt("identify_target_node")
        messages = prompt_engine.format_prompt(
            prompt,
            existing_nodes=existing_nodes,
            segments=segments
        )
        
        response = await llm.ainvoke(messages)
        result = TargetNodeResponse.model_validate_json(response.content)
        
        # Assertions
        assert len(result.target_nodes) == 2
        
        # Both should create new nodes since they're new concepts
        assert result.target_nodes[0].is_new_node == True
        assert "auth" in result.target_nodes[0].target_node_name.lower()
        
        assert result.target_nodes[1].is_new_node == True
        assert "notification" in result.target_nodes[1].target_node_name.lower() or \
               "websocket" in result.target_nodes[1].target_node_name.lower()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])