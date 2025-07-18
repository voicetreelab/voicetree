# Aggregated Changes from Last 1 Commits

Generated on: Fri Jul 18 12:58:27 CEST 2025

## List of files changed:
aggregate_changes.sh,backend/tests/integration_tests/agentic_workflows/agents_and_prompts_tests/AppendToRelevantNodeAgent/testAppendtoRelevantNodeAgent.py,backend/tests/integration_tests/agentic_workflows/agents_and_prompts_tests/identify_target_node/test_identify_target_node_prompt.py,backend/tests/integration_tests/agentic_workflows/agents_and_prompts_tests/identify_target_node/test_identify_target_node_v2.py,backend/tests/integration_tests/agentic_workflows/agents_and_prompts_tests/identify_target_node/test_identify_target_node_with_ids.py,backend/tests/integration_tests/agentic_workflows/agents_and_prompts_tests/SingleAbstractionOptimizerAgent/test_single_abstraction_optimizer_prompt.py,backend/tests/integration_tests/agentic_workflows/agents_and_prompts_tests/SingleAbstractionOptimizerAgent/testSingleAbstractionOptimizerAgent.py,backend/tests/integration_tests/agentic_workflows/agents_and_prompts_tests/tree_action_decider/Drawing 2025-07-16 14.17.16.excalidraw.md,backend/tests/integration_tests/agentic_workflows/agents_and_prompts_tests/tree_action_decider/test_tree_action_decider.py,backend/tests/integration_tests/agentic_workflows/AppendToRelevantNodeAgent/testAppendtoRelevantNodeAgent.py,backend/tests/integration_tests/agentic_workflows/SingleAbstractionOptimizerAgent/testSingleAbstractionOptimizerAgent.py,backend/tests/unit_tests/agentic_workflows/test_models_with_node_ids.py,backend/tests/unit_tests/test_decision_tree_ds.py,backend/tests/unit_tests/test_summary_generation.py,backend/tests/unit_tests/test_tree_action_applier_with_ids.py,backend/tests/unit_tests/test_unified_action_model.py,backend/text_to_graph_pipeline/agentic_workflows/improvements.md,backend/text_to_graph_pipeline/agentic_workflows/models.py,backend/text_to_graph_pipeline/agentic_workflows/new_pipeline_implementation_plan.md,backend/text_to_graph_pipeline/agentic_workflows/prompts/identify_target_node.md,backend/text_to_graph_pipeline/chunk_processing_pipeline/apply_tree_actions.py,backend/text_to_graph_pipeline/tree_manager/decision_tree_ds.py,tests_aggregate.md,tools/PackageProjectForLLM.py

---

## Filename: aggregate_changes.sh

```
#!/bin/bash

# Check if number of commits is provided
if [ $# -eq 0 ]; then
    echo "Usage: $0 <number_of_commits>"
    exit 1
fi

N=$1
OUTPUT_FILE="aggregated_changes.md"

# Validate that N is a positive integer
if ! [[ "$N" =~ ^[0-9]+$ ]] || [ "$N" -eq 0 ]; then
    echo "Error: Please provide a positive integer for the number of commits"
    exit 1
fi

# Get list of changed files in the last N commits
echo "# Aggregated Changes from Last $N Commits" > "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"
echo "Generated on: $(date)" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

# Get unique files changed in last N commits, excluding the output file itself
FILES=$(git diff --name-only HEAD~$N HEAD 2>/dev/null | grep -v "^${OUTPUT_FILE}$" | sort | uniq)

if [ -z "$FILES" ]; then
    echo "No files changed in the last $N commits." >> "$OUTPUT_FILE"
    exit 0
fi

# Create comma-separated list
FILES_LIST=$(echo "$FILES" | tr '\n' ',' | sed 's/,$//')

echo "## List of files changed:" >> "$OUTPUT_FILE"
echo "$FILES_LIST" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"
echo "---" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

# Process each file
for FILE in $FILES; do
    echo "## Filename: $FILE" >> "$OUTPUT_FILE"
    echo "" >> "$OUTPUT_FILE"
    
    if [ -f "$FILE" ]; then
        echo '```' >> "$OUTPUT_FILE"
        cat "$FILE" >> "$OUTPUT_FILE"
        echo '```' >> "$OUTPUT_FILE"
    else
        echo "*File no longer exists in current working tree*" >> "$OUTPUT_FILE"
    fi
    
    echo "" >> "$OUTPUT_FILE"
    echo "-----------" >> "$OUTPUT_FILE"
    echo "" >> "$OUTPUT_FILE"
done

echo "Aggregated changes written to $OUTPUT_FILE"```

-----------

## Filename: backend/tests/integration_tests/agentic_workflows/agents_and_prompts_tests/AppendToRelevantNodeAgent/testAppendtoRelevantNodeAgent.py

```
# Test Outline for AppendToRelevantNodeAgent
#
# Goal: Verify this agent correctly identifies target nodes and produces
# a list of node IDs that have been appended to.
#
# This agent's responsibilities:
# 1. Take a list of text segments.
# 2. For each segment, decide if it should be appended to an existing node or create a new one.
# 3. Apply these append/create actions to the tree.
# 4. Return the set of node IDs that were modified (appended to or newly created).

class TestAppendToRelevantNodeAgent:

    # Test Case 1: Simple Append
    # Behavior: A new thought clearly relates to an existing node.
    # Setup:
    # - Tree has one node: {id: 1, name: "Database Design"}
    # - Input text: "We need to add an index to the users table for performance."
    # Expected Outcome:
    # - The text is appended to node 1.
    # - The agent's output is {"modified_node_ids": {1}}.

    # Test Case 2: Simple Create
    # Behavior: A new thought is unrelated to any existing node.
    # Setup:
    # - Tree has one node: {id: 1, name: "Database Design"}
    # - Input text: "Let's set up the new CI/CD pipeline using GitHub Actions."
    # Expected Outcome:
    # - A new node is created (e.g., id: 2, name: "CI/CD Pipeline").
    # - The text is the content of this new node.
    # - The new node's parent is the root (or another logical choice).
    # - The agent's output is {"modified_node_ids": {2}}.  (Or {1, 2} if parent is 1)

    # Test Case 3: Mixed Append and Create
    # Behavior: A conversation covers both existing and new topics.
    # Setup:
    # - Tree has one node: {id: 1, name: "User Authentication"}
    # - Input segments:
    #   1. "We should enforce stronger password policies."
    #   2. "Also, we need to set up rate limiting on the API."
    # Expected Outcome:
    # - Segment 1 is appended to node 1.
    # - Segment 2 creates a new node (e.g., id: 2, name: "API Rate Limiting").
    # - The agent's output is {"modified_node_ids": {1, 2}}.

    # Test Case 4: No Relevant Nodes (Root Creation)
    # Behavior: The tree is empty, all new thoughts should become new root nodes.
    # Setup:
    # - Tree is empty.
    # - Input segments:
    #   1. "First, let's define the project requirements."
    #   2. "Second, we need to choose a tech stack."
    # Expected Outcome:
    # - Two new nodes are created (e.g., id: 1 and id: 2).
    # - Both nodes have no parent.
    # - The agent's output is {"modified_node_ids": {1, 2}}.

    # Test Case 5: Choosing the More Relevant of Two Nodes
    # Behavior: The agent correctly distinguishes between two related but distinct topics.
    # Setup:
    # - Tree has two nodes:
    #   - {id: 1, name: "API Security"}
    #   - {id: 2, name: "Database Performance"}
    # - Input text: "We must protect against SQL injection on all endpoints."
    # Expected Outcome:
    # - Text is appended to node 1 ("API Security").
    # - The agent's output is {"modified_node_ids": {1}}.```

-----------

## Filename: backend/tests/integration_tests/agentic_workflows/agents_and_prompts_tests/identify_target_node/test_identify_target_node_prompt.py

```
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
    pytest.main([__file__, "-v"])```

-----------

## Filename: backend/tests/integration_tests/agentic_workflows/agents_and_prompts_tests/identify_target_node/test_identify_target_node_v2.py

```
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
    pytest.main([__file__, "-v"])```

-----------

## Filename: backend/tests/integration_tests/agentic_workflows/agents_and_prompts_tests/identify_target_node/test_identify_target_node_with_ids.py

```
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
        
        response = await call_llm(messages)
        result = TargetNodeResponse.model_validate_json(response)
        
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
        
        response = await call_llm(messages)
        result = TargetNodeResponse.model_validate_json(response)
        
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
    pytest.main([__file__, "-v"])```

-----------

## Filename: backend/tests/integration_tests/agentic_workflows/agents_and_prompts_tests/SingleAbstractionOptimizerAgent/test_single_abstraction_optimizer_prompt.py

```
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
    pytest.main([__file__, "-v"])```

-----------

## Filename: backend/tests/integration_tests/agentic_workflows/agents_and_prompts_tests/SingleAbstractionOptimizerAgent/testSingleAbstractionOptimizerAgent.py

```
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

# Test Outline for SingleAbstractionOptimizerAgent
#
# Goal: Verify this agent correctly analyzes a single node and proposes
#       the optimal structural changes (or no changes).
#
# This agent's responsibilities:
# 1. Take a single node ID as input.
# 2. Analyze its content, summary, and neighbors.
# 3. Output a list of actions (UpdateAction, CreateAction) to refactor the node.

class TestSingleAbstractionOptimizerAgent:

    # Test Case 1: The "Junk Drawer" Split
    # Behavior: A node contains multiple unrelated topics and should be split.
    # Setup:
    # - Input Node: {id: 1, name: "Meeting Notes", content: "We decided to use React for the frontend. The database needs a new index. Also, we need to hire a new designer."}
    # Expected Actions:
    # - One UpdateAction for node 1, changing its content/summary to be a high-level container.
    # - Three CreateActions, creating new child nodes for "Frontend Choice", "Database Optimization", and "Hiring", with the relevant text moved into each. The target_node_id for all three should be 1.

    # Test Case 2: The Cohesive Node
    # Behavior: A node's content is thematically tight and should not be changed.
    # Setup:
    # - Input Node: {id: 5, name: "User Login Flow", content: "1. User enters credentials. 2. Server validates. 3. Server issues JWT. 4. Client stores token."}
    # Expected Actions:
    # - The list of actions is empty. The agent correctly determines no refactoring is needed.

    # Test Case 3: The Simple Cleanup (Update Only)
    # Behavior: A node is cohesive, but its name/summary is poor or its content is disorganized.
    # Setup:
    # - Input Node: {id: 10, name: "Stuff", content: "```

-----------

## Filename: backend/tests/integration_tests/agentic_workflows/agents_and_prompts_tests/tree_action_decider/Drawing

*File no longer exists in current working tree*

-----------

## Filename: 2025-07-16

*File no longer exists in current working tree*

-----------

## Filename: 14.17.16.excalidraw.md

*File no longer exists in current working tree*

-----------

## Filename: backend/tests/integration_tests/agentic_workflows/agents_and_prompts_tests/tree_action_decider/test_tree_action_decider.py

```
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
"""```

-----------

## Filename: backend/tests/integration_tests/agentic_workflows/AppendToRelevantNodeAgent/testAppendtoRelevantNodeAgent.py

*File no longer exists in current working tree*

-----------

## Filename: backend/tests/integration_tests/agentic_workflows/SingleAbstractionOptimizerAgent/testSingleAbstractionOptimizerAgent.py

*File no longer exists in current working tree*

-----------

## Filename: backend/tests/unit_tests/agentic_workflows/test_models_with_node_ids.py

```
"""
Unit tests for updated models with node ID support
"""

import pytest
from pydantic import ValidationError
from typing import Optional
from backend.text_to_graph_pipeline.agentic_workflows.models import (
    TargetNodeIdentification,
    TargetNodeResponse
)


class TestTargetNodeIdentificationWithIDs:
    """Test the updated TargetNodeIdentification model with node IDs"""
    
    def test_existing_node_with_id(self):
        """Test creating a target node identification for an existing node"""
        target = TargetNodeIdentification(
            text="Add caching to improve performance",
            reasoning="This relates to performance optimization",
            target_node_id=5,
            is_new_node=False
        )
        
        assert target.target_node_id == 5
        assert target.is_new_node == False
        assert target.new_node_name is None  # Should be None for existing nodes
    
    def test_new_node_with_special_id(self):
        """Test creating a target node identification for a new node"""
        target = TargetNodeIdentification(
            text="Implement user authentication",
            reasoning="This is a new security feature not covered by existing nodes",
            target_node_id=-1,  # Special ID for new nodes
            is_new_node=True,
            new_node_name="User Authentication"
        )
        
        assert target.target_node_id == -1
        assert target.is_new_node == True
        assert target.new_node_name == "User Authentication"
    
    def test_validation_new_node_requires_name(self):
        """Test that new nodes require a name"""
        with pytest.raises(ValidationError) as exc_info:
            TargetNodeIdentification(
                text="Some text",
                reasoning="Some reasoning",
                target_node_id=-1,
                is_new_node=True
                # Missing new_node_name
            )
        
        # The validation error should mention the missing new_node_name
        assert "new_node_name" in str(exc_info.value)
    
    def test_validation_existing_node_positive_id(self):
        """Test that existing nodes should have positive IDs"""
        # This should work - existing node with positive ID
        target = TargetNodeIdentification(
            text="Some text",
            reasoning="Some reasoning",
            target_node_id=1,
            is_new_node=False
        )
        assert target.target_node_id == 1
        
        # This should fail - existing node with -1 ID
        with pytest.raises(ValidationError) as exc_info:
            TargetNodeIdentification(
                text="Some text",
                reasoning="Some reasoning",
                target_node_id=-1,
                is_new_node=False  # Says existing but ID is -1
            )
        
        assert "existing node" in str(exc_info.value).lower()
    
    def test_response_model_with_multiple_targets(self):
        """Test the response model with multiple target identifications"""
        response = TargetNodeResponse(
            target_nodes=[
                TargetNodeIdentification(
                    text="Performance improvement",
                    reasoning="Related to existing optimization work",
                    target_node_id=3,
                    is_new_node=False
                ),
                TargetNodeIdentification(
                    text="New feature: chat interface",
                    reasoning="Completely new functionality",
                    target_node_id=-1,
                    is_new_node=True,
                    new_node_name="Chat Interface"
                )
            ]
        )
        
        assert len(response.target_nodes) == 2
        assert response.target_nodes[0].target_node_id == 3
        assert response.target_nodes[1].target_node_id == -1
        assert response.target_nodes[1].new_node_name == "Chat Interface"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])```

-----------

## Filename: backend/tests/unit_tests/test_decision_tree_ds.py

```
import unittest
from datetime import datetime, timedelta
import time
from typing import List, Dict

from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import DecisionTree, Node


class TestDecisionTree(unittest.TestCase):
    def test_append_to_node(self):
        dt = DecisionTree()
        node_id = dt.create_new_node("test_node", None, "test_content", "test_summary")
        dt.tree[node_id].append_content("appended content")
        self.assertIn("appended content", dt.tree[node_id].content)

    def test_create_new_node(self):
        dt = DecisionTree()
        new_node_id = dt.create_new_node("test_node", None, "test_content", "test_summary")
        self.assertEqual(new_node_id, 0)
        self.assertIn(0, dt.tree)
        self.assertEqual(dt.tree[0].parent_id, None)

    def test_get_recent_nodes(self):
        dt = DecisionTree()
        
        # Create some nodes
        created_nodes = []
        # Create first node with no parent
        first_node_id = dt.create_new_node("node1", None, "content1", "summary1")
        created_nodes.append(first_node_id)
        time.sleep(0.01)  # Small delay to ensure different timestamps
        
        # Create subsequent nodes with first node as parent
        for i in range(1, 3):
            node_id = dt.create_new_node(f"node{i+1}", first_node_id, f"content{i+1}", f"summary{i+1}")
            created_nodes.append(node_id)
            time.sleep(0.01)  # Small delay to ensure different timestamps
        
        # Test getting recent nodes returns a list
        recent_nodes = dt.get_recent_nodes(5)
        self.assertIsInstance(recent_nodes, list)
        
        # Test limiting the number of results
        one_node = dt.get_recent_nodes(1)
        self.assertEqual(len(one_node), 1)
        
        # Test that all created nodes appear in a sufficiently large recent nodes list
        many_nodes = dt.get_recent_nodes(20)
        for node_id in created_nodes:
            self.assertIn(node_id, many_nodes, 
                         f"Created node {node_id} should appear in recent nodes")
        
        # Test that get_recent_nodes returns valid node IDs
        for node_id in recent_nodes:
            self.assertIn(node_id, dt.tree, 
                         f"Node ID {node_id} from recent_nodes should exist in tree")

    def test_get_parent_id(self):
        dt = DecisionTree()
        node1_id = dt.create_new_node("node1", None, "content1", "summary1")
        node2_id = dt.create_new_node("node2", node1_id, "content2", "summary2")
        parent_id = dt.get_parent_id(node2_id)
        self.assertEqual(parent_id, node1_id)

    def test_get_neighbors(self):
        """Test that get_neighbors returns immediate neighbors (parent, siblings, children) with summaries"""
        dt = DecisionTree()
        
        # Create a tree structure:
        #       A
        #      / \
        #     B   C
        #    / \   \
        #   D   E   F
        
        a_id = dt.create_new_node("A", None, "Content A", "Summary A")
        b_id = dt.create_new_node("B", a_id, "Content B", "Summary B")
        c_id = dt.create_new_node("C", a_id, "Content C", "Summary C")
        d_id = dt.create_new_node("D", b_id, "Content D", "Summary D")
        e_id = dt.create_new_node("E", b_id, "Content E", "Summary E")
        f_id = dt.create_new_node("F", c_id, "Content F", "Summary F")
        
        # Test neighbors of B (should include parent A, sibling C, children D and E)
        neighbors_b = dt.get_neighbors(b_id)
        neighbor_ids = {n["id"] for n in neighbors_b}
        
        # Should have parent, sibling, and children
        self.assertEqual(len(neighbors_b), 4)
        self.assertIn(a_id, neighbor_ids)  # parent
        self.assertIn(c_id, neighbor_ids)  # sibling
        self.assertIn(d_id, neighbor_ids)  # child
        self.assertIn(e_id, neighbor_ids)  # child
        
        # Verify neighbor structure
        for neighbor in neighbors_b:
            self.assertIn("id", neighbor)
            self.assertIn("name", neighbor)
            self.assertIn("summary", neighbor)
            self.assertIn("relationship", neighbor)
            
        # Test neighbors of root node A (only children, no parent or siblings)
        neighbors_a = dt.get_neighbors(a_id)
        neighbor_ids_a = {n["id"] for n in neighbors_a}
        self.assertEqual(len(neighbors_a), 2)
        self.assertIn(b_id, neighbor_ids_a)
        self.assertIn(c_id, neighbor_ids_a)
        
        # Test neighbors of leaf node D (only parent and sibling)
        neighbors_d = dt.get_neighbors(d_id)
        neighbor_ids_d = {n["id"] for n in neighbors_d}
        self.assertEqual(len(neighbors_d), 2)
        self.assertIn(b_id, neighbor_ids_d)  # parent
        self.assertIn(e_id, neighbor_ids_d)  # sibling

    def test_update_node(self):
        """Test that update_node replaces content and summary completely"""
        dt = DecisionTree()
        
        # Create initial node
        node_id = dt.create_new_node(
            "Original Name", 
            None, 
            "Original content with lots of text", 
            "Original summary"
        )
        
        # Store original modified time
        original_modified = dt.tree[node_id].modified_at
        
        # Wait a bit to ensure time difference
        time.sleep(0.01)
        
        # Update the node
        dt.update_node(
            node_id, 
            "Completely new content", 
            "New summary"
        )
        
        # Verify content was replaced (not appended)
        self.assertEqual(dt.tree[node_id].content, "Completely new content")
        self.assertNotIn("Original content", dt.tree[node_id].content)
        
        # Verify summary was replaced
        self.assertEqual(dt.tree[node_id].summary, "New summary")
        
        # Verify name stayed the same
        self.assertEqual(dt.tree[node_id].title, "Original Name")
        
        # Verify modified time was updated
        self.assertGreater(dt.tree[node_id].modified_at, original_modified)
        
        # Test updating non-existent node raises error or returns False
        with self.assertRaises(KeyError):
            dt.update_node(999, "content", "summary")


if __name__ == "__main__":
    unittest.main()```

-----------

## Filename: backend/tests/unit_tests/test_summary_generation.py

```
"""
Unit tests for summary generation in optimizer only
"""

import pytest
from unittest.mock import Mock, call
from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import Node, DecisionTree


class TestSummaryGeneration:
    """Test that summary generation happens only in optimizer, not during append"""
    
    @pytest.fixture
    def decision_tree(self):
        """Create a decision tree with test nodes"""
        tree = DecisionTree()
        # Create root node
        tree.create_new_node(
            name="Root",
            parent_node_id=None,
            content="Root content",
            summary="Root summary"
        )
        return tree
    
    def test_append_content_no_summary_update(self):
        """Test that append_content doesn't update summary when None is passed"""
        node = Node(
            name="Test Node",
            node_id=1,
            content="Original content",
            summary="Original summary"
        )
        
        # append_content should not change summary when None is passed
        node.append_content("New content", transcript="chunk1")
        
        # Summary should remain unchanged when None is passed
        assert node.summary == "Original summary"
        # Content should be appended
        assert "New content" in node.content
    
    def test_update_node_changes_summary(self):
        """Test that update_node (used by optimizer) changes the summary"""
        tree = DecisionTree()
        node_id = tree.create_new_node(
            name="Test",
            parent_node_id=None,
            content="Original content",
            summary="Original summary"
        )
        
        # update_node should change both content and summary
        tree.update_node(
            node_id=node_id,
            content="Updated content",
            summary="Updated summary from optimizer"
        )
        
        node = tree.tree[node_id]
        assert node.content == "Updated content"
        assert node.summary == "Updated summary from optimizer"
    
    def test_append_preserves_summary_until_optimization(self):
        """Test workflow: append doesn't change summary, optimization does"""
        tree = DecisionTree()
        node_id = tree.create_new_node(
            name="Workflow Test",
            parent_node_id=None,
            content="Initial content",
            summary="Initial summary"
        )
        
        node = tree.tree[node_id]
        
        # Step 1: Append new content (simulating stage 3)
        node.append_content("Appended chunk 1", summary=None, transcript="chunk1")
        node.append_content("Appended chunk 2", summary=None, transcript="chunk2")
        
        # Summary should NOT change during appends
        assert node.summary == "Initial summary"
        assert "Appended chunk 1" in node.content
        assert "Appended chunk 2" in node.content
        
        # Step 2: Optimization updates the node (simulating stage 4)
        tree.update_node(
            node_id=node_id,
            content="Optimized content combining all chunks",
            summary="New summary after optimization"
        )
        
        # Now summary should be updated
        assert node.summary == "New summary after optimization"
        assert node.content == "Optimized content combining all chunks"
    
    def test_node_append_method_should_not_update_summary(self):
        """Test that Node.append_content should not update summary"""
        import inspect
        sig = inspect.signature(Node.append_content)
        
        # Current signature has summary, but we want to remove it
        params = list(sig.parameters.keys())
        assert "self" in params
        assert "new_content" in params
        assert "transcript" in params
        # TODO: Remove summary parameter from append_content
        # This test documents that we currently have summary but shouldn't


if __name__ == "__main__":
    pytest.main([__file__, "-v"])```

-----------

## Filename: backend/tests/unit_tests/test_tree_action_applier_with_ids.py

```
"""
Unit tests for TreeActionApplier with node ID support
"""

import pytest
from unittest.mock import Mock
from backend.text_to_graph_pipeline.chunk_processing_pipeline.apply_tree_actions import TreeActionApplier
from backend.text_to_graph_pipeline.agentic_workflows.models import (
    IntegrationDecision, UpdateAction, CreateAction
)
from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import Node


class TestTreeActionApplierWithNodeIDs:
    """Test TreeActionApplier working directly with node IDs"""
    
    @pytest.fixture
    def mock_tree(self):
        """Create a mock decision tree"""
        tree = Mock()
        tree.tree = {
            1: Mock(id=1, title="Root", content="Root content"),
            2: Mock(id=2, title="Child", content="Child content")
        }
        tree.get_node_id_from_name = Mock()  # Should not be called
        tree.create_new_node = Mock(return_value=3)
        return tree
    
    @pytest.fixture
    def applier(self, mock_tree):
        """Create TreeActionApplier instance"""
        return TreeActionApplier(mock_tree)
    
    def test_append_with_node_id(self, applier, mock_tree):
        """Test appending content using node ID directly"""
        # Create an append decision with target_node_id
        decision = IntegrationDecision(
            name="Segment 1",
            text="New content to append",
            reasoning="This relates to the child node",
            action="APPEND",
            target_node_id=2,  # Using ID directly
            content="New content to append"
        )
        
        # Apply the decision
        updated_nodes = applier.apply_integration_decisions([decision])
        
        # Verify node ID was used directly
        mock_tree.get_node_id_from_name.assert_not_called()
        
        # Verify content was appended to the correct node
        node = mock_tree.tree[2]
        node.append_content.assert_called_once_with(
            "New content to append",
            None,
            "Segment 1"
        )
        
        # Verify updated nodes set
        assert 2 in updated_nodes
    
    def test_create_with_parent_node_id(self, applier, mock_tree):
        """Test creating new node with parent ID"""
        # Create decision with parent_node_id
        decision = IntegrationDecision(
            name="New Segment",
            text="Content for new node",
            reasoning="This is a new concept",
            action="CREATE",
            parent_node_id=1,  # Parent ID
            new_node_name="New Concept",
            new_node_summary="A new concept node",
            relationship_for_edge="subtopic of",
            content="Content for new node"
        )
        
        # Apply the decision
        updated_nodes = applier.apply_integration_decisions([decision])
        
        # Verify node was created with parent ID
        mock_tree.get_node_id_from_name.assert_not_called()
        mock_tree.create_new_node.assert_called_once_with(
            name="New Concept",
            parent_node_id=1,
            content="Content for new node",
            summary="A new concept node",
            relationship_to_parent="subtopic of"
        )
        
        # Verify updated nodes
        assert 3 in updated_nodes  # New node
        assert 1 in updated_nodes  # Parent node
    
    def test_update_action_with_node_id(self, applier, mock_tree):
        """Test UPDATE action uses node ID directly"""
        # Setup update_node method
        mock_tree.update_node = Mock()
        
        # Create update action
        action = UpdateAction(
            action="UPDATE",
            node_id=2,
            new_content="Updated content",
            new_summary="Updated summary"
        )
        
        # Apply the action
        updated_nodes = applier.apply_optimization_actions([action])
        
        # Verify update was called with ID
        mock_tree.update_node.assert_called_once_with(
            node_id=2,
            content="Updated content",
            summary="Updated summary"
        )
        
        assert 2 in updated_nodes
    
    def test_create_action_for_new_node_no_parent(self, applier, mock_tree):
        """Test creating root-level node when parent_node_id is -1"""
        decision = IntegrationDecision(
            name="Root Level Node",
            text="New root content",
            reasoning="New top-level concept",
            action="CREATE",
            parent_node_id=-1,  # Special value for no parent
            new_node_name="New Root",
            new_node_summary="A new root node",
            content="New root content"
        )
        
        # Apply the decision
        updated_nodes = applier.apply_integration_decisions([decision])
        
        # Verify node was created without parent
        mock_tree.create_new_node.assert_called_once_with(
            name="New Root",
            parent_node_id=None,  # -1 converted to None
            content="New root content",
            summary="A new root node",
            relationship_to_parent=None
        )
        
        assert 3 in updated_nodes


if __name__ == "__main__":
    pytest.main([__file__, "-v"])```

-----------

## Filename: backend/tests/unit_tests/test_unified_action_model.py

```
"""
Unit tests for unified action model in TreeActionApplier
"""

import pytest
from unittest.mock import Mock
from backend.text_to_graph_pipeline.chunk_processing_pipeline.apply_tree_actions import TreeActionApplier
from backend.text_to_graph_pipeline.agentic_workflows.models import (
    UpdateAction, CreateAction
)


class TestUnifiedActionModel:
    """Test unified action handling in TreeActionApplier"""
    
    @pytest.fixture
    def mock_tree(self):
        """Create a mock decision tree"""
        tree = Mock()
        tree.tree = {
            1: Mock(id=1, title="Root", content="Root content"),
            2: Mock(id=2, title="Child", content="Child content")
        }
        tree.create_new_node = Mock(return_value=3)
        tree.update_node = Mock()
        return tree
    
    @pytest.fixture
    def applier(self, mock_tree):
        """Create TreeActionApplier instance"""
        return TreeActionApplier(mock_tree)
    
    def test_apply_single_method_handles_all_actions(self, applier, mock_tree):
        """Test that a single apply() method can handle all action types"""
        # Mix of different action types
        actions = [
            UpdateAction(
                action="UPDATE",
                node_id=1,
                new_content="Updated root content",
                new_summary="Updated root summary"
            ),
            CreateAction(
                action="CREATE",
                parent_node_id=1,
                new_node_name="New Child",
                content="New child content",
                summary="New child summary",
                relationship="subtopic of"
            ),
            UpdateAction(
                action="UPDATE",
                node_id=2,
                new_content="Updated child content",
                new_summary="Updated child summary"
            )
        ]
        
        # Apply all actions through single method
        updated_nodes = applier.apply(actions)
        
        # Verify all actions were applied
        assert mock_tree.update_node.call_count == 2
        assert mock_tree.create_new_node.call_count == 1
        
        # Verify correct nodes were updated
        assert 1 in updated_nodes  # Updated root
        assert 2 in updated_nodes  # Updated child
        assert 3 in updated_nodes  # New node
    
    def test_apply_handles_empty_list(self, applier):
        """Test apply() with empty action list"""
        updated_nodes = applier.apply([])
        assert updated_nodes == set()
    
    def test_apply_validates_action_types(self, applier):
        """Test that apply() validates action types"""
        # Create an invalid action (mock object)
        invalid_action = Mock()
        invalid_action.action = "INVALID"
        
        with pytest.raises(ValueError, match="Unknown action type"):
            applier.apply([invalid_action])
    
    def test_apply_with_append_actions(self, applier, mock_tree):
        """Test unified handling includes APPEND actions"""
        # For new pipeline, APPEND is represented as a special UPDATE
        # where we append to existing content instead of replacing
        append_action = UpdateAction(
            action="UPDATE",
            node_id=2,
            new_content="Original content\n\nAppended content",
            new_summary="Updated summary with appended info"
        )
        
        updated_nodes = applier.apply([append_action])
        
        mock_tree.update_node.assert_called_once_with(
            node_id=2,
            content="Original content\n\nAppended content",
            summary="Updated summary with appended info"
        )
        assert 2 in updated_nodes
    
    def test_base_action_inheritance(self):
        """Test that all action types inherit from BaseTreeAction"""
        from backend.text_to_graph_pipeline.agentic_workflows.models import BaseTreeAction
        
        # All action types should inherit from BaseTreeAction
        assert issubclass(UpdateAction, BaseTreeAction)
        assert issubclass(CreateAction, BaseTreeAction)
    
    def test_action_type_discrimination(self):
        """Test that actions can be discriminated by their type field"""
        update = UpdateAction(
            action="UPDATE",
            node_id=1,
            new_content="content",
            new_summary="summary"
        )
        create = CreateAction(
            action="CREATE",
            parent_node_id=1,
            new_node_name="name",
            content="content",
            summary="summary",
            relationship="relation"
        )
        
        assert update.action == "UPDATE"
        assert create.action == "CREATE"
        
        # Type field should be literal/constant
        from typing import Literal
        assert UpdateAction.model_fields['action'].annotation == Literal["UPDATE"]
        assert CreateAction.model_fields['action'].annotation == Literal["CREATE"]


if __name__ == "__main__":
    pytest.main([__file__, "-v"])```

-----------

## Filename: backend/text_to_graph_pipeline/agentic_workflows/improvements.md

```
Major Logical Problems and Risks
There are two significant logical issues that could undermine the system's reliability and intelligence.
1. The "Name vs. ID" Ambiguity: A Critical Point of Failure
This is the most pressing problem. The pipeline relies heavily on resolving node names to IDs, and the current implementation is brittle.
The Problem: The identify_target_node agent returns a target_node_name. The TreeActionApplier and CreateAction model then rely on decision_tree.get_node_id_from_name() to find the correct node ID.
The Flaw in get_node_id_from_name():
It uses fuzzy string matching (difflib). This is inherently unreliable. If the tree contains "User Authentication" and "User Authorization," a new thought about "auth" could easily be mis-routed to the wrong node.
The fallback logic is dangerous: if no match is found, try to use the most recently modified node. This is a recipe for chaos. A completely unrelated thought could be appended to the last active node, creating a "junk drawer" by design.
Why It's a Problem: This breaks the determinism of the system's structure. The integrity of the tree—the most valuable asset—is left to the whims of fuzzy matching and a risky heuristic.
Recommendation: Agents must operate on Node IDs, not names.
The identify_target_node stage (or "Chooser" agent) should be the only part of the pipeline that deals with semantic matching.
Instead of just getting candidate nodes via RAG, the Chooser should be given the id, name, and summary of the top-K candidates.
Its output must be a chosen_node_id, not a name. For new nodes, it can return a special value like CREATE_NEW.
All subsequent stages (SingleAbstractionOptimizer, TreeActionApplier) must receive and operate on these concrete node_ids. This completely eliminates the fuzzy matching problem.


apply_tree_actions.py has become slightly convoluted due to handling multiple, similar action models.
The Issue: There are methods like apply_optimization_actions, apply_mixed_actions, and separate internal handlers like _apply_create_action and _apply_create_action_from_optimizer. This happened because different agents produce slightly different action models (IntegrationDecision vs. CreateAction).
Recommendation: Unify the action models. There should be one canonical set of actions (UpdateAction, CreateAction) that all agents produce. This will allow you to simplify the TreeActionApplier to have a single apply(actions: List[BaseTreeAction]) method that iterates through the list and dispatches based on the action's type.


In decision_tree_ds.py, the append_content method takes a summary argument. However, the calling code in apply_tree_actions.py notes that it's often None. The summary should ideally be generated by the SingleAbstractionOptimizer after it has decided on the final content of the node, not during a simple append.```

-----------

## Filename: backend/text_to_graph_pipeline/agentic_workflows/models.py

```
"""
Pydantic models for VoiceTree agentic workflow structured output
"""

from typing import List, Optional, Literal, Union
from pydantic import BaseModel, Field


class BaseTreeAction(BaseModel):
    """Base class for all tree actions"""
    action: str = Field(description="Action type")


class ChunkModel(BaseModel):
    """Model for segmentation stage output"""
    reasoning: str = Field(description="Analysis of why this is segmented as a distinct chunk and completeness assessment")
    text: str = Field(description="The actual text content of the chunk")
    is_complete: bool = Field(description="Whether this chunk represents a complete thought")


class SegmentationResponse(BaseModel):
    """Response model for segmentation stage"""
    chunks: List[ChunkModel] = Field(description="List of segmented chunks")


class RelationshipAnalysis(BaseModel):
    """Model for relationship analysis stage output"""
    name: str = Field(description="Name of the chunk being analyzed")
    text: str = Field(description="Text content of the chunk")
    reasoning: str = Field(description="Step-by-step analysis for the relationship")
    relevant_node_name: str = Field(description="Name of most relevant existing node or 'NO_RELEVANT_NODE'")
    relationship: Optional[str] = Field(description="Brief relationship description or null")


class RelationshipResponse(BaseModel):
    """Response model for relationship analysis stage"""
    analyzed_chunks: List[RelationshipAnalysis] = Field(description="Analysis results for each chunk")


class IntegrationDecision(BaseModel):
    """Model for integration decision stage output"""
    name: str = Field(description="Name of the chunk")
    text: str = Field(description="Text content of the chunk")
    reasoning: str = Field(description="Analysis that led to the integration decision")
    action: Literal["CREATE", "APPEND"] = Field(description="Whether to create new node or append to existing")
    # Legacy name-based fields (deprecated)
    target_node: Optional[str] = Field(default=None, description="Target node name (deprecated, use target_node_id)")
    # New ID-based fields
    target_node_id: Optional[int] = Field(default=None, description="Target node ID for APPEND action")
    parent_node_id: Optional[int] = Field(default=None, description="Parent node ID for CREATE action (-1 for root)")
    new_node_name: Optional[str] = Field(default=None, description="Name for new node if action is CREATE")
    new_node_summary: Optional[str] = Field(default=None, description="Summary for new node if action is CREATE")
    relationship_for_edge: Optional[str] = Field(default=None, description="Relationship description for new edges")
    content: str = Field(description="Content to add to the node")


class IntegrationResponse(BaseModel):
    """Response model for integration decision stage"""
    integration_decisions: List[IntegrationDecision] = Field(description="Integration decisions for each chunk")


class NodeSummary(BaseModel):
    """Summary information about a node for neighbor context"""
    id: int = Field(description="Node ID")
    name: str = Field(description="Node name")
    summary: str = Field(description="Node summary")
    relationship: str = Field(description="Relationship to the target node (parent/sibling/child)")


class UpdateAction(BaseTreeAction):
    """Model for UPDATE tree action"""
    action: Literal["UPDATE"] = Field(description="Action type")
    node_id: int = Field(description="ID of node to update")
    new_content: str = Field(description="New content to replace existing content")
    new_summary: str = Field(description="New summary to replace existing summary")


class CreateAction(BaseTreeAction):
    """Model for CREATE action in optimization context"""
    action: Literal["CREATE"] = Field(description="Action type")
    # Legacy name-based field (deprecated)
    target_node_name: Optional[str] = Field(default=None, description="Name of parent node (deprecated, use parent_node_id)")
    # New ID-based field
    parent_node_id: Optional[int] = Field(default=None, description="ID of parent node (-1 for root)")
    new_node_name: str = Field(description="Name for the new node")
    content: str = Field(description="Content for the new node")
    summary: str = Field(description="Summary for the new node")
    relationship: str = Field(description="Relationship to parent (e.g., 'subtask of')")


class OptimizationDecision(BaseModel):
    """Model for single abstraction optimization output"""
    reasoning: str = Field(description="Analysis that led to the optimization decision")
    actions: List[Union[UpdateAction, CreateAction]] = Field(
        description="List of actions to take (can be empty if no optimization needed)",
        default_factory=list
    )


class OptimizationResponse(BaseModel):
    """Response model for single abstraction optimization stage"""
    optimization_decision: OptimizationDecision = Field(description="The optimization decision")


class TargetNodeIdentification(BaseModel):
    """Model for identifying target node for a segment"""
    text: str = Field(description="Text content of the segment")
    reasoning: str = Field(description="Analysis for choosing the target node")
    target_node_id: int = Field(description="ID of target node (use -1 for new nodes)")
    is_new_node: bool = Field(description="Whether this is a new node to be created")
    new_node_name: Optional[str] = Field(default=None, description="Name for new node (required if is_new_node=True)")
    
    @property
    def target_node_name(self) -> Optional[str]:
        """Backward compatibility property"""
        return self.new_node_name if self.is_new_node else None
    
    def model_post_init(self, __context):
        """Validate that new nodes have names and existing nodes have valid IDs"""
        if self.is_new_node:
            if self.target_node_id != -1:
                raise ValueError("New nodes must have target_node_id=-1")
            if not self.new_node_name:
                raise ValueError("new_node_name is required when is_new_node=True")
        else:
            if self.target_node_id == -1:
                raise ValueError("Existing nodes must have positive target_node_id")


class TargetNodeResponse(BaseModel):
    """Response model for identify target node stage"""
    target_nodes: List[TargetNodeIdentification] = Field(description="Target node for each segment") ```

-----------

## Filename: backend/text_to_graph_pipeline/agentic_workflows/new_pipeline_implementation_plan.md

```
# VoiceTree New Pipeline Implementation Plan

## Overview
Transition from current 3-stage pipeline to new 4-stage pipeline with optimization focus.

## Context for Next Engineer (Phase 3-4)

### What's Already Built
- **Infrastructure**: DecisionTree methods (`get_neighbors`, `update_node`) and TreeActionApplier (`apply_optimization_actions`, `apply_mixed_actions`) 
- **Models**: `UpdateAction`, `CreateAction`, `OptimizationDecision` returning list of actions
- **Prompts**: All 3 prompts created and tested (`segmentation.md`, `identify_target_node.md`, `single_abstraction_optimizer.md`)

### Agent Architecture Pattern
This codebase uses a specific LangGraph pattern (see `backend/text_to_graph_pipeline/agentic_workflows/core/agent.py`):
- Agents inherit from base `Agent` class
- Use `add_prompt()` to register prompts with structured output models
- Use `add_dataflow()` to define pipeline flow
- Prompts auto-load from `prompts/` directory

### Critical Implementation Notes
1. **Node Name Resolution**: The optimizer outputs node names, but TreeActionApplier needs IDs. Use `decision_tree.get_node_id_from_name()`
2. **Modified Node Tracking**: Stage 3 must output node IDs that were modified for Stage 4 to process
3. **SPLIT = UPDATE + CREATE**: Never a separate action. Optimizer returns list: `[UpdateAction(parent), CreateAction(child1), CreateAction(child2), ...]`
4. **Current Agent Rename**: Existing `TreeActionDeciderAgent` becomes `AppendToRelevantNodeAgent` (stages 1-3 only)

## Pipeline Stages

### Stage 1: Segmentation (Modified)
- Remove title generation from chunks
- Keep atomic idea extraction and completeness detection
- Output: segments without names

### Stage 2: Identify Target Node (New)
- For each segment, find most relevant existing node
- If no relevant node, create hypothetical node name immediately
- Output: segment → target node mapping

### Stage 3: Append Content
- Append each segment to its identified target node
- Track which nodes were modified
- Output: list of modified node IDs

### Stage 4: Single Abstraction Optimization (New)
- For each modified node:
  - Input: node content, summary, immediate neighbors (summaries only)
  - Apply optimization techniques from VoiceTree_Math.md
  - Output: UPDATE or SPLIT actions

## New Tree Actions

### UPDATE Action
```python
class UpdateAction:
    action: Literal["UPDATE"] 
    node_id: int
    new_content: str
    new_summary: str
```

### SPLIT Implementation
SPLIT is not a separate action type. It's implemented as:
1. UPDATE the original node to contain only parent content
2. CREATE new child nodes

The optimizer returns a list of actions that can include multiple CREATE and UPDATE actions to achieve the split.

## Implementation Steps
We will be following TDD for this project. A slightly different take on TDD where initially we just want a high level test, that doesn't go into any detail, just tests input -> expected output (behaviour) at whatever level of abstraction we are working on (method, module, prompt, agent, etc.)

### Phase 1: Core Infrastructure

0. Write high level behavioural tests for get_neighbours & update_node, focused on outcomme/behaviours not implementation details. 

1. Add UPDATE/SPLIT to models.py
2. Implement DecisionTree methods:
   - `get_neighbors(node_id) -> List[NodeSummary]`
   - `update_node(node_id, content, summary)`
   - Handle SPLIT in TreeActionApplier (create nodes first, then relationships)

Progress notes:
- Commit 4c20a15: Added behavioral tests for get_neighbors() and update_node() methods in test_decision_tree_ds.py
- Commit 4c20a15: Added new tree action models (UPDATE, SPLIT) and pipeline stage models to models.py
- Commit 4c20a15: Removed name field from ChunkModel to align with new segmentation approach
- Commit 74a98ff: Implemented get_neighbors() and update_node() methods in DecisionTree class (delegated to sub-agent)

### Phase 2: Prompts
0. Create input/fuzzy(output) test cases for the each of the prompts:
see backend/tests/integration_tests/agentic_workflows/SingleAbstractionOptimizerAgent/testSingleAbstractionOptimizerAgent.py
0. Segmentation prompt test can be skipped for now since we know it works well and we aren't modifying it much
0. Identify target node, simple input/output test just for sanity check
Note these tests should actually call the LLM. 

1. Modify segmentation.md (remove name field)
2. Create identify_target_node.md (simplified relationship_analysis)
3. Create single_abstraction_optimizer.md (with techniques from math doc)

Progress notes:
- Commit e6b4db2: Created test cases for identify_target_node and single_abstraction_optimizer prompts
- Commit e6b4db2: Modified segmentation.md to remove name field (delegated to sub-agent)
- Commit e6b4db2: Created identify_target_node.md prompt (delegated to sub-agent)
- Commit e6b4db2: Created single_abstraction_optimizer.md incorporating VoiceTree_Math optimization techniques

### Phase 2.5: TreeActionApplier Updates
0. Write behavioral tests for TreeActionApplier UPDATE support
1. Update models to allow optimizer to return multiple actions (for SPLIT = UPDATE + CREATEs)
2. Implement UPDATE action support in TreeActionApplier

Progress notes:
- Commit e53411f: Fixed model mismatch - created CreateAction model for optimizer output
- Commit e53411f: Updated prompts and tests to use CreateAction instead of IntegrationDecision
- Commit e53411f: Wrote tests for TreeActionApplier UPDATE support (not passing yet)
- Commit 4865fa3: Implemented UPDATE action support in TreeActionApplier - all tests pass

### Phase 2.75: Critical Improvements (Added)

Based on issues identified in improvements.md, the following critical improvements were made before Phase 3:

#### 1. **Eliminated Name-to-ID Resolution Ambiguity**
**Problem**: The pipeline relied on fuzzy string matching to resolve node names to IDs, which was inherently unreliable and could lead to mis-routing of content.

**Solution Implemented**:
- Updated `TargetNodeIdentification` model to use `target_node_id` instead of `target_node_name`
- Modified `identify_target_node.md` prompt to work with node IDs directly
- Updated `IntegrationDecision` and `CreateAction` models to support ID-based fields
- Modified `TreeActionApplier` to use node IDs directly, with fallback for legacy name-based code

**Files Modified**:
- `models.py`: Added `target_node_id`, `parent_node_id` fields to relevant models
- `identify_target_node.md`: Updated prompt to output node IDs
- `apply_tree_actions.py`: Updated to prefer ID-based fields over name-based

**Tests Added**:
- `test_identify_target_node_v2.py`: Integration tests for ID-based prompt
- `test_tree_action_applier_with_ids.py`: Unit tests for ID-based action handling

#### 2. **Unified Action Model**
**Problem**: Multiple similar action models and methods (`apply_optimization_actions`, `apply_mixed_actions`) made the code convoluted.

**Solution Implemented**:
- Created `BaseTreeAction` base class
- Made `UpdateAction` and `CreateAction` inherit from `BaseTreeAction`
- Added unified `apply()` method to `TreeActionApplier` that handles all action types

**Files Modified**:
- `models.py`: Added `BaseTreeAction` base class
- `apply_tree_actions.py`: Added unified `apply()` method

**Tests Added**:
- `test_unified_action_model.py`: Tests for unified action handling

#### 3. **Summary Generation Cleanup** (In Progress)
**Problem**: The `append_content` method takes a summary argument, but summaries should only be generated by the optimizer after deciding final content.

**Work Started**:
- Created tests documenting desired behavior
- Identified that `Node.append_content` currently updates summary
- Plan: Remove summary parameter and update logic from append_content

**Challenges Encountered**:
1. **Complex Model Interdependencies**: Updating models to use IDs required careful coordination between prompt outputs, model definitions, and TreeActionApplier logic
2. **Backward Compatibility**: Had to maintain support for legacy name-based code while transitioning to ID-based approach
3. **Testing LLM Prompts**: Integration tests for prompts required handling JSON extraction from LLM responses

### Phase 3: Agents

#### What Needs to Be Done
TDD behavioural tests for:
backend/tests/integration_tests/agentic_workflows/tree_action_decider
backend/tests/integration_tests/agentic_workflows/SingleAbstractionOptimizerAgent
backend/tests/integration_tests/agentic_workflows/AppendToRelevantNodeAgent

1. **Create SingleAbstractionOptimizerAgent** (new file)
   - Single prompt agent using `single_abstraction_optimizer.md`
   - Input: node_id, node content/summary, neighbors
   - Output: `OptimizationResponse` with list of actions

2. **Rename & Refactor Current Agent**
   - Copy `tree_action_decider_agent.py` → `append_to_relevant_node_agent.py`
   - Remove `integration_decision` stage
   - Replace `relationship_analysis` → `identify_target` (using new prompt)
   - Output modified node IDs after append stage

3. **Create New TreeActionDeciderAgent** (wrapper)
   - Runs AppendToRelevantNodeAgent first
   - Takes modified node IDs and runs SingleAbstractionOptimizerAgent on each
   - Combines all actions and applies via TreeActionApplier

#### State Management Between Stages
```python
# Stage 3 output needs to include:
state["modified_node_ids"] = [1, 5, 7]  # IDs of nodes that had content appended

# Stage 4 processes each:
for node_id in state["modified_node_ids"]:
    # Run optimizer on this node
```

### Phase 4: Integration
0. Integration test, update our existing integration test backend/tests/integration_tests/chunk_processing_pipeline/test_pipeline_e2e_with_di.py, this is our E2E test for our system with the agent part (TreeActionDeciderAgent) mocked. 
1. Update workflow adapter
2. Add tests for new actions
3. Run benchmarker

## Key Design Decisions

- UPDATE replaces entire node content/summary
- SPLIT is not a separate action - it's UPDATE + CREATE actions
- Optimizer can return multiple actions (list) to handle complex operations
- Optimization uses immediate neighbors only (for now)
- Modified nodes tracked at node ID level
- **NEW**: Agents work with node IDs, not names (eliminates fuzzy matching issues)
- **NEW**: All tree actions inherit from BaseTreeAction for unified handling
- **NEW**: Summary generation happens only in optimizer, not during append

## Quick Reference for Implementation

### Example Files to Study
- **Agent Pattern**: `backend/text_to_graph_pipeline/agentic_workflows/agents/tree_action_decider_agent.py`
- **State Definition**: `backend/text_to_graph_pipeline/agentic_workflows/core/state.py` 
- **Models**: `backend/text_to_graph_pipeline/agentic_workflows/models.py`
- **TreeActionApplier Usage**: `backend/text_to_graph_pipeline/chunk_processing_pipeline/chunk_processor.py`

### Key Methods You'll Use
```python
# Getting neighbors for optimizer
neighbors = decision_tree.get_neighbors(node_id)  # Returns List[Dict] with id, name, summary, relationship

# Applying optimizer actions
applier = TreeActionApplier(decision_tree)
updated_nodes = applier.apply_mixed_actions(actions)  # For UPDATE + CREATE combos
```

### Common Gotchas to Avoid
1. **State Updates**: The VoiceTreeState is a TypedDict - you must include ALL fields when updating
2. **Prompt Loading**: Prompts must be in `prompts/` directory with exact filename matching prompt name
3. **Model Validation**: OptimizationResponse expects `optimization_decision.actions` to be a list (can be empty)
4. **Node Resolution**: ~~Always convert node names to IDs before passing to TreeActionApplier~~ (FIXED: Now using IDs directly)
5. **LLM Response Parsing**: LLM may return JSON in code blocks - extract with regex
6. **Model Inheritance**: Pydantic models need explicit defaults for Optional fields
7. **Backward Compatibility**: New ID fields coexist with legacy name fields during transition```

-----------

## Filename: backend/text_to_graph_pipeline/agentic_workflows/prompts/identify_target_node.md

```
You are an expert system component responsible for identifying which existing node each text segment should be appended to, or proposing a new node name if no suitable node exists.

Your task is to analyze a list of text segments and, for each one, identify the single most relevant existing node to append it to OR propose a hypothetical new node name if no suitable node exists.

Your specific instructions are:

1. Iterate through each segment in the `segments` list. Each segment contains `text` field.

2. For each segment:
   a. Analyze the core meaning and topic presented in its `text`.
   b. Carefully compare this core meaning against the `id`, `name` and `summary` of *every* node provided in the `existing_nodes`.
   c. Determine which existing node is the most semantically relevant to append this segment to.
   d. If no existing node is sufficiently relevant (the segment represents a new topic or concept), propose a clear, descriptive name for a new node.

3. Use the "reasoning" field to explain your thought process:
   - First, understand what the segment is trying to say
   - Identify the main topic or concept
   - Explain why you chose the target node OR why a new node is needed
   - For new nodes, explain why the proposed name is appropriate

**Output Format:** Construct a JSON object with a "target_nodes" field containing a list. Each element in the list corresponds to one input segment and MUST contain ALL of the following fields:
   * `text`: The original text of the segment from the input (required, string).
   * `reasoning`: Your analysis for choosing the target node (required, string).
   * `target_node_id`: The ID of the chosen existing node OR -1 for a new node (required, integer).
   * `is_new_node`: Boolean indicating whether this is a new node (true) or existing node (false) (required, boolean).
   * `new_node_name`: The proposed name for a new node. This field is REQUIRED when `is_new_node` is true, and should be null when `is_new_node` is false (string or null).

Ensure that EVERY element in "target_nodes" contains ALL five fields listed above. Missing any field will cause validation errors. Ensure your final output is ONLY the valid JSON object described above.

**Example:**

**Existing Nodes:** `[{"id": 1, "name": "Project Setup", "summary": "Initial project configuration and requirements gathering"}, {"id": 2, "name": "Database Architecture", "summary": "Database design patterns and technology selection criteria"}]`

**Segments:** `[{"text": "We decided to use PostgreSQL for better performance with complex queries"}, {"text": "The authentication system will use JWT tokens with refresh token rotation"}, {"text": "For our PostgreSQL setup, we need to tune the query planner settings"}]`

**Expected Output:**
```json
{
  "target_nodes": [
    {
      "text": "We decided to use PostgreSQL for better performance with complex queries",
      "reasoning": "This segment discusses the selection of PostgreSQL as the database technology. This directly relates to database design decisions and technology choices, making it most relevant to the Database Architecture node.",
      "target_node_id": 2,
      "is_new_node": false,
      "new_node_name": null
    },
    {
      "text": "The authentication system will use JWT tokens with refresh token rotation",
      "reasoning": "This segment describes authentication implementation details. None of the existing nodes cover authentication or security topics, so a new node is needed to capture this distinct concept.",
      "target_node_id": -1,
      "is_new_node": true,
      "new_node_name": "Authentication System"
    },
    {
      "text": "For our PostgreSQL setup, we need to tune the query planner settings",
      "reasoning": "This segment provides specific configuration details for PostgreSQL. It's directly related to database implementation and belongs with other database-related content in the Database Architecture node.",
      "target_node_id": 2,
      "is_new_node": false,
      "new_node_name": null
    }
  ]
}
```

**Input Data:**

**Existing Nodes:**
{{existing_nodes}}

**Segments to Analyze:**
{{segments}}```

-----------

## Filename: backend/text_to_graph_pipeline/chunk_processing_pipeline/apply_tree_actions.py

```
"""
Tree Action Application Module
Handles applying integration decisions to the decision tree
"""

import logging
from typing import List, Set, Union

from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import DecisionTree
from backend.text_to_graph_pipeline.agentic_workflows.models import IntegrationDecision, UpdateAction, CreateAction, BaseTreeAction


class TreeActionApplier:
    """
    Applies tree actions (CREATE, APPEND, UPDATE) to the decision tree.
    
    This class encapsulates the logic for modifying the tree structure
    based on integration decisions from agentic workflows and optimization actions.
    """
    
    def __init__(self, decision_tree: DecisionTree):
        """
        Initialize the TreeActionApplier
        
        Args:
            decision_tree: The decision tree instance to apply actions to
        """
        self.decision_tree = decision_tree
        self.nodes_to_update: Set[int] = set()
    
    def apply_integration_decisions(self, integration_decisions: List[IntegrationDecision]) -> Set[int]:
        """
        Apply integration decisions from workflow result to the decision tree
        
        Args:
            integration_decisions: List of IntegrationDecision objects to apply
            
        Returns:
            Set of node IDs that were updated
        """
        self.nodes_to_update.clear()
        logging.info(f"Applying {len(integration_decisions)} integration decisions")
        
        for decision in integration_decisions:
            if decision.action == "CREATE":
                self._apply_create_action(decision)
            elif decision.action == "APPEND":
                self._apply_append_action(decision)
            else:
                logging.warning(f"Unknown action type: {decision.action}")
        
        return self.nodes_to_update.copy()
    
    def _apply_create_action(self, decision: IntegrationDecision):
        """
        Apply a CREATE action to create a new node in the tree
        
        Args:
            decision: The IntegrationDecision with CREATE action
        """
        # Prefer ID-based field, fall back to name-based for backward compatibility
        parent_id = None
        if decision.parent_node_id is not None:
            # Handle special case: -1 means no parent (root node)
            parent_id = None if decision.parent_node_id == -1 else decision.parent_node_id
        elif decision.target_node:
            # Legacy path: resolve name to ID
            parent_id = self.decision_tree.get_node_id_from_name(decision.target_node)
        
        # Create new node
        new_node_id = self.decision_tree.create_new_node(
            name=decision.new_node_name,
            parent_node_id=parent_id,
            content=decision.content,
            summary=decision.new_node_summary,
            relationship_to_parent=decision.relationship_for_edge
        )
        logging.info(f"Created new node '{decision.new_node_name}' with ID {new_node_id}")
        
        # Add the new node to the update set
        self.nodes_to_update.add(new_node_id)
        
        # Also add the parent node to update set so its child links are updated
        if parent_id is not None:
            self.nodes_to_update.add(parent_id)
            logging.info(f"Added parent node (ID {parent_id}) to update set to refresh child links")
    
    def _apply_append_action(self, decision: IntegrationDecision):
        """
        Apply an APPEND action to append content to an existing node
        
        Args:
            decision: The IntegrationDecision with APPEND action
        """
        # Prefer ID-based field, fall back to name-based for backward compatibility
        node_id = None
        if decision.target_node_id is not None:
            node_id = decision.target_node_id
        elif decision.target_node:
            # Legacy path: resolve name to ID
            node_id = self.decision_tree.get_node_id_from_name(decision.target_node)
        else:
            logging.warning(f"APPEND decision for '{decision.name}' has no target node - skipping")
            return
            
        if node_id is not None and node_id in self.decision_tree.tree:
            node = self.decision_tree.tree[node_id]
            node.append_content(
                decision.content,
                decision.name  # Use the chunk name as the label
            )
            logging.info(f"Appended content to node ID {node_id}")
            # Add the updated node to the update set
            self.nodes_to_update.add(node_id)
        else:
            logging.warning(f"Could not find node with ID {node_id} for APPEND action")
    
    def get_nodes_to_update(self) -> Set[int]:
        """
        Get the set of node IDs that need to be updated
        
        Returns:
            Set of node IDs
        """
        return self.nodes_to_update.copy()
    
    def clear_nodes_to_update(self):
        """Clear the set of nodes to update"""
        self.nodes_to_update.clear()
    
    def apply_optimization_actions(self, actions: List[UpdateAction]) -> Set[int]:
        """
        Apply optimization actions (UPDATE) from the optimizer
        
        Args:
            actions: List of UpdateAction objects to apply
            
        Returns:
            Set of node IDs that were updated
        """
        self.nodes_to_update.clear()
        logging.info(f"Applying {len(actions)} optimization actions")
        
        for action in actions:
            if isinstance(action, UpdateAction):
                self._apply_update_action(action)
            else:
                logging.warning(f"Unexpected action type in optimization actions: {type(action)}")
        
        return self.nodes_to_update.copy()
    
    def apply_mixed_actions(self, actions: List[Union[UpdateAction, CreateAction, IntegrationDecision]]) -> Set[int]:
        """
        Apply a mixed list of actions (UPDATE, CREATE) to handle complex operations like SPLIT
        
        Args:
            actions: List of mixed action types to apply
            
        Returns:
            Set of node IDs that were updated
        """
        self.nodes_to_update.clear()
        logging.info(f"Applying {len(actions)} mixed actions")
        
        for action in actions:
            if isinstance(action, UpdateAction):
                self._apply_update_action(action)
            elif isinstance(action, CreateAction):
                self._apply_create_action_from_optimizer(action)
            elif isinstance(action, IntegrationDecision):
                # Handle IntegrationDecision for backward compatibility
                if action.action == "CREATE":
                    self._apply_create_action(action)
                elif action.action == "APPEND":
                    self._apply_append_action(action)
            else:
                logging.warning(f"Unknown action type: {type(action)}")
        
        return self.nodes_to_update.copy()
    
    def _apply_update_action(self, action: UpdateAction):
        """
        Apply an UPDATE action to modify node content and summary
        
        Args:
            action: The UpdateAction to apply
        """
        # Update the node using the decision tree's update_node method
        try:
            self.decision_tree.update_node(
                node_id=action.node_id,
                content=action.new_content,
                summary=action.new_summary
            )
            logging.info(f"Updated node with ID {action.node_id}")
            
            # Add the updated node to the update set
            self.nodes_to_update.add(action.node_id)
        except KeyError:
            logging.error(f"Could not find node with ID {action.node_id} for UPDATE action")
    
    def _apply_create_action_from_optimizer(self, action: CreateAction):
        """
        Apply a CREATE action from the optimizer (uses CreateAction model)
        
        Args:
            action: The CreateAction to apply
        """
        # The optimizer should work with node IDs, but support name fallback
        parent_id = None
        if hasattr(action, 'parent_node_id') and action.parent_node_id is not None:
            # Handle special case: -1 means no parent (root node)
            parent_id = None if action.parent_node_id == -1 else action.parent_node_id
        elif action.target_node_name:
            # Legacy path: resolve name to ID
            parent_id = self.decision_tree.get_node_id_from_name(action.target_node_name)
            if parent_id is None:
                logging.warning(f"Could not find parent node '{action.target_node_name}' for CREATE action")
        
        # Create new node
        new_node_id = self.decision_tree.create_new_node(
            name=action.new_node_name,
            parent_node_id=parent_id,
            content=action.content,
            summary=action.summary,
            relationship_to_parent=action.relationship
        )
        logging.info(f"Created new node '{action.new_node_name}' with ID {new_node_id}")
        
        # Add the new node to the update set
        self.nodes_to_update.add(new_node_id)
        
        # Also add the parent node to update set if it exists
        if parent_id is not None:
            self.nodes_to_update.add(parent_id)
            logging.info(f"Added parent node (ID {parent_id}) to update set to refresh child links")
    
    def apply(self, actions: List[BaseTreeAction]) -> Set[int]:
        """
        Apply a list of tree actions
        
        This unified method handles all action types by dispatching based on
        the action field of each BaseTreeAction.
        
        Args:
            actions: List of BaseTreeAction objects (UpdateAction, CreateAction, etc.)
            
        Returns:
            Set of node IDs that were updated
            
        Raises:
            ValueError: If an unknown action type is encountered
        """
        self.nodes_to_update.clear()
        logging.info(f"Applying {len(actions)} tree actions")
        
        for action in actions:
            if action.action == "UPDATE":
                self._apply_update_action(action)
            elif action.action == "CREATE":
                self._apply_create_action_from_optimizer(action)
            else:
                raise ValueError(f"Unknown action type: {action.action}")
        
        return self.nodes_to_update.copy()```

-----------

## Filename: backend/text_to_graph_pipeline/tree_manager/decision_tree_ds.py

```
import logging
import re
from datetime import datetime
from typing import Dict, List, Optional
import difflib
from .tree_to_markdown import generate_filename_from_keywords
from .utils import extract_summary

def extract_title_from_md(node_content):
    title_match = re.search(r'#+(.*)', node_content, re.MULTILINE)
    title = title_match.group(1).strip() if title_match else "Untitled"
    title = title.lower()
    return title

class Node:
    def __init__(self, name : str, node_id: int, content: str, summary: str = "", parent_id: int = None):
        self.transcript_history = ""
        self.id: int = node_id
        self.content: str = content
        self.parent_id: int | None = parent_id
        self.children: List[int] = []
        self.relationships: Dict[int, str] = {}
        self.created_at: datetime = datetime.now()
        self.modified_at: datetime = datetime.now()
        self.title = name
        self.filename: str = str(node_id) + "_" + generate_filename_from_keywords(self.title)
        self.summary: str = summary
        self.num_appends: int = 0

    def append_content(self, new_content: str, transcript: str = ""):
        self.content += "\n" + new_content
        self.transcript_history += transcript + "... "
        self.modified_at = datetime.now()
        self.num_appends += 1


class DecisionTree:
    def __init__(self):
        self.tree: Dict[int, Node] = {}
        self.next_node_id: int = 0

    def create_new_node(self, name: str, parent_node_id: int | None, content: str, summary : str, relationship_to_parent: str = "child of") -> int:
        if parent_node_id is not None and parent_node_id not in self.tree:
            logging.error(f"Warning: Trying to create a node with non-existent parent ID: {parent_node_id}")
            parent_node_id = None

        # Check if a similar node already exists as a child of this parent
        # todo, temp remove since unnec complexity for now.
        # existing_child_id = self._find_similar_child(name, parent_node_id)
        # if existing_child_id is not None:
        #     logging.info(f"Found existing similar child node '{self.tree[existing_child_id].title}' (ID: {existing_child_id}) under parent {parent_node_id}. Returning existing node instead of creating duplicate.")
        #     return existing_child_id

        # Only get and increment node_id after validation passes
        new_node_id = self.next_node_id
        new_node = Node(name, new_node_id, content, summary, parent_id=parent_node_id)
        if parent_node_id is not None:
            new_node.relationships[parent_node_id] = relationship_to_parent
        
        # Only increment after we successfully create the node
        self.tree[new_node_id] = new_node
        if parent_node_id is not None:
            self.tree[parent_node_id].children.append(new_node_id)

        self.tree[new_node_id].summary = summary if summary else extract_summary(content)
        
        # Increment AFTER successful creation
        self.next_node_id += 1

        return new_node_id

    def _find_similar_child(self, name: str, parent_node_id: int | None, similarity_threshold: float = 0.8) -> Optional[int]:
        """
        Check if a similar node already exists as a child of the given parent.
        
        Args:
            name: The name to check for similarity
            parent_node_id: The parent node ID to check children of
            similarity_threshold: Minimum similarity score (0.0 to 1.0)
            
        Returns:
            Node ID of similar child if found, None otherwise
        """
        if parent_node_id is None or parent_node_id not in self.tree:
            return None
            
        parent_node = self.tree[parent_node_id]
        if not parent_node.children:
            return None
            
        # Get names of all children
        child_names = []
        child_ids = []
        for child_id in parent_node.children:
            if child_id in self.tree:
                child_names.append(self.tree[child_id].title.lower())
                child_ids.append(child_id)
        
        # Find closest match among children
        closest_matches = difflib.get_close_matches(
            name.lower(), 
            child_names, 
            n=1, 
            cutoff=similarity_threshold
        )
        
        if closest_matches:
            # Find the ID of the matching child
            matched_name = closest_matches[0]
            for i, child_name in enumerate(child_names):
                if child_name == matched_name:
                    return child_ids[i]
                    
        return None

    def get_recent_nodes(self, num_nodes=10):
        """Returns a list of IDs of the most recently modified nodes."""
        sorted_nodes = sorted(self.tree.keys(), key=lambda k: self.tree[k].modified_at, reverse=True)
        return sorted_nodes[:num_nodes]

    def get_parent_id(self, node_id):
        """Returns the parent ID of the given node, or None if it's the root."""
        # assumes tree invariant
        for parent_id, node in self.tree.items():
            if node_id in node.children:
                return parent_id
        return None

    def get_node_id_from_name(self, name: str) -> int | None:
        """
        Search the tree for the node with the name most similar to the input name.
        Uses fuzzy matching to find the closest match.

        Args:
            name (str): The name of the node to find.

        Returns:
            int | None: The ID of the closest matching node, or None if no close match is found.
        """
        # Handle None or empty name
        if not name:
            return None
            
        # Generate a list of node titles
        node_titles = [node.title for node in self.tree.values()]
        node_titles_lower = [title.lower() for title in node_titles]

        # Find the closest match to the input name
        closest_matches = difflib.get_close_matches(name.lower(), node_titles_lower, n=1, cutoff=0.6)

        if closest_matches:
            # If a match is found, return the corresponding node ID
            # Find the original title that matched
            matched_lower = closest_matches[0]
            for i, title_lower in enumerate(node_titles_lower):
                if title_lower == matched_lower:
                    original_title = node_titles[i]
                    break
            
            for node_id, node in self.tree.items():
                if node.title == original_title:
                    return node_id

        #todo: this won't scale

        # If no match is found, try to use the most recently modified node
        # This is more likely to be semantically related
        recent_nodes = self.get_recent_nodes(num_nodes=5)
        
        if recent_nodes:
            parent_id = recent_nodes[0]
            logging.warning(f"No close match found for node name '{name}'. Using most recent node: {self.tree[parent_id].title}")
            return parent_id
        
        # Return None if there are no nodes at all
        logging.warning(f"No close match found for node name '{name}' and no nodes exist in the tree.")
        return None

    def get_neighbors(self, node_id: int) -> List[Dict]:
        """
        Returns immediate neighbors (parent, siblings, children) with summaries.
        
        Args:
            node_id: The ID of the node to get neighbors for
            
        Returns:
            List of dictionaries with structure:
            {"id": int, "name": str, "summary": str, "relationship": str}
            Where relationship is "parent", "sibling", or "child"
        """
        if node_id not in self.tree:
            raise KeyError(f"Node {node_id} not found in tree")
            
        neighbors = []
        node = self.tree[node_id]
        
        # Get parent
        if node.parent_id is not None and node.parent_id in self.tree:
            parent_node = self.tree[node.parent_id]
            neighbors.append({
                "id": node.parent_id,
                "name": parent_node.title,
                "summary": parent_node.summary,
                "relationship": "parent"
            })
            
            # Get siblings (other children of the same parent)
            for sibling_id in parent_node.children:
                if sibling_id != node_id and sibling_id in self.tree:
                    sibling_node = self.tree[sibling_id]
                    neighbors.append({
                        "id": sibling_id,
                        "name": sibling_node.title,
                        "summary": sibling_node.summary,
                        "relationship": "sibling"
                    })
        
        # Get children
        for child_id in node.children:
            if child_id in self.tree:
                child_node = self.tree[child_id]
                neighbors.append({
                    "id": child_id,
                    "name": child_node.title,
                    "summary": child_node.summary,
                    "relationship": "child"
                })
        
        return neighbors

    def update_node(self, node_id: int, content: str, summary: str) -> None:
        """
        Replaces a node's content and summary completely.
        
        Args:
            node_id: The ID of the node to update
            content: The new content to replace existing content
            summary: The new summary to replace existing summary
            
        Raises:
            KeyError: If the node_id doesn't exist in the tree
        """
        if node_id not in self.tree:
            raise KeyError(f"Node {node_id} not found in tree")
            
        node = self.tree[node_id]
        node.content = content
        node.summary = summary
        node.modified_at = datetime.now()```

-----------

## Filename: tests_aggregate.md

```
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
        
        response = await call_llm(messages)
        result = TargetNodeResponse.model_validate_json(response)
        
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
        
        response = await call_llm(messages)
        result = TargetNodeResponse.model_validate_json(response)
        
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


```

-----------

## Filename: tools/PackageProjectForLLM.py

```
import os
import sys
import subprocess  # Import subprocess for running shell commands


def package_project(project_dir, file_extension=".py"):
    # Try to execute the 'tree' command, fallback to listing files if not available
    try:
        tree_output = subprocess.check_output(['tree', project_dir])
        out = tree_output.decode('utf-8')
    except (subprocess.CalledProcessError, FileNotFoundError):
        # Fallback: create a simple file listing
        out = f"Directory structure of {project_dir}:\n"
        for root, dirs, files in os.walk(project_dir):
            level = root.replace(project_dir, '').count(os.sep)
            indent = ' ' * 2 * level
            out += f"{indent}{os.path.basename(root)}/\n"
            subindent = ' ' * 2 * (level + 1)
            for file in files:
                if file.endswith(file_extension):
                    out += f"{subindent}{file}\n"
        out += "\n"

    for root, dirs, files in os.walk(project_dir):
        dirs[:] = [d for d in dirs if not (d.startswith('.') or d.startswith("__pycache"))]
        for file in files:
            if file.endswith(file_extension):
                file_path = os.path.join(root, file)
                rel_path = os.path.relpath(file_path, project_dir)
                with open(file_path, 'r') as f:
                    content = f.read()
                out += (f"===== {rel_path} =====\n")
                out += (content + "\n")

    return out

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python PackageProjectForLLM.py FOLDER")
        sys.exit(1)
    
    folder_path = sys.argv[1]
    if not os.path.exists(folder_path):
        print(f"Error: The folder '{folder_path}' does not exist.")
        sys.exit(1)
    
    print(package_project(folder_path))
```

-----------

