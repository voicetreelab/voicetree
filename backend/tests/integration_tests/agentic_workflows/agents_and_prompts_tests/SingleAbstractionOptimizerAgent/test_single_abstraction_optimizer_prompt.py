"""
Integration test for single_abstraction_optimizer prompt
Tests the optimization decisions for node abstraction levels
"""

import pytest
import asyncio
from backend.text_to_graph_pipeline.agentic_workflows.core.llm_integration import call_llm_structured
from backend.text_to_graph_pipeline.agentic_workflows.core.prompt_engine import PromptLoader
from backend.text_to_graph_pipeline.agentic_workflows.models import OptimizationResponse, UpdateAction, CreateAction


class TestSingleAbstractionOptimizerPrompt:
    """Test the single_abstraction_optimizer prompt with real LLM calls"""
    
    @pytest.fixture 
    def prompt_loader(self):
        """Get prompt loader instance"""
        return PromptLoader()
    
    async def test_split_cluttered_node(self, prompt_loader):
        """
        Test Case 1: A cluttered node that should be split
        Current bloated node = (A,B,C,D), where optimal is A->B, A->C, B->D
        """
        # Test data - a node with multiple unrelated concepts
        node_content = """
        # Project Planning
        
        We need to set up the initial project structure with proper folders.
        
        The database should use PostgreSQL for better performance with complex queries.
        
        For the frontend, we'll use React with TypeScript for type safety.
        
        The API authentication will use JWT tokens with refresh token rotation.
        """
        
        node_summary = "Project setup including structure, database choice, frontend framework, and authentication"
        node_id = 1
        node_name = "Project Planning"
        
        neighbors = [
            {"id": 2, "name": "Development Tasks", "summary": "List of development tasks", "relationship": "sibling"}
        ]
        
        # Load and run prompt
        prompt_text = prompt_loader.render_template(
            "single_abstraction_optimizer",
            node_id=node_id,
            node_name=node_name,
            node_content=node_content,
            node_summary=node_summary,
            neighbors=neighbors
        )
        
        result = await call_llm_structured(
            prompt_text,
            stage_type="single_abstraction_optimizer",
            output_schema=OptimizationResponse
        )
        
        # Assertions
        assert len(result.optimization_decision.actions) > 0
        
        # Should have UPDATE action for parent and CREATE actions for children
        update_actions = [a for a in result.optimization_decision.actions if isinstance(a, UpdateAction)]
        create_actions = [a for a in result.optimization_decision.actions if isinstance(a, CreateAction)]
        
        assert len(update_actions) == 1  # Should update the parent node
        assert update_actions[0].node_id == node_id
        
        # Should create multiple child nodes
        assert len(create_actions) >= 3
        
        # Check that nodes cover the different concepts
        node_names = [a.new_node_name.lower() for a in create_actions]
        
        # Should have nodes for database, frontend, auth
        assert any("database" in name or "postgres" in name for name in node_names)
        assert any("frontend" in name or "react" in name for name in node_names)
        assert any("auth" in name or "jwt" in name for name in node_names)
    
    async def test_keep_cohesive_node(self, prompt_loader):
        """
        Test Case 2: A cohesive node that should stay as a single node
        Node with related content that forms a single abstraction
        """
        # Test data - a node with cohesive, related content
        node_content = """
        # User Authentication Flow
        
        The authentication process works as follows:
        1. User submits credentials to /api/auth/login
        2. Server validates credentials against the database
        3. If valid, server generates JWT access token (15 min) and refresh token (7 days)
        4. Tokens are returned to client in HTTP-only cookies
        5. Client includes access token in Authorization header for API requests
        6. When access token expires, client uses refresh token to get new access token
        """
        
        node_summary = "Complete authentication flow implementation details"
        node_id = 5
        node_name = "User Authentication Flow"
        
        neighbors = [
            {"id": 4, "name": "Security Requirements", "summary": "Security standards and requirements", "relationship": "parent"},
            {"id": 6, "name": "API Endpoints", "summary": "List of API endpoints", "relationship": "sibling"}
        ]
        
        # Load and run prompt
        prompt_text = prompt_loader.render_template(
            "single_abstraction_optimizer",
            node_id=node_id,
            node_name=node_name,
            node_content=node_content,
            node_summary=node_summary,
            neighbors=neighbors
        )
        
        result = await call_llm_structured(
            prompt_text,
            stage_type="single_abstraction_optimizer",
            output_schema=OptimizationResponse
        )
        
        # Assertions - should not split this cohesive node
        # Could be empty list (no action) or single UPDATE (to improve summary)
        if len(result.optimization_decision.actions) > 0:
            assert len(result.optimization_decision.actions) == 1
            assert isinstance(result.optimization_decision.actions[0], UpdateAction)
            assert result.optimization_decision.actions[0].action == "UPDATE"
            # If updating, should maintain the cohesive nature
            assert "authentication" in result.optimization_decision.actions[0].new_summary.lower()
    
    async def test_update_poorly_summarized_node(self, llm, prompt_engine):
        """Test updating a node with poor summary/content organization"""
        # Test data - node with good content but poor summary
        node_content = """
        We implemented caching at multiple levels:
        - Redis for session data (TTL: 1 hour)
        - CDN for static assets
        - Database query caching with 5 minute TTL
        - API response caching for GET requests
        
        This reduced our average response time from 800ms to 200ms.
        """
        
        node_summary = "Some caching stuff"  # Poor summary
        node_id = 10
        node_name = "Performance Optimization"
        
        neighbors = [
            {"id": 9, "name": "System Architecture", "summary": "Overall system design", "relationship": "parent"}
        ]
        
        # Load and run prompt
        prompt = prompt_engine.load_prompt("single_abstraction_optimizer") 
        messages = prompt_engine.format_prompt(
            prompt,
            node_id=node_id,
            node_name=node_name,
            node_content=node_content,
            node_summary=node_summary,
            neighbors=neighbors
        )
        
        response = await llm.ainvoke(messages)
        result = OptimizationResponse.model_validate_json(response.content)
        
        # Assertions
        assert len(result.optimization_decision.actions) > 0
        
        # Should have exactly one UPDATE action
        assert len(result.optimization_decision.actions) == 1
        action = result.optimization_decision.actions[0]
        assert isinstance(action, UpdateAction)
        
        # Should improve the summary
        assert len(action.new_summary) > len(node_summary)
        assert "caching" in action.new_summary.lower()
        # Should mention the performance improvement
        assert any(word in action.new_summary.lower() 
                  for word in ["performance", "response", "optimization", "200ms", "speed"])


if __name__ == "__main__":
    pytest.main([__file__, "-v"])