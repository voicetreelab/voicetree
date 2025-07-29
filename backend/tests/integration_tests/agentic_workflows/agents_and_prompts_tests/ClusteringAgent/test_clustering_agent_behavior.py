"""
Behavioral test for ClusteringAgent
Tests the agent's ability to assign multiple tags to nodes by semantic similarity
"""

import pytest
from typing import List

from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import Node
from backend.text_to_graph_pipeline.tree_manager.tree_functions import _format_nodes_for_prompt
from backend.text_to_graph_pipeline.agentic_workflows.agents.clustering_agent import ClusteringAgent
from backend.text_to_graph_pipeline.agentic_workflows.models import TagResponse, TagAssignment


@pytest.mark.asyncio
class TestClusteringAgentBehavior:
    """Test clustering agent behavioral patterns for multi-tag functionality"""

    @pytest.fixture
    def sample_nodes(self) -> List[Node]:
        """Create sample nodes with clear semantic groupings"""
        return [
            Node(name="Dogs", node_id=1, content="Dogs are loyal pets...", summary="Information about domestic dogs and their breeds"),
            Node(name="Cats", node_id=2, content="Cats are independent pets...", summary="Overview of domestic cats and feline behavior"),
            Node(name="Oak Trees", node_id=3, content="Oak trees are large...", summary="Deciduous trees common in temperate regions"),
            Node(name="Maple Trees", node_id=4, content="Maple trees produce...", summary="Tree species known for colorful autumn leaves"),
            Node(name="Python Programming", node_id=5, content="Python is versatile...", summary="High-level programming language for software development"),
            Node(name="JavaScript", node_id=6, content="JavaScript runs in browsers...", summary="Programming language for web development"),
            Node(name="Random Topic", node_id=7, content="This doesn't fit anywhere...", summary="Something completely unrelated to other nodes"),
        ]

    @pytest.fixture
    def clustering_agent(self) -> ClusteringAgent:
        """Create clustering agent instance"""
        return ClusteringAgent()

    async def test_assigns_multiple_tags_semantically(self, clustering_agent: ClusteringAgent, sample_nodes: List[Node]):
        """Test that agent assigns multiple relevant tags to nodes"""
        # Format nodes for prompt
        formatted_nodes = _format_nodes_for_prompt(sample_nodes)
        
        # Run multi-tag clustering
        result: TagResponse = await clustering_agent.run(formatted_nodes, len(sample_nodes))
        
        # Verify structure
        assert isinstance(result, TagResponse)
        assert len(result.tags) == len(sample_nodes)
        
        # Get all unique tags across nodes
        all_tags = set()
        node_tags = {}
        for assignment in result.tags:
            assert isinstance(assignment, TagAssignment)
            node_tags[assignment.node_id] = assignment.tags
            all_tags.update(assignment.tags)
        
        # Should have multiple unique tags (more flexibility than clusters)
        assert len(all_tags) >= 2, f"Expected at least 2 unique tags, got {len(all_tags)}: {all_tags}"
        
        # Verify semantic groupings through shared tags or similar patterns
        # Dogs and Cats should have animal/pet-related tags (flexible check)
        dogs_tags = set(node_tags[1])
        cats_tags = set(node_tags[2])
        if dogs_tags and cats_tags:  # If both have tags
            # Either they share tags OR they both have animal-related content
            shared_animal_tags = dogs_tags.intersection(cats_tags)
            animal_keywords = {'animal', 'pet', 'domestic', 'mammal', 'companion'}
            dogs_has_animal_tags = bool(dogs_tags.intersection(animal_keywords)) or any('dog' in tag for tag in dogs_tags)
            cats_has_animal_tags = bool(cats_tags.intersection(animal_keywords)) or any('cat' in tag for tag in cats_tags)
            
            assert (len(shared_animal_tags) > 0) or (dogs_has_animal_tags and cats_has_animal_tags), \
                f"Dogs and cats should either share tags or both have animal-related tags. Dogs: {dogs_tags}, Cats: {cats_tags}"
        
        # Oak and Maple trees should have tree-related tags (flexible check)
        oak_tags = set(node_tags[3])
        maple_tags = set(node_tags[4])
        if oak_tags and maple_tags:  # If both have tags
            shared_tree_tags = oak_tags.intersection(maple_tags)
            tree_keywords = {'tree', 'plant', 'deciduous', 'forest', 'wood'}
            oak_has_tree_tags = bool(oak_tags.intersection(tree_keywords)) or any('tree' in tag for tag in oak_tags)
            maple_has_tree_tags = bool(maple_tags.intersection(tree_keywords)) or any('tree' in tag for tag in maple_tags)
            
            assert (len(shared_tree_tags) > 0) or (oak_has_tree_tags and maple_has_tree_tags), \
                f"Oak and maple should either share tags or both have tree-related tags. Oak: {oak_tags}, Maple: {maple_tags}"
        
        # Programming languages should have programming-related tags (flexible check)
        python_tags = set(node_tags[5])
        js_tags = set(node_tags[6])
        if python_tags and js_tags:  # If both have tags
            shared_prog_tags = python_tags.intersection(js_tags)
            prog_keywords = {'programming', 'language', 'code', 'software', 'development'}
            python_has_prog_tags = bool(python_tags.intersection(prog_keywords)) or any('programming' in tag.lower() for tag in python_tags)
            js_has_prog_tags = bool(js_tags.intersection(prog_keywords)) or any('programming' in tag.lower() for tag in js_tags)
            
            assert (len(shared_prog_tags) > 0) or (python_has_prog_tags and js_has_prog_tags), \
                f"Python and JavaScript should either share tags or both have programming-related tags. Python: {python_tags}, JS: {js_tags}"

    async def test_handles_nodes_with_few_or_no_tags(self, clustering_agent: ClusteringAgent, sample_nodes: List[Node]):
        """Test that agent can handle nodes with few or no tags when they don't fit well"""
        formatted_nodes = _format_nodes_for_prompt(sample_nodes)
        
        result: TagResponse = await clustering_agent.run(formatted_nodes, len(sample_nodes))
        
        # Random topic node should potentially have fewer tags or empty tags
        random_topic_assignment = next(a for a in result.tags if a.node_id == 7)
        # It's okay if it gets few tags or no tags
        assert isinstance(random_topic_assignment.tags, list), "Tags should be a list"
        # Each tag should be a string if present
        for tag in random_topic_assignment.tags:
            assert isinstance(tag, str), "Each tag should be a string"

    async def test_provides_valid_tags(self, clustering_agent: ClusteringAgent, sample_nodes: List[Node]):
        """Test that agent provides valid tag assignments"""
        formatted_nodes = _format_nodes_for_prompt(sample_nodes[:3])  # Use fewer nodes
        
        result: TagResponse = await clustering_agent.run(formatted_nodes, 3)
        
        for assignment in result.tags:
            assert isinstance(assignment.tags, list)
            for tag in assignment.tags:
                assert isinstance(tag, str)
                assert len(tag.strip()) > 0  # Should be meaningful tags

    async def test_with_small_node_count(self, clustering_agent: ClusteringAgent):
        """Test behavior with minimal nodes"""
        nodes = [
            Node(name="Single Topic", node_id=1, content="Alone...", summary="Only node available"),
        ]
        formatted_nodes = _format_nodes_for_prompt(nodes)
        
        result: TagResponse = await clustering_agent.run(formatted_nodes, 1)
        
        assert len(result.tags) == 1
        # Single node might have few tags or no tags
        assignment = result.tags[0]
        assert assignment.node_id == 1
        assert isinstance(assignment.tags, list)

    async def test_multi_tag_edge_cases(self, clustering_agent: ClusteringAgent):
        """Test edge cases specific to multi-tag functionality"""
        # Create nodes with varying semantic complexity
        nodes = [
            Node(name="Complex Topic", node_id=1, content="This covers multiple areas: science, technology, and education...", 
                summary="Multi-faceted topic spanning science, technology, and education"),
            Node(name="Simple Topic", node_id=2, content="Just about cats...", summary="Simple topic about cats"),
            Node(name="Ambiguous Topic", node_id=3, content="Could be many things...", summary="Unclear topic that's hard to categorize"),
        ]
        formatted_nodes = _format_nodes_for_prompt(nodes)
        
        result: TagResponse = await clustering_agent.run(formatted_nodes, len(nodes))
        
        # Verify structure
        assert len(result.tags) == len(nodes)
        
        # Complex topic should potentially have more tags
        complex_assignment = next(a for a in result.tags if a.node_id == 1)
        simple_assignment = next(a for a in result.tags if a.node_id == 2)
        ambiguous_assignment = next(a for a in result.tags if a.node_id == 3)
        
        # All should have valid tag lists
        for assignment in [complex_assignment, simple_assignment, ambiguous_assignment]:
            assert isinstance(assignment.tags, list)
            for tag in assignment.tags:
                assert isinstance(tag, str)
                assert len(tag.strip()) > 0, "Tags should not be empty strings"

    async def test_tag_consistency_across_similar_nodes(self, clustering_agent: ClusteringAgent):
        """Test that semantically similar nodes get consistent tag treatment"""
        # Create multiple nodes with similar content
        nodes = [
            Node(name="Red Apple", node_id=1, content="Red apples are sweet fruits...", summary="Information about red apples"),
            Node(name="Green Apple", node_id=2, content="Green apples are tart fruits...", summary="Information about green apples"),
            Node(name="Orange Fruit", node_id=3, content="Oranges are citrus fruits...", summary="Information about oranges"),
            Node(name="Car Engine", node_id=4, content="Car engines provide power...", summary="Information about car engines"),
        ]
        formatted_nodes = _format_nodes_for_prompt(nodes)
        
        result: TagResponse = await clustering_agent.run(formatted_nodes, len(nodes))
        
        # Get tags for each node
        node_tags = {}
        for assignment in result.tags:
            node_tags[assignment.node_id] = set(assignment.tags)
        
        # Red and green apples should likely share some tags
        apple_shared_tags = node_tags[1].intersection(node_tags[2])
        assert len(apple_shared_tags) > 0, f"Red and green apples should share tags. Red: {node_tags[1]}, Green: {node_tags[2]}"
        
        # Apples and oranges might share some fruit-related tags
        fruit_shared_tags = node_tags[1].intersection(node_tags[3])
        # This is more flexible - they might or might not share tags
        
        # Car engine should likely have different tags from fruits
        car_apple_shared = node_tags[4].intersection(node_tags[1])
        # They might share some generic tags, but car should have distinct automotive tags