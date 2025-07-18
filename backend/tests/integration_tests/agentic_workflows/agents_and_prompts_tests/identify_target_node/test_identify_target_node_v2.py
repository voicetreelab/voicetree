"""
Simplified integration test for identify_target_node prompt with node IDs
"""

import pytest
import asyncio
import re
from pathlib import Path
from backend.text_to_graph_pipeline.agentic_workflows.core.prompt_engine import PromptTemplate
from backend.text_to_graph_pipeline.agentic_workflows.core.llm_integration import call_llm
from backend.text_to_graph_pipeline.agentic_workflows.models import TargetNodeResponse


class TestIdentifyTargetNodeV2:
    """Test the improved identify_target_node prompt with direct LLM calls"""
    
    @pytest.fixture
    def prompt_template(self):
        """Load the prompt template"""
        prompt_path = Path(__file__).parent.parent.parent.parent.parent.parent
        prompt_file = prompt_path / "backend/text_to_graph_pipeline/agentic_workflows/prompts/identify_target_node.md"
        return PromptTemplate.from_file(prompt_file)
    
    @pytest.mark.asyncio
    async def test_existing_node_with_ids(self, prompt_template):
        """Test that existing nodes are identified by their IDs"""
        # Format the prompt with test data
        prompt = prompt_template.render(
            existing_nodes='[{"id": 1, "name": "Voice Tree Architecture", "summary": "Overall system design and components"}, {"id": 2, "name": "Database Design", "summary": "Schema and data model decisions"}]',
            segments='[{"text": "We need to add caching to improve voice tree performance", "is_complete": true}]'
        )
        
        # Call LLM
        response = await call_llm(prompt)
        
        # Extract JSON from response (handle code blocks)
        json_match = re.search(r'```json\s*(.*?)\s*```', response, re.DOTALL)
        if json_match:
            json_str = json_match.group(1)
        else:
            json_str = response
        
        # Parse response
        result = TargetNodeResponse.model_validate_json(json_str)
        
        # Assertions
        assert len(result.target_nodes) == 1
        assert result.target_nodes[0].target_node_id == 1  # Should go to Architecture
        assert result.target_nodes[0].is_new_node == False
        assert result.target_nodes[0].new_node_name is None
    
    @pytest.mark.asyncio
    async def test_new_node_creation(self, prompt_template):
        """Test that new nodes get ID -1 and a name"""
        # Format the prompt with test data
        prompt = prompt_template.render(
            existing_nodes='[{"id": 1, "name": "Backend API", "summary": "REST API implementation"}]',
            segments='[{"text": "We should add user authentication with JWT tokens", "is_complete": true}]'
        )
        
        # Call LLM
        response = await call_llm(prompt)
        
        # Extract JSON from response (handle code blocks)
        json_match = re.search(r'```json\s*(.*?)\s*```', response, re.DOTALL)
        if json_match:
            json_str = json_match.group(1)
        else:
            json_str = response
        
        # Parse response
        result = TargetNodeResponse.model_validate_json(json_str)
        
        # Assertions
        assert len(result.target_nodes) == 1
        assert result.target_nodes[0].target_node_id == -1  # New node
        assert result.target_nodes[0].is_new_node == True
        assert result.target_nodes[0].new_node_name is not None
        assert "auth" in result.target_nodes[0].new_node_name.lower()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])