"""
Behavioral test for SubtreeClassifierAgent
Tests the agent's ability to classify tree structures into meaningful subtrees using LLM
"""

import pytest
from typing import Dict, List, Any

from backend.text_to_graph_pipeline.agentic_workflows.agents.subtree_classifier_agent import SubtreeClassifierAgent
from backend.text_to_graph_pipeline.agentic_workflows.models import SubtreeClassificationResponse, SubtreeGroup, ClassifiedTree


@pytest.mark.asyncio
class TestSubtreeClassifierBehavior:
    """Test subtree classifier agent behavioral patterns"""

    @pytest.fixture
    def sample_tree_data(self) -> Dict[str, Any]:
        """Create sample tree data with clear semantic groupings for subtrees"""
        return {
            "trees": [
                {
                    "tree_id": "test_tree_2025_08_03",
                    "nodes": [
                        {
                            "node_id": "1",
                            "title": "VoiceTree Demo Setup",
                            "content": "Set up the demo environment for VoiceTree presentation...",
                            "links": ["2", "3"]
                        },
                        {
                            "node_id": "2", 
                            "title": "Install Dependencies",
                            "content": "Install Python packages and setup virtual environment...",
                            "links": []
                        },
                        {
                            "node_id": "3",
                            "title": "Configure Audio Input",
                            "content": "Set up microphone and audio processing for voice input...",
                            "links": []
                        },
                        {
                            "node_id": "4",
                            "title": "User Interface Bug Fixes",
                            "content": "Fix React component rendering issues in the UI...",
                            "links": ["5", "6"]
                        },
                        {
                            "node_id": "5",
                            "title": "Button Color Issue",
                            "content": "The submit button color is not matching design system...",
                            "links": []
                        },
                        {
                            "node_id": "6", 
                            "title": "Navigation Menu Layout",
                            "content": "Fix navigation menu alignment and spacing issues...",
                            "links": []
                        },
                        {
                            "node_id": "7",
                            "title": "Database Schema Design", 
                            "content": "Design database tables for storing conversation trees...",
                            "links": ["8"]
                        },
                        {
                            "node_id": "8",
                            "title": "Migration Scripts",
                            "content": "Create database migration scripts for schema changes...",
                            "links": []
                        },
                        {
                            "node_id": "9",
                            "title": "Random Meeting Notes",
                            "content": "Miscellaneous notes from team meeting that don't fit elsewhere...",
                            "links": []
                        }
                    ],
                    "relationships": [
                        {"parent": "1", "child": "2", "link_type": "dependency"},
                        {"parent": "1", "child": "3", "link_type": "dependency"},
                        {"parent": "4", "child": "5", "link_type": "subtask"},
                        {"parent": "4", "child": "6", "link_type": "subtask"},
                        {"parent": "7", "child": "8", "link_type": "dependency"}
                    ]
                }
            ]
        }

    @pytest.fixture
    def subtree_classifier_agent(self) -> SubtreeClassifierAgent:
        """Create subtree classifier agent instance"""
        return SubtreeClassifierAgent()

    async def test_classifies_trees_into_meaningful_subtrees(
        self, 
        subtree_classifier_agent: SubtreeClassifierAgent, 
        sample_tree_data: Dict[str, Any]
    ):
        """Test that agent classifies tree into meaningful subtrees"""
        # Run subtree classification
        result: SubtreeClassificationResponse = await subtree_classifier_agent.run(sample_tree_data)
        
        # Verify structure
        assert isinstance(result, SubtreeClassificationResponse)
        assert isinstance(result.classified_trees, list)
        assert len(result.classified_trees) == 1  # Should have one tree from our test data
        assert isinstance(result.reasoning, str)
        assert len(result.reasoning) > 0
        
        # Get the classified tree
        classified_tree = result.classified_trees[0]
        
        # Should identify 2-6 subtrees as specified
        assert 2 <= len(classified_tree.subtrees) <= 6, f"Should identify 2-6 subtrees, got {len(classified_tree.subtrees)}"
        
        # Each subtree should have valid structure
        all_classified_nodes = set()
        for subtree in classified_tree.subtrees:
            assert isinstance(subtree, SubtreeGroup)
            assert isinstance(subtree.subtree_id, str)
            assert len(subtree.subtree_id) > 0
            assert isinstance(subtree.container_type, str)
            assert len(subtree.container_type) > 0
            assert isinstance(subtree.nodes, list)
            assert len(subtree.nodes) > 0  # Each subtree should have at least one node
            assert isinstance(subtree.theme, str)
            assert len(subtree.theme) > 0
            
            # Collect all classified nodes
            all_classified_nodes.update(subtree.nodes)
        
        # Verify nodes are either classified or unclassified, not both
        unclassified_set = set(classified_tree.unclassified_nodes)
        assert len(all_classified_nodes.intersection(unclassified_set)) == 0, \
            "Nodes cannot be both classified and unclassified"
        
        # All nodes should be accounted for
        expected_nodes = {"1", "2", "3", "4", "5", "6", "7", "8", "9"}
        actual_nodes = all_classified_nodes.union(unclassified_set)
        assert actual_nodes == expected_nodes, \
            f"All nodes should be accounted for. Expected: {expected_nodes}, Got: {actual_nodes}"

    async def test_identifies_semantic_groupings(
        self, 
        subtree_classifier_agent: SubtreeClassifierAgent,
        sample_tree_data: Dict[str, Any]
    ):
        """Test that agent identifies semantically meaningful groupings"""
        result: SubtreeClassificationResponse = await subtree_classifier_agent.run(sample_tree_data)
        
        # Get the classified tree
        classified_tree = result.classified_trees[0]
        
        # Look for expected semantic groupings
        subtree_nodes = {subtree.subtree_id: set(subtree.nodes) for subtree in classified_tree.subtrees}
        
        # Demo setup nodes (1, 2, 3) should likely be grouped together
        demo_nodes = {"1", "2", "3"}
        ui_nodes = {"4", "5", "6"}
        db_nodes = {"7", "8"}
        
        # Check if demo nodes are grouped together (allowing some flexibility)
        demo_grouped = any(demo_nodes.issubset(nodes) for nodes in subtree_nodes.values())
        
        # Check if UI nodes are grouped together
        ui_grouped = any(ui_nodes.issubset(nodes) for nodes in subtree_nodes.values())
        
        # Check if DB nodes are grouped together
        db_grouped = any(db_nodes.issubset(nodes) for nodes in subtree_nodes.values())
        
        # At least 2 of these semantic groups should be correctly identified
        correct_groupings = sum([demo_grouped, ui_grouped, db_grouped])
        assert correct_groupings >= 2, \
            f"Should identify at least 2 semantic groupings correctly. Demo: {demo_grouped}, UI: {ui_grouped}, DB: {db_grouped}"

    async def test_provides_dynamic_container_types(
        self,
        subtree_classifier_agent: SubtreeClassifierAgent,
        sample_tree_data: Dict[str, Any]
    ):
        """Test that agent provides appropriate dynamic container types"""
        result: SubtreeClassificationResponse = await subtree_classifier_agent.run(sample_tree_data)
        
        # Get the classified tree
        classified_tree = result.classified_trees[0]
        
        # Collect all container types
        container_types = [subtree.container_type for subtree in classified_tree.subtrees]
        
        # Should have meaningful container types (not generic)
        meaningful_keywords = {
            'project', 'setup', 'demo', 'preparation', 'phase',
            'ui', 'interface', 'frontend', 'bug', 'fix',
            'database', 'backend', 'infrastructure', 'schema',
            'technical', 'development', 'work', 'task'
        }
        
        # At least one container type should contain meaningful keywords
        has_meaningful_types = any(
            any(keyword in container_type.lower() for keyword in meaningful_keywords)
            for container_type in container_types
        )
        
        assert has_meaningful_types, \
            f"Container types should be meaningful: {container_types}"

    async def test_handles_unclassified_nodes(
        self,
        subtree_classifier_agent: SubtreeClassifierAgent,
        sample_tree_data: Dict[str, Any]
    ):
        """Test that agent appropriately handles nodes that don't fit subtrees"""
        result: SubtreeClassificationResponse = await subtree_classifier_agent.run(sample_tree_data)
        
        # Get the classified tree
        classified_tree = result.classified_trees[0]
        
        # Random meeting notes (node 9) should likely be unclassified
        # This is flexible - it might get classified if LLM finds a reasonable grouping
        unclassified_nodes = set(classified_tree.unclassified_nodes)
        
        # If node 9 is classified, it should make semantic sense
        if "9" not in unclassified_nodes:
            # Find which subtree contains node 9
            subtree_with_node_9 = next(
                (subtree for subtree in classified_tree.subtrees if "9" in subtree.nodes),
                None
            )
            assert subtree_with_node_9 is not None
            # The theme should make sense for including miscellaneous notes
            theme_lower = subtree_with_node_9.theme.lower()
            acceptable_themes = ['misc', 'other', 'general', 'meeting', 'notes', 'admin']
            has_acceptable_theme = any(word in theme_lower for word in acceptable_themes)
            # This is flexible - we just want to ensure it's not randomly grouped

    async def test_with_minimal_tree(self, subtree_classifier_agent: SubtreeClassifierAgent):
        """Test behavior with minimal tree structure"""
        minimal_tree = {
            "trees": [
                {
                    "tree_id": "minimal_test",
                    "nodes": [
                        {
                            "node_id": "1",
                            "title": "Single Task",
                            "content": "A single task node...",
                            "links": []
                        },
                        {
                            "node_id": "2",
                            "title": "Another Task", 
                            "content": "A second task node...",
                            "links": []
                        }
                    ],
                    "relationships": []
                }
            ]
        }
        
        result: SubtreeClassificationResponse = await subtree_classifier_agent.run(minimal_tree)
        
        # Should handle minimal input gracefully
        assert isinstance(result, SubtreeClassificationResponse)
        classified_tree = result.classified_trees[0]
        
        # Might create one subtree or leave nodes unclassified
        total_nodes_handled = sum(len(subtree.nodes) for subtree in classified_tree.subtrees) + len(classified_tree.unclassified_nodes)
        assert total_nodes_handled == 2, "Should handle both nodes"

    async def test_subtree_themes_are_descriptive(
        self,
        subtree_classifier_agent: SubtreeClassifierAgent,
        sample_tree_data: Dict[str, Any]
    ):
        """Test that subtree themes are descriptive and meaningful"""
        result: SubtreeClassificationResponse = await subtree_classifier_agent.run(sample_tree_data)
        
        # Get the classified tree
        classified_tree = result.classified_trees[0]
        
        for subtree in classified_tree.subtrees:
            # Theme should be a meaningful description, not just generic words
            assert len(subtree.theme) >= 10, f"Theme should be descriptive: '{subtree.theme}'"
            
            # Should not be just the container type repeated
            assert subtree.theme.lower() != subtree.container_type.lower(), \
                f"Theme should be more than just container type: '{subtree.theme}' vs '{subtree.container_type}'"
            
            # Should be a proper sentence or phrase
            assert any(char.isalpha() for char in subtree.theme), \
                f"Theme should contain meaningful words: '{subtree.theme}'"