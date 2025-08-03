"""
Behavioral test for SubtreeClassifierAgent
Tests the agent's ability to classify tree nodes into meaningful subtrees using LLM
"""

import pytest
from typing import List

from backend.text_to_graph_pipeline.agentic_workflows.models import (
    TreeData, TreeNode, SubtreeClassificationResponse, ClassifiedTree, SubtreeGroup
)


@pytest.mark.asyncio
class TestSubtreeClassifierBehavior:
    """Test subtree classifier behavioral patterns for dynamic subtree identification"""

    @pytest.fixture
    def sample_demo_tree_data(self) -> TreeData:
        """Create sample tree data based on real VoiceTree demo data"""
        return TreeData(
            tree_id="2025-08-02_20250802_150743",
            nodes=[
                TreeNode(
                    node_id="1",
                    title="Demo Completion Goal",
                    content="The demo has been recorded and completed. The video check for the demo was also completed.",
                    links=[]
                ),
                TreeNode(
                    node_id="2", 
                    title="Verify VoiceTree Functionality",
                    content="The first step for the demo is to ensure that VoiceTree is working correctly. Let's verify its functionality now.",
                    links=["1_Demo_Completion_Goal.md"]
                ),
                TreeNode(
                    node_id="7",
                    title="Problems with VoiceTree", 
                    content="Several real and known problems with VoiceTree will be addressed and fixed during the Software Engineering Demo Part. These include: Graph Flickering Issue, Terminal Default Height Issue, Terminal Not Moving with Graph Issue, VoiceTree Navigation Difficulty, Annoying Zoom Issue, Markdown Problem, File Referencing Difficulty.",
                    links=["5_Software_Engineering_Demo_Part.md"]
                ),
                TreeNode(
                    node_id="8",
                    title="Graph Flickering Issue",
                    content="The graph has flickering issues that need to be resolved for better user experience.",
                    links=["7_Problems_with_VoiceTree.md"]
                ),
                TreeNode(
                    node_id="9",
                    title="Terminal Default Height Issue", 
                    content="The terminal has default height problems that affect usability.",
                    links=["7_Problems_with_VoiceTree.md"]
                ),
                TreeNode(
                    node_id="5",
                    title="Software Engineering Demo Part",
                    content="This part of the demo will showcase fixing real VoiceTree problems through software engineering practices.",
                    links=["1_Demo_Completion_Goal.md"]
                )
            ]
        )

    async def test_classifies_tree_into_meaningful_subtrees(self, sample_demo_tree_data: TreeData):
        """Test that agent identifies meaningful subtree groupings"""
        # Import here to avoid circular import issues during test discovery
        from backend.text_to_graph_pipeline.agentic_workflows.agents.subtree_classifier_agent import SubtreeClassifierAgent
        
        agent = SubtreeClassifierAgent()
        
        # Run classification
        result: SubtreeClassificationResponse = await agent.run(sample_demo_tree_data)
        
        # Verify structure
        assert isinstance(result, SubtreeClassificationResponse)
        assert len(result.classified_trees) == 1
        assert result.reasoning is not None
        assert len(result.reasoning.strip()) > 0
        
        classified_tree = result.classified_trees[0]
        assert classified_tree.tree_id == "2025-08-02_20250802_150743"
        
        # Should identify 2-6 subtrees as per requirements
        assert 2 <= len(classified_tree.subtrees) <= 6, f"Expected 2-6 subtrees, got {len(classified_tree.subtrees)}"
        
        # Each subtree should have meaningful properties
        for subtree in classified_tree.subtrees:
            assert isinstance(subtree, SubtreeGroup)
            assert len(subtree.subtree_id.strip()) > 0
            assert len(subtree.container_type.strip()) > 0
            assert len(subtree.theme.strip()) > 0
            assert len(subtree.nodes) > 0
            
            # All node IDs should be valid
            for node_id in subtree.nodes:
                assert node_id in ["1", "2", "5", "7", "8", "9"]

    async def test_identifies_technical_issues_grouping(self, sample_demo_tree_data: TreeData):
        """Test that agent can identify technical issues as a coherent group"""
        from backend.text_to_graph_pipeline.agentic_workflows.agents.subtree_classifier_agent import SubtreeClassifierAgent
        
        agent = SubtreeClassifierAgent()
        result: SubtreeClassificationResponse = await agent.run(sample_demo_tree_data)
        
        classified_tree = result.classified_trees[0]
        
        # Should identify technical issues (nodes 7, 8, 9) as related
        # Look for a subtree that contains multiple technical issue nodes
        technical_subtrees = []
        for subtree in classified_tree.subtrees:
            technical_nodes = [node_id for node_id in subtree.nodes if node_id in ["7", "8", "9"]]
            if len(technical_nodes) >= 2:
                technical_subtrees.append(subtree)
        
        assert len(technical_subtrees) > 0, "Should identify technical issues as a coherent grouping"
        
        # Check that the technical subtree has appropriate theme/container type
        tech_subtree = technical_subtrees[0]
        theme_lower = tech_subtree.theme.lower()
        container_lower = tech_subtree.container_type.lower()
        
        technical_keywords = ['problem', 'issue', 'bug', 'fix', 'technical', 'engineering']
        assert any(keyword in theme_lower for keyword in technical_keywords) or \
               any(keyword in container_lower for keyword in technical_keywords), \
               f"Technical subtree should have technical theme. Theme: {tech_subtree.theme}, Container: {tech_subtree.container_type}"

    async def test_identifies_demo_preparation_grouping(self, sample_demo_tree_data: TreeData):
        """Test that agent can identify demo preparation as a coherent group"""
        from backend.text_to_graph_pipeline.agentic_workflows.agents.subtree_classifier_agent import SubtreeClassifierAgent
        
        agent = SubtreeClassifierAgent()
        result: SubtreeClassificationResponse = await agent.run(sample_demo_tree_data)
        
        classified_tree = result.classified_trees[0]
        
        # Should identify demo-related nodes (1, 2, 5) as related
        demo_subtrees = []
        for subtree in classified_tree.subtrees:
            demo_nodes = [node_id for node_id in subtree.nodes if node_id in ["1", "2", "5"]]
            if len(demo_nodes) >= 2:
                demo_subtrees.append(subtree)
        
        assert len(demo_subtrees) > 0, "Should identify demo preparation as a coherent grouping"
        
        # Check that the demo subtree has appropriate theme/container type
        demo_subtree = demo_subtrees[0]
        theme_lower = demo_subtree.theme.lower()
        container_lower = demo_subtree.container_type.lower()
        
        demo_keywords = ['demo', 'preparation', 'completion', 'verify', 'functionality']
        assert any(keyword in theme_lower for keyword in demo_keywords) or \
               any(keyword in container_lower for keyword in demo_keywords), \
               f"Demo subtree should have demo-related theme. Theme: {demo_subtree.theme}, Container: {demo_subtree.container_type}"

    async def test_handles_unclassified_nodes_appropriately(self, sample_demo_tree_data: TreeData):
        """Test that agent appropriately handles nodes that don't fit into subtrees"""
        from backend.text_to_graph_pipeline.agentic_workflows.agents.subtree_classifier_agent import SubtreeClassifierAgent
        
        agent = SubtreeClassifierAgent()
        result: SubtreeClassificationResponse = await agent.run(sample_demo_tree_data)
        
        classified_tree = result.classified_trees[0]
        
        # Verify all nodes are accounted for
        classified_nodes = set()
        for subtree in classified_tree.subtrees:
            classified_nodes.update(subtree.nodes)
        classified_nodes.update(classified_tree.unclassified_nodes)
        
        expected_nodes = {"1", "2", "5", "7", "8", "9"}
        assert classified_nodes == expected_nodes, f"All nodes should be accounted for. Expected: {expected_nodes}, Got: {classified_nodes}"
        
        # Unclassified nodes should be valid node IDs
        for node_id in classified_tree.unclassified_nodes:
            assert node_id in expected_nodes

    async def test_dynamic_container_types(self, sample_demo_tree_data: TreeData):
        """Test that agent uses dynamic container types based on content"""
        from backend.text_to_graph_pipeline.agentic_workflows.agents.subtree_classifier_agent import SubtreeClassifierAgent
        
        agent = SubtreeClassifierAgent()
        result: SubtreeClassificationResponse = await agent.run(sample_demo_tree_data)
        
        classified_tree = result.classified_trees[0]
        
        # Should have varied container types, not just one generic type
        container_types = [subtree.container_type for subtree in classified_tree.subtrees]
        
        assert len(container_types) > 0
        # Container types should be meaningful strings
        for container_type in container_types:
            assert len(container_type.strip()) > 0
            assert container_type.strip().lower() != 'none'
            assert container_type.strip().lower() != 'unknown'

    async def test_with_minimal_tree_data(self):
        """Test behavior with minimal tree data"""
        from backend.text_to_graph_pipeline.agentic_workflows.agents.subtree_classifier_agent import SubtreeClassifierAgent
        
        minimal_tree_data = TreeData(
            tree_id="minimal_test",
            nodes=[
                TreeNode(
                    node_id="1",
                    title="Single Topic",
                    content="This is the only topic available.",
                    links=[]
                )
            ]
        )
        
        agent = SubtreeClassifierAgent()
        result: SubtreeClassificationResponse = await agent.run(minimal_tree_data)
        
        classified_tree = result.classified_trees[0]
        
        # With only one node, might create one subtree or leave unclassified
        total_nodes_classified = len(classified_tree.unclassified_nodes)
        for subtree in classified_tree.subtrees:
            total_nodes_classified += len(subtree.nodes)
        
        assert total_nodes_classified == 1, "Single node should be accounted for"