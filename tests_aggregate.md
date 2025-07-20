backend/tests/integration_tests/agentic_workflows/agents_and_prompts_tests
├── AppendToRelevantNodeAgent
│   └── testAppendtoRelevantNodeAgent.py
├── identify_target_node
│   ├── __pycache__
│   │   ├── test_identify_target_node_v2.cpython-311-pytest-8.3.5.pyc
│   │   └── test_identify_target_node_with_ids.cpython-311-pytest-8.3.5.pyc
│   ├── test_identify_target_node_prompt.py
│   ├── test_identify_target_node_v2.py
│   └── test_identify_target_node_with_ids.py
├── SingleAbstractionOptimizerAgent
│   ├── test_single_abstraction_optimizer_prompt.py
│   └── testSingleAbstractionOptimizerAgent.py
└── tree_action_decider
    ├── __pycache__
    │   └── test_tree_action_decider.cpython-311-pytest-8.3.5.pyc
    ├── Drawing 2025-07-16 14.17.16.excalidraw.md
    └── test_tree_action_decider.py

7 directories, 11 files
===== tree_action_decider/test_tree_action_decider.py =====
"""
Tests common input patterns, problems, and invariants.

THis test should test that AppendToRelevantNodeAgent + SingleAbstractionOptimiserAgent work well together, and that the overal flow with both of them gives us the output and behaviours we want.


First, some deterministic inpputs, and deterministic + fuzzy output checking:

- correctly handles WI1, WI2, WI1 case:

End up with two decisions, APPEND WI2 to existing WI2,
WI1 new node attached to WI2. (todo: specify input)


- correctly handles WI1, WI2, WI3 case
- end up with CREATE WI2 to Wi1, APPEND WI1 to existing node 1, append WI 3 to existing node 3. 

These tests will also implicitly also test the following qualities:
- Correctly favours append / create for input where one subchunk is obviously a create, one subchunk is obviously an append 
- Can correctly identify which node to append/create to in obvious case (9 nodes irrelevant, 1 node relevant)
- Actual output has atleast 10% of the words from the input.



Subjective
for the fuzzy requirements, of output being "Good" (node actions represent well), we should use an LLM judge to decide whether the test is red or green. 

- ouutput is generally correct (is a good summarry for the content)
- Title is a good summary of node content
- Summary is a good summary given input transcript 
- Node content is a good content given input transcript 
- Handles overlap correctly (overlap cases)
"""
===== identify_target_node/test_identify_target_node_v2.py =====
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
            segments='[{"text": "We need to add caching to improve voice tree performance", "is_routable": true}]'
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
        assert result.target_nodes[0].is_orphan == False
        assert result.target_nodes[0].new_node_name is None
    
    @pytest.mark.asyncio
    async def test_new_node_creation(self, prompt_template):
        """Test that new nodes get ID -1 and a name"""
        # Format the prompt with test data
        prompt = prompt_template.render(
            existing_nodes='[{"id": 1, "name": "Backend API", "summary": "REST API implementation"}]',
            segments='[{"text": "We should add user authentication with JWT tokens", "is_routable": true}]'
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
        assert result.target_nodes[0].is_orphan == True
        assert result.target_nodes[0].new_node_name is not None
        assert "auth" in result.target_nodes[0].new_node_name.lower()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
===== identify_target_node/test_identify_target_node_prompt.py =====
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
            {"text": "We need to add caching to improve voice tree performance", "is_routable": true},
            {"text": "The database indexes need optimization for faster queries", "is_routable": true}
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
        assert result.target_nodes[0].is_orphan == False
        assert "caching" in result.target_nodes[0].text
        
        # Second segment about DB should go to Database Design  
        assert result.target_nodes[1].target_node_name == "Database Design"
        assert result.target_nodes[1].is_orphan == False
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
            {"text": "We should add user authentication with JWT tokens", "is_routable": true},
            {"text": "Need to implement real-time notifications using WebSockets", "is_routable": true}
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
        assert result.target_nodes[0].is_orphan == True
        assert "auth" in result.target_nodes[0].target_node_name.lower()
        
        assert result.target_nodes[1].is_orphan == True
        assert "notification" in result.target_nodes[1].target_node_name.lower() or \
               "websocket" in result.target_nodes[1].target_node_name.lower()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
===== identify_target_node/test_identify_target_node_with_ids.py =====
"""
Integration test for improved identify_target_node prompt with node IDs
Tests that the prompt correctly identifies target node IDs instead of names
"""

import pytest
import asyncio
import json
from backend.text_to_graph_pipeline.agentic_workflows.core.llm_integration import call_llm
from backend.text_to_graph_pipeline.agentic_workflows.core.prompt_engine import PromptEngine
from backend.text_to_graph_pipeline.agentic_workflows.models import TargetNodeResponse


class TestIdentifyTargetNodeWithIDs:
    """Test the improved identify_target_node prompt that returns node IDs"""
    
    @pytest.fixture 
    def prompt_engine(self):
        """Get prompt engine instance"""
        return PromptEngine()
    
    async def test_existing_node_identification_with_ids(self, prompt_engine):
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
            {"text": "We need to add caching to improve voice tree performance", "is_routable": true},
            {"text": "The database indexes need optimization for faster queries", "is_routable": true}
        ]
        """
        
        # Load and run prompt
        prompt = prompt_engine.load_prompt("identify_target_node")
        messages = prompt_engine.format_prompt(
            prompt,
            existing_nodes=existing_nodes,
            segments=segments
        )
        
        response = await call_llm(messages)
        result = TargetNodeResponse.model_validate_json(response)
        
        # Assertions
        assert len(result.target_nodes) == 2
        
        # First segment about caching should go to Architecture (ID 1)
        assert result.target_nodes[0].target_node_id == 1
        assert result.target_nodes[0].is_orphan == False
        assert "caching" in result.target_nodes[0].text
        
        # Second segment about DB should go to Database Design (ID 2)
        assert result.target_nodes[1].target_node_id == 2
        assert result.target_nodes[1].is_orphan == False
        assert "database" in result.target_nodes[1].text.lower()
    
    async def test_new_node_creation_with_special_id(self, prompt_engine):
        """Test identifying segments that need new nodes using special ID"""
        # Test data  
        existing_nodes = """
        [
            {"id": 1, "name": "Backend API", "summary": "REST API implementation"}
        ]
        """
        
        segments = """
        [
            {"text": "We should add user authentication with JWT tokens", "is_routable": true},
            {"text": "Need to implement real-time notifications using WebSockets", "is_routable": true}
        ]
        """
        
        # Load and run prompt
        prompt = prompt_engine.load_prompt("identify_target_node")
        messages = prompt_engine.format_prompt(
            prompt,
            existing_nodes=existing_nodes,
            segments=segments
        )
        
        response = await call_llm(messages)
        result = TargetNodeResponse.model_validate_json(response)
        
        # Assertions
        assert len(result.target_nodes) == 2
        
        # Both should create new nodes (ID = -1)
        assert result.target_nodes[0].target_node_id == -1
        assert result.target_nodes[0].is_orphan == True
        assert result.target_nodes[0].new_node_name is not None
        assert "auth" in result.target_nodes[0].new_node_name.lower()
        
        assert result.target_nodes[1].target_node_id == -1
        assert result.target_nodes[1].is_orphan == True
        assert result.target_nodes[1].new_node_name is not None
        assert "notification" in result.target_nodes[1].new_node_name.lower() or \
               "websocket" in result.target_nodes[1].new_node_name.lower()
    
    async def test_mixed_existing_and_new_nodes(self, prompt_engine):
        """Test a mix of existing node references and new node creation"""
        existing_nodes = """
        [
            {"id": 5, "name": "Security Features", "summary": "Authentication and authorization systems"},
            {"id": 8, "name": "Performance Optimization", "summary": "Caching, indexing, and optimization strategies"}
        ]
        """
        
        segments = """
        [
            {"text": "Add role-based access control to the existing auth system", "is_routable": true},
            {"text": "Implement distributed tracing for debugging microservices", "is_routable": true},
            {"text": "Database query caching should use Redis for better performance", "is_routable": true}
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
        assert result.target_nodes[0].is_orphan == False
        
        # Second should create new node for distributed tracing
        assert result.target_nodes[1].target_node_id == -1
        assert result.target_nodes[1].is_orphan == True
        assert result.target_nodes[1].new_node_name is not None
        
        # Third should go to Performance Optimization
        assert result.target_nodes[2].target_node_id == 8
        assert result.target_nodes[2].is_orphan == False


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
===== SingleAbstractionOptimizerAgent/testSingleAbstractionOptimizerAgent.py =====
"""
Test some example inputs & outputs,

e.g. TEST CASE 1: a cluttered node

a current 
  bloated node = (A,B,C,D), where the actual 
  true optimal structure is A->B, A-> C, B->D

  (b is a child of a, c is a child of a, d is a
   child of b)

  we want to keep A, and have the following 
  create actions: create(target=A, newNode(B)),
   create(target=A, newNode(C)), 
  create(target=B, newNode(D)).

  
TEST CASE 2: a node which should ideally stay as a single node
cohesive node (A1,A2,A3)

These together form an abstraction which makes more sense to be kept together, because if you split it it actualyl becomes more confusing for the user to understand.


Note, we can't determinisistically test everything, but we can test the structure of the output, that it is producing tree actions that would modify the tree as we ideally want.

"""
===== SingleAbstractionOptimizerAgent/test_single_abstraction_optimizer_prompt.py =====
"""
Integration test for single_abstraction_optimizer prompt
Tests the optimization decisions for node abstraction levels
"""

import pytest
import asyncio
from backend.text_to_graph_pipeline.agentic_workflows.core.llm_integration import get_llm
from backend.text_to_graph_pipeline.agentic_workflows.core.prompt_engine import PromptEngine
from backend.text_to_graph_pipeline.agentic_workflows.models import OptimizationResponse, UpdateAction, CreateAction


class TestSingleAbstractionOptimizerPrompt:
    """Test the single_abstraction_optimizer prompt with real LLM calls"""
    
    @pytest.fixture
    def llm(self):
        """Get LLM instance for testing"""
        return get_llm()
    
    @pytest.fixture 
    def prompt_engine(self):
        """Get prompt engine instance"""
        return PromptEngine()
    
    async def test_split_cluttered_node(self, llm, prompt_engine):
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
    
    async def test_keep_cohesive_node(self, llm, prompt_engine):
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
===== AppendToRelevantNodeAgent/testAppendtoRelevantNodeAgent.py =====


