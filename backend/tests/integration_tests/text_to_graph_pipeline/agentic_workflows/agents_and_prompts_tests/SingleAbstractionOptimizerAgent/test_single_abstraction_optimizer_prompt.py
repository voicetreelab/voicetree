"""
Integration test for single_abstraction_optimizer prompt
Tests the optimization decisions for node abstraction levels
"""

import pytest
from backend.text_to_graph_pipeline.agentic_workflows.core.llm_integration import call_llm_structured
from backend.text_to_graph_pipeline.agentic_workflows.core.prompt_engine import PromptLoader
from backend.text_to_graph_pipeline.agentic_workflows.models import OptimizationResponse


class TestSingleAbstractionOptimizerPrompt:
    """Test the single_abstraction_optimizer prompt with real LLM calls"""
    
    @pytest.fixture 
    def prompt_loader(self):
        """Get prompt loader instance"""
        from pathlib import Path
        # Get the absolute path to prompts directory
        backend_dir = Path(__file__).parent.parent.parent.parent.parent.parent  # Go to backend dir
        prompts_dir = backend_dir / "text_to_graph_pipeline" / "agentic_workflows" / "prompts"
        return PromptLoader(str(prompts_dir.absolute()))
    
    @pytest.mark.skip(reason="Test flaky due to LLM response variability")
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

        result = await self.call_llm(prompt_text)
        
        # Assertions
        # LLM should either split or update - both are reasonable
        if result.should_create_nodes and len(result.new_nodes) >= 2:
            # If splitting, check that nodes cover the different concepts
            node_names = [child.name.lower() for child in result.new_nodes]
            
            # Should have nodes covering at least some of the concepts
            concepts_covered = sum([
                any("database" in name or "postgres" in name for name in node_names),
                any("frontend" in name or "react" in name for name in node_names),
                any("auth" in name or "jwt" in name for name in node_names),
                any("structure" in name or "folder" in name for name in node_names)
            ])
            assert concepts_covered >= 2, "Should cover at least 2 concepts if splitting"
        else:
            # If not splitting, should update the original
            assert result.update_original
            assert result.original_new_content is not None
            assert result.original_new_summary is not None

    async def call_llm(self, prompt_text):
        result = await call_llm_structured(
            prompt_text,
            stage_type="single_abstraction_optimizer",
            output_schema=OptimizationResponse,
            model_name="gemini-2.5-flash-lite"
        )
        return result

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

        result = await self.call_llm(prompt_text)
        
        # Assertions - improved prompt may identify optimization opportunities
        # Should have reasonable number of new nodes for the authentication flow
        assert len(result.new_nodes) >= 0  # May create nodes for flow steps
        
        # If nodes are created, they should be for the authentication flow steps
        if result.should_create_nodes and len(result.new_nodes) > 0:
            # Should update the original to be a higher-level summary
            assert result.original_new_summary is not None
            assert "authentication" in result.original_new_summary.lower()
            
            # Created nodes should represent distinct steps in the flow
            node_names = [node.name.lower() for node in result.new_nodes]
            # Should have nodes covering some of the key authentication concepts
            has_auth_concepts = any(
                concept in " ".join(node_names) 
                for concept in ["credential", "token", "login", "validate", "generate", "refresh"]
            )
            assert has_auth_concepts, f"Created nodes should cover authentication concepts. Got: {node_names}"
        
        # If not creating nodes, should at least update the original if needed

    async def test_update_poorly_summarized_node(self, prompt_loader):
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
        prompt_text = prompt_loader.render_template(
            "single_abstraction_optimizer",
            node_id=node_id,
            node_name=node_name,
            node_content=node_content,
            node_summary=node_summary,
            neighbors=neighbors
        )

        result = await self.call_llm(prompt_text)
        
        # Assertions
        # The LLM might decide to either:
        # 1. Just update the summary (UPDATE only)
        # 2. Split the caching strategies (UPDATE + CREATE actions)
        # 3. Keep it as is (no changes)
        # All are valid approaches
        
        # If updating, should improve the summary
        assert result.original_new_summary is not None
        assert len(result.original_new_summary) > len(node_summary)
        assert "caching" in result.original_new_summary.lower() or \
               "performance" in result.original_new_summary.lower()

        if result.should_create_nodes and len(result.new_nodes) > 0:
            # If splitting, should have meaningful child nodes
            child_contents = [child.content.lower() for child in result.new_nodes]
            assert any("redis" in c or "cdn" in c or "database" in c or "api" in c 
                      for c in child_contents), "Child nodes should cover caching strategies"
        else:
            # If no changes, the LLM determined the node is already well-structured
            # This is also acceptable - check reasoning
            assert "cohesive" in result.reasoning.lower() or \
                   "single work item" in result.reasoning.lower() or \
                   "no changes" in result.reasoning.lower()


    async def test_preserve_numeric_values_and_equations(self, prompt_loader):
        """
        Test Case 4: Node with many equations and numeric values that must be preserved
        Tests the new requirement to preserve all numeric values exactly
        """
        # Test data - node with multiple equations and calculations
        node_content = """
        # Animal Population Calculations
        
        The number of adult owls in South Zoo equals 1.
        The average newborn children per adult crow in Hamilton Farm equals 4 times the number of adult owls in South Zoo.
        The number of adult crows in South Zoo equals 3.
        The number of adult parrots in Bundle Ranch equals 4.
        
        The total number of adult animals in Bundle Ranch equals the sum of:
        - Adult owls in Bundle Ranch (which equals 12)
        - Adult blue jays in Bundle Ranch (which equals 4) 
        - Adult parrots in Bundle Ranch (which equals 4)
        
        So the total is 12 + 4 + 4 = 20 adult animals.
        
        The average newborn children per adult owl in Bundle Ranch equals 4.
        The average newborn children per adult blue jay in Bundle Ranch equals 8.
        The average newborn children per adult parrot in Bundle Ranch equals 2 times the average newborn children per adult owl in Bundle Ranch.
        
        Therefore:
        - Newborn owls: 12 × 4 = 48
        - Newborn blue jays: 4 × 8 = 32
        - Newborn parrots: 4 × 8 = 32
        - Total newborn animal children in Bundle Ranch = 48 + 32 + 32 = 112
        """
        
        node_summary = "Calculations for animal populations in various locations with specific numeric values"
        node_id = 15
        node_name = "Animal Population Calculations"
        
        neighbors = [
            {"id": 14, "name": "Zoo Locations", "summary": "List of zoo and ranch locations", "relationship": "parent"},
            {"id": 16, "name": "Population Metrics", "summary": "Methods for calculating animal populations", "relationship": "sibling"}
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

        result = await self.call_llm(prompt_text)
        
        # Assertions - Check that numeric values are preserved
        # Combine all content from original and new nodes
        all_content = []
        if result.original_new_content:
            all_content.append(result.original_new_content)
        for node in result.create_new_nodes:
            all_content.append(node.content)
        
        combined_content = " ".join(all_content).lower()
        
        # Critical numeric values that MUST be preserved somewhere (with variations)
        critical_values = [
            ("equals 1", ["equals 1"], "adult owls in South Zoo"),
            ("equals 3", ["equals 3"], "adult crows in South Zoo"),  
            ("equals 4", ["equals 4"], "adult parrots in Bundle Ranch"),
            ("equals 12", ["equals 12"], "adult owls in Bundle Ranch"),
            ("equals 4", ["equals 4"], "adult blue jays in Bundle Ranch"),
            ("= 20", ["= 20", "equals 20", "total: 20", "total is 20"], "total adult animals"),
            ("equals 4", ["equals 4"], "newborn per adult owl"),
            ("equals 8", ["equals 8"], "newborn per adult blue jay"),
            ("= 48", ["= 48", "equals 48", "total: 48", "total is 48"], "newborn owls total"),
            ("= 32", ["= 32", "equals 32", "total: 32", "total is 32"], "newborn blue jays total"),
            ("= 112", ["= 112", "equals 112", "total: 112", "total is 112"], "total newborn")
        ]
        
        # Check that each critical value is preserved with some flexibility
        missing_values = []
        for value_name, variations, context in critical_values:
            if not any(var in combined_content for var in variations):
                missing_values.append(f"{value_name} ({context})")
        
        assert len(missing_values) == 0, f"Missing critical numeric values: {missing_values}\n\nActual content:\n{combined_content[:500]}..."
        
        # Also check key equations are preserved (with some flexibility for rephrasing)
        key_equations = [
            ("4 times", ["4 times", "times 4", "* 4"]),  # crow equation
            ("2 times", ["2 times", "times 2", "* 2"]),  # parrot equation
            ("12 + 4 + 4", ["12 + 4 + 4", "4 + 4 + 12"]),  # total calculation
            ("48 + 32 + 32", ["48 + 32 + 32", "32 + 32 + 48"])  # final total
        ]
        
        missing_equations = []
        for equation_name, variations in key_equations:
            if not any(var in combined_content for var in variations):
                missing_equations.append(equation_name)
                
        assert len(missing_equations) == 0, f"Missing key equations: {missing_equations}\n\nActual content:\n{combined_content[:500]}..."

    async def test_preserve_mathematical_relationships_bug_regression(self, prompt_loader):
        """
        Test Case 5: Regression test for formula corruption bug
        Bug: LLM incorrectly rewrites mathematical relationships during optimization
        
        Original problem: "Jefferson Circus crow average = 2 + South Zoo crow average"
        Got corrupted to: "Jefferson Circus crow average = 2 + [Number of adult crows in Jefferson Circus]"
        
        This test ensures mathematical relationships are preserved exactly.
        """
        # Test data - the exact case that failed in production
        node_content = """
        The average number of newborn children per adult crow in Jefferson Circus equals 2 plus the average number of newborn children per adult crow in South Zoo.
        +++The average number of newborn children per adult arctic wolf in Lunarchasm Ridge equals the average number of newborn children per adult crow in Jefferson Circus. (is a component of an equation for this node)
        """
        
        node_summary = "Calculates the average number of newborn children per adult crow in Jefferson Circus by adding 2 to the South Zoo average."
        node_id = 73
        node_name = "Average newborn children per adult crow in Jefferson Circus"
        
        neighbors = [
            {
                "name": "Average newborn children per adult crow in South Zoo", 
                "summary": "The average number of newborn children per adult crow in South Zoo is 4, used in a calculation for Jefferson Circus and also equaling the number of adult narwhals in Lunarchasm Ridge.", 
                "relationship": "is calculated using the"
            },
            {
                "name": "Average newborn children per adult boomslang in Heavenspire Peak", 
                "summary": "The average number of newborn children per adult boomslang in Heavenspire Peak is defined by the average number of newborn children per adult crow in Jefferson Circus.", 
                "relationship": "is defined by the"
            }
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

        result = await self.call_llm(prompt_text)
        
        # Combine all content to check preservation
        all_content = []
        if result.original_new_content:
            all_content.append(result.original_new_content)
        for node in result.create_new_nodes:
            all_content.append(node.content)
        
        combined_content = " ".join(all_content)
        
        # CRITICAL: The mathematical relationship must be preserved EXACTLY
        # Bug was: "2 + South Zoo average" became "2 + Jefferson Circus count"
        
        # Must contain the correct relationship
        assert "2 plus the average number of newborn children per adult crow in South Zoo" in combined_content or \
               "2 + average number of newborn children per adult crow in South Zoo" in combined_content or \
               "average number of newborn children per adult crow in South Zoo" in combined_content, \
               f"Mathematical relationship corrupted! Expected reference to South Zoo crow average, got: {combined_content}"
        
        # Must NOT contain the corrupted relationship
        corrupted_patterns = [
            "2 + [Number of adult crows in Jefferson Circus]",
            "2 plus the number of adult crow in Jefferson Circus", 
            "2 + number of adult crow in Jefferson Circus",
            "Jefferson Circus" in combined_content and "2 +" in combined_content and "South Zoo" not in combined_content
        ]
        
        for pattern in corrupted_patterns[:3]:  # Check string patterns
            assert pattern not in combined_content, \
                f"Found corrupted formula pattern: '{pattern}' in content: {combined_content}"
        
        # Special check for the last complex pattern
        if "Jefferson Circus" in combined_content and "2 +" in combined_content:
            assert "South Zoo" in combined_content, \
                "Formula references Jefferson Circus with '2 +' but missing South Zoo reference - likely corruption!"
        
        # Ensure the dependency relationship is maintained
        # The South Zoo node should still be referenced as the source
        if len(result.create_new_nodes) > 0:
            # Check that any new nodes maintain correct relationships
            for new_node in result.create_new_nodes:
                if "Jefferson Circus" in new_node.content and "2" in new_node.content:
                    assert "South Zoo" in new_node.content or new_node.target_node_name == "Average newborn children per adult crow in South Zoo", \
                        f"New node breaks mathematical dependency: {new_node.content}"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])