"""
Behavioral integration test for ConnectOrphansAgent using qa_example data
Tests the agent's ability to group related GPT-SoVITS components and leave unrelated ones alone
"""

from pathlib import Path

import pytest

from backend.markdown_tree_manager.markdown_to_tree.markdown_to_tree import (
    load_markdown_tree,
)
from backend.markdown_tree_manager.markdown_tree_ds import MarkdownTree
from backend.markdown_tree_manager.markdown_tree_ds import Node
from backend.text_to_graph_pipeline.agentic_workflows.agents.connect_orphans_agent import (
    ConnectOrphansAgent,
)
from backend.text_to_graph_pipeline.agentic_workflows.models import CreateAction


@pytest.mark.asyncio
class TestConnectOrphansAgentBehavior:
    """Test ConnectOrphansAgent behavioral patterns using real qa_example data"""

    @pytest.fixture
    def qa_example_tree(self) -> MarkdownTree:
        """Load the qa_example tree with GPT-SoVITS orphan nodes"""
        tree_path = Path("/Users/bobbobby/repos/VoiceTree/backend/tests/qa_example")
        
        if not tree_path.exists():
            # Fallback to creating a sample tree if qa_example not available
            tree = MarkdownTree()
            
            # Create sample GPT-SoVITS related nodes
            tree.create_new_node(
                "GPT-SoVITS Software",
                None,
                "# GPT-SoVITS Software\n\nLow-cost AI voice cloning software by Flower No Cry.",
                "Low-cost AI voice cloning software offering TTS and voice transformation"
            )
            
            tree.create_new_node(
                "GPT-SoVITS User Manual",
                None,
                "# GPT-SoVITS User Manual\n\nComprehensive guide for using GPT-SoVITS.",
                "User manual and documentation for GPT-SoVITS"
            )
            
            tree.create_new_node(
                "GPT-SoVITS Update Log 20240821",
                None,
                "# Update Log\n\nLatest updates and improvements to GPT-SoVITS.",
                "Update log for GPT-SoVITS version 20240821"
            )
            
            tree.create_new_node(
                "GSV Training Set Expansion",
                None,
                "# GSV Training Set Expansion\n\nMethods for expanding training sets.",
                "Training set expansion techniques for GSV"
            )
            
            tree.create_new_node(
                "GSV Audio Control",
                None,
                "# GSV Audio Control\n\nAdvanced audio control features.",
                "Audio control capabilities in GSV"
            )
            
            return tree
        
        # Load the actual qa_example tree (returns dict)
        tree_dict = load_markdown_tree(str(tree_path))
        
        # Convert to DecisionTree object
        tree = MarkdownTree()
        tree.tree = tree_dict
        
        # Set next_node_id to max existing + 1
        if tree_dict:
            tree.next_node_id = max(tree_dict.keys()) + 1
        else:
            tree.next_node_id = 1
            
        return tree

    @pytest.fixture
    def connect_orphans_agent(self) -> ConnectOrphansAgent:
        """Create ConnectOrphansAgent instance"""
        return ConnectOrphansAgent()

    async def test_groups_gpt_sovits_nodes_correctly(
        self,
        connect_orphans_agent: ConnectOrphansAgent,
        qa_example_tree: MarkdownTree
    ):
        """Test that agent correctly identifies and groups GPT-SoVITS related components"""
        
        # Count initial orphans
        initial_orphans = [
            node for node in qa_example_tree.tree.values()
            if node.parent_id is None
        ]
        
        print("\n=== Testing GPT-SoVITS Node Grouping ===")
        print(f"Initial orphan nodes: {len(initial_orphans)}")
        print("Sample orphan titles:")
        for node in initial_orphans[:5]:
            print(f"  - {node.title}")
        
        # Store the LLM response for debugging
        llm_response = None
        
        try:
            # Hook into the agent to capture LLM response
            original_run = connect_orphans_agent.run
            
            async def run_with_capture(*args, **kwargs):
                result = await original_run(*args, **kwargs)
                # Capture the state for debugging
                return result
            
            connect_orphans_agent.run = run_with_capture
            
            # Run the agent with real LLM calls
            initial_state = {
                "roots_context": connect_orphans_agent._format_roots_for_prompt(
                    connect_orphans_agent.find_disconnected_roots(qa_example_tree)[:15]
                ),
                "tree": qa_example_tree,
                "actions": []
            }
            
            # Execute workflow and capture response
            app = connect_orphans_agent.compile()
            final_state = await app.ainvoke(initial_state)
            
            # Extract the LLM response for debugging
            if "connect_orphans_response" in final_state:
                llm_response = final_state["connect_orphans_response"]
                
            # Get actions from the response
            actions = []
            if llm_response:
                actions = connect_orphans_agent.create_connection_actions(
                    llm_response,
                    connect_orphans_agent.find_disconnected_roots(qa_example_tree)[:15]
                )
        
        except Exception as e:
            print("\n!!! EXCEPTION DURING AGENT EXECUTION !!!")
            print(f"Error: {e}")
            if llm_response:
                print("\n=== LLM Response (for debugging) ===")
                print(f"Reasoning: {llm_response.reasoning if hasattr(llm_response, 'reasoning') else 'N/A'}")
                print(f"Groupings: {llm_response.groupings if hasattr(llm_response, 'groupings') else 'N/A'}")
            raise
        
        print("\n=== Agent Results ===")
        print(f"Generated {len(actions)} actions")
        
        # If no actions generated, print LLM reasoning for debugging
        if len(actions) == 0 and llm_response:
            print("\n=== LLM Response (No groupings created) ===")
            print(f"Reasoning: {llm_response.reasoning if hasattr(llm_response, 'reasoning') else 'N/A'}")
            print(f"Groupings: {llm_response.groupings if hasattr(llm_response, 'groupings') else 'N/A'}")
        
        # Analyze the groupings
        if len(actions) > 0:
            # All actions should be CreateActions for parent nodes
            for action in actions:
                try:
                    assert isinstance(action, CreateAction)
                    assert action.action == "CREATE"
                    assert action.parent_node_id is None  # New parents are roots in MVP
                    
                    print(f"\nParent node: {action.new_node_name}")
                    print(f"  Summary: {action.summary}")
                    
                    # Verify quality of parent nodes
                    assert len(action.new_node_name.strip()) > 0, "Parent name should not be empty"
                    assert len(action.summary.strip()) > 0, "Summary should not be empty"
                    assert len(action.content.strip()) > 0, "Content should not be empty"
                    
                    # Check that parent names are meaningful for GPT-SoVITS context
                    name_lower = action.new_node_name.lower()
                    
                    # Should not be overly generic
                    generic_terms = {'stuff', 'things', 'items', 'misc', 'other', 'various'}
                    assert not any(term in name_lower for term in generic_terms), \
                        f"Parent name should not be generic: '{action.new_node_name}'"
                    
                    # Should be descriptive (multi-word)
                    assert len(action.new_node_name.split()) >= 2, \
                        f"Parent name should be descriptive: '{action.new_node_name}'"
                        
                except AssertionError as e:
                    print("\n!!! ASSERTION FAILED !!!")
                    print(f"Failed assertion: {e}")
                    if llm_response:
                        print("\n=== Full LLM Response (for debugging) ===")
                        print(f"Reasoning: {llm_response.reasoning}")
                        print(f"All groupings: {llm_response.groupings}")
                    raise
        
        # The agent should make reasonable decisions (group or not group)
        assert isinstance(actions, list), "Should return a list of actions"
        
        # With GPT-SoVITS nodes, we expect some groupings but not excessive
        assert len(actions) <= 5, f"Should not over-group, got {len(actions)} parent nodes"

    async def test_respects_minimum_group_size(
        self,
        connect_orphans_agent: ConnectOrphansAgent
    ):
        """Test that agent respects minimum group size constraint"""
        # Create a minimal tree with just one orphan
        tree = MarkdownTree()
        tree.create_new_node(
            "GPT-SoVITS Single Node",
            None,
            "# GPT-SoVITS\n\nSingle orphan node.",
            "A single GPT-SoVITS component"
        )
        
        # Should not create any groupings with only one root
        actions = await connect_orphans_agent.run(tree, min_group_size=2)
        
        assert len(actions) == 0, "Should not group when below minimum group size"

    async def test_handles_diverse_gpt_sovits_topics(
        self,
        connect_orphans_agent: ConnectOrphansAgent
    ):
        """Test agent handles diverse GPT-SoVITS topics appropriately"""
        # Create a tree with diverse GPT-SoVITS related topics
        tree = MarkdownTree()
        
        # Technical features
        tree.create_new_node(
            "GSV Audio Control",
            None,
            "# GSV Audio Control\n\nTechnical audio control features.",
            "Audio control capabilities"
        )
        
        tree.create_new_node(
            "GSV Training and Inference",
            None,
            "# GSV Training\n\nTraining and inference flexibility.",
            "Training and inference features"
        )
        
        # Documentation
        tree.create_new_node(
            "GPT-SoVITS User Manual",
            None,
            "# User Manual\n\nUser documentation.",
            "User manual and guides"
        )
        
        tree.create_new_node(
            "GPT-SoVITS Video Tutorial",
            None,
            "# Video Tutorial\n\nVideo tutorials and guides.",
            "Video tutorial resources"
        )
        
        # Legal/Administrative
        tree.create_new_node(
            "GPT-SoVITS Usage Agreement",
            None,
            "# Usage Agreement\n\nLegal usage agreement.",
            "Usage agreement and terms"
        )
        
        tree.create_new_node(
            "GPT-SoVITS Disclaimer",
            None,
            "# Disclaimer\n\nLegal disclaimer.",
            "Disclaimer and legal notices"
        )
        
        # Run the agent
        actions = await connect_orphans_agent.run(tree, min_group_size=2)
        
        print("\n=== Diverse Topics Test ===")
        print(f"Created {len(actions)} groupings from 6 diverse topics")
        
        if actions:
            # Expect reasonable groupings (e.g., technical, documentation, legal)
            assert len(actions) <= 3, "Should create reasonable number of groups"
            
            for action in actions:
                print(f"  Group: {action.new_node_name}")
                # Groups should be thematically coherent
                assert "gpt" in action.new_node_name.lower() or \
                       "gsv" in action.new_node_name.lower() or \
                       len(action.new_node_name.split()) >= 2, \
                       "Group names should be specific to the domain"

    async def test_agent_internal_processing(
        self,
        connect_orphans_agent: ConnectOrphansAgent,
        qa_example_tree: MarkdownTree
    ):
        """Test the agent's internal processing functions"""
        # Test root finding
        roots = connect_orphans_agent.find_disconnected_roots(qa_example_tree)
        
        print("\n=== Internal Processing Test ===")
        print(f"Found {len(roots)} root nodes")
        
        # All roots should have required fields
        for root in roots:
            assert root.node_id > 0
            assert len(root.title.strip()) > 0
            assert len(root.summary.strip()) > 0
            assert root.child_count >= 0
        
        # Test prompt formatting
        if roots:
            formatted = connect_orphans_agent._format_roots_for_prompt(roots[:5])
            
            # Should contain expected formatting
            assert "Title:" in formatted
            assert "Summary:" in formatted
            assert "Subtree Size:" in formatted
            assert "---" in formatted  # Separator
            
            print("Prompt formatting works correctly")

    async def test_qa_example_produces_meaningful_groups(
        self,
        connect_orphans_agent: ConnectOrphansAgent,
        qa_example_tree: MarkdownTree
    ):
        """Test that qa_example data produces meaningful groupings"""
        # Get the roots that will be analyzed
        roots = connect_orphans_agent.find_disconnected_roots(qa_example_tree)[:20]
        
        print("\n=== Meaningful Groupings Test ===")
        print(f"Analyzing {len(roots)} root nodes:")
        for root in roots:
            print(f"  - {root.title}")
        
        # Store LLM response for debugging
        llm_response = None
        
        # Debug: Print what we're sending to the LLM
        roots_formatted = connect_orphans_agent._format_roots_for_prompt(roots)
        print("\n=== ROOTS CONTEXT BEING SENT ===")
        print(roots_formatted[:500] + "..." if len(roots_formatted) > 500 else roots_formatted)
        
        try:
            # Create initial state for direct workflow execution
            initial_state = {
                "roots_context": roots_formatted,
                "min_group_size": 2,
                "tree": qa_example_tree,
                "actions": []
            }
            
            # Execute workflow
            app = connect_orphans_agent.compile()
            final_state = await app.ainvoke(initial_state)
            
            # Extract the LLM response
            if "connect_orphans_response" in final_state:
                llm_response = final_state["connect_orphans_response"]
            
            # Get actions
            actions = []
            if llm_response:
                actions = connect_orphans_agent.create_connection_actions(llm_response, roots)
                
        except Exception as e:
            print("\n!!! ERROR IN TEST !!!")
            print(f"Error: {e}")
            if llm_response:
                print("\n=== LLM Response Debug ===")
                print(f"Reasoning: {llm_response.reasoning}")
                print(f"Groupings: {llm_response.groupings}")
            raise
        
        print(f"\nActions generated: {len(actions)}")
        
        # Always print LLM reasoning for insight
        if llm_response:
            print("\n=== LLM Reasoning ===")
            print(llm_response.reasoning[:500] + "..." if len(llm_response.reasoning) > 500 else llm_response.reasoning)
            if len(actions) == 0:
                print("\n=== Why no groupings? ===")
                print(f"LLM decided not to group. Full reasoning: {llm_response.reasoning}")
                
                # Output debug logs for better observability
                import os
                debug_dir = "/Users/bobbobby/repos/VoiceTree/backend/text_to_graph_pipeline/agentic_workflows/debug_logs"
                
                # Read and print LLM I/O log
                io_log_path = os.path.join(debug_dir, "connect_orphans_llm_io.txt")
                if os.path.exists(io_log_path):
                    print("\n=== LLM INPUT/OUTPUT LOG ===")
                    with open(io_log_path, 'r') as f:
                        content = f.read()
                        print(content[:2000] + "..." if len(content) > 2000 else content)
                
                # Read and print debug log
                debug_log_path = os.path.join(debug_dir, "connect_orphans_debug.txt")
                if os.path.exists(debug_log_path):
                    print("\n=== DEBUG LOG ===")
                    with open(debug_log_path, 'r') as f:
                        content = f.read()
                        print(content[:1000] + "..." if len(content) > 1000 else content)
        
        if actions:
            # Analyze the semantic quality of groupings
            for action in actions:
                parent_name = action.new_node_name
                parent_summary = action.summary
                
                print(f"\nGroup: {parent_name}")
                print(f"  Summary: {parent_summary[:100]}...")
                
                try:
                    # Parent nodes for GPT-SoVITS should be domain-relevant
                    name_lower = parent_name.lower()
                    summary_lower = parent_summary.lower()
                    
                    # Should contain relevant keywords
                    relevant_terms = {
                        'gpt-sovits', 'gsv', 'voice', 'audio', 'speech', 
                        'synthesis', 'training', 'model', 'software',
                        'documentation', 'update', 'feature', 'technical'
                    }
                    
                    has_relevant_term = any(
                        term in name_lower or term in summary_lower 
                        for term in relevant_terms
                    )
                    
                    assert has_relevant_term or len(actions) == 0, \
                        f"Parent '{parent_name}' should be relevant to GPT-SoVITS domain"
                    
                    # Check markdown formatting
                    assert action.content.startswith("#"), \
                        "Content should start with markdown header"
                    
                    # Should have substantial content
                    assert len(action.content) > 50, \
                        "Parent node should have meaningful content"
                        
                except AssertionError as e:
                    print("\n!!! ASSERTION FAILED !!!")
                    print(f"Failed: {e}")
                    if llm_response:
                        print(f"\nFull groupings from LLM: {llm_response.groupings}")
                    raise

    async def test_edge_case_empty_summaries(
        self,
        connect_orphans_agent: ConnectOrphansAgent
    ):
        """Test agent handles nodes with empty or minimal summaries"""
        tree = MarkdownTree()
        
        # Create nodes with edge case content
        node1 = Node(
            name="Node1",
            node_id=1,
            content="Content 1",
            summary="",  # Empty summary
            parent_id=None
        )
        tree.tree[1] = node1
        
        node2 = Node(
            name="Node2", 
            node_id=2,
            content="Content 2",
            summary=" ",  # Whitespace only
            parent_id=None
        )
        tree.tree[2] = node2
        
        tree.next_node_id = 3
        
        # Should handle gracefully
        try:
            await connect_orphans_agent.run(tree, min_group_size=2)
            # Test passes if no exception is raised
            assert True, "Agent handled edge cases gracefully"
        except Exception as e:
            pytest.fail(f"Agent failed on edge case: {e}")


if __name__ == "__main__":
    import asyncio
    
    async def main():
        """Run tests manually for debugging"""
        test = TestConnectOrphansAgentBehavior()
        
        # Load fixtures
        tree = test.qa_example_tree()
        agent = test.connect_orphans_agent()
        
        print("=" * 60)
        print("Testing GPT-SoVITS Node Grouping...")
        print("=" * 60)
        await test.test_groups_gpt_sovits_nodes_correctly(agent, tree)
        
        print("\n" + "=" * 60)
        print("Testing Diverse Topics...")
        print("=" * 60)
        await test.test_handles_diverse_gpt_sovits_topics(agent)
        
        print("\n" + "=" * 60)
        print("Testing QA Example Meaningful Groups...")
        print("=" * 60)
        await test.test_qa_example_produces_meaningful_groups(agent, tree)
    
    asyncio.run(main())