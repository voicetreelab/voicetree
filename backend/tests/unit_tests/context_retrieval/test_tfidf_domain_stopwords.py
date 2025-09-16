"""
Test TF-IDF with domain-aware stopwords for mathematical word problems

This test demonstrates how domain-specific stopwords improve relevance
for queries about animals and locations in mathematical contexts.
"""
from backend.markdown_tree_manager.markdown_tree_ds import Node, MarkdownTree
from backend.markdown_tree_manager.graph_search.tree_functions import get_most_relevant_nodes


class TestTfidfDomainStopwords:
    """Test TF-IDF with domain-specific stopwords"""
    
    def test_animal_location_queries_with_domain_stopwords(self):
        """
        Test that domain stopwords help focus on entities (animals/locations)
        rather than common pattern words (average, number, adult, etc.)
        """
        # Create a decision tree with animal/location nodes
        tree = MarkdownTree()
        
        # Node 1: Giraffe in Shardlight Chasms
        node_1 = Node(
            name="Average Newborn Children per Adult Giraffe in Shardlight Chasms",
            node_id=1,
            content="# Giraffe Statistics",
            summary="The average number of newborn children per adult giraffe in Shardlight Chasms",
            parent_id=None
        )
        tree.tree[1] = node_1
        
        # Node 2: Parrot in Bundle Ranch
        node_2 = Node(
            name="Number of Adult Parrot in Bundle Ranch",
            node_id=2,
            content="# Parrot Population",
            summary="Total number of adult parrots living in Bundle Ranch",
            parent_id=None
        )
        tree.tree[2] = node_2
        
        # Node 3: Crow in South Zoo (different animal, different location)
        node_3 = Node(
            name="Average Number of Newborn Children per Adult Crow in South Zoo",
            node_id=3,
            content="# Crow Statistics",
            summary="Average number of newborn children per adult crow in South Zoo",
            parent_id=None
        )
        tree.tree[3] = node_3
        
        # Node 4: Crow in Bundle Ranch (different animal, same location as parrot)
        node_4 = Node(
            name="Total Adult Crow Population at Bundle Ranch",
            node_id=4,
            content="# Crow Population",
            summary="The total number of adult crows at Bundle Ranch facility",
            parent_id=None
        )
        tree.tree[4] = node_4
        
        # Query about giraffes and parrots
        query = "The average number of newborn children per adult giraffe in Shardlight Chasms equals the sum of the average number of newborn children per adult parrot in Bundle Ranch"
        
        # Get results with limit=3 to ensure TF-IDF has room to select
        # (with limit=2, only 1 slot is available for TF-IDF after recency selection)
        results = get_most_relevant_nodes(tree, limit=3, query=query)
        result_ids = [node.id for node in results]
        
        # With domain stopwords, should prioritize nodes with matching animals/locations
        # Node 1 (giraffe + Shardlight Chasms) and Node 2 (parrot + Bundle Ranch)
        # should be in top 3
        assert 1 in result_ids, "Giraffe in Shardlight Chasms should be selected"
        assert 2 in result_ids, "Parrot in Bundle Ranch should be selected"
        
        # Check ordering by getting just top 2
        top_2_results = get_most_relevant_nodes(tree, limit=2, query=query)
        top_2_ids = [node.id for node in top_2_results]
        
        # At least one of the target nodes should be in top 2
        assert 1 in top_2_ids or 2 in top_2_ids, "At least one target node should be in top 2"
    
    def test_location_importance_with_domain_stopwords(self):
        """
        Test that locations become more important when pattern words are filtered
        """
        tree = MarkdownTree()
        
        # Add nodes with same animal but different locations
        locations = [
            (1, "Bundle Ranch", "Statistics for adult parrots at Bundle Ranch"),
            (2, "Shardlight Chasms", "Statistics for adult parrots at Shardlight Chasms"),
            (3, "South Zoo", "Statistics for adult parrots at South Zoo"),
            (4, "Hamilton Farm", "Statistics for adult parrots at Hamilton Farm"),
        ]
        
        for node_id, location, summary in locations:
            node = Node(
                name=f"Average Number of Newborn Children per Adult Parrot in {location}",
                node_id=node_id,
                content=f"# Parrot Statistics at {location}",
                summary=summary,
                parent_id=None
            )
            tree.tree[node_id] = node
        
        # Query specifically about Bundle Ranch
        query = "What is the average number of newborn children per adult parrot in Bundle Ranch?"
        
        # Get top result
        result = get_most_relevant_nodes(tree, limit=1, query=query)
        
        # Should select Bundle Ranch node (id=1) over others
        assert result[0].id == 1, f"Should select Bundle Ranch node, got {result[0].title}"
    
    def test_animal_type_importance_with_domain_stopwords(self):
        """
        Test that animal types become more important when pattern words are filtered
        """
        tree = MarkdownTree()
        
        # Add nodes with same location but different animals
        animals = [
            (1, "Giraffe", "Population statistics for giraffes"),
            (2, "Parrot", "Population statistics for parrots"),
            (3, "Crow", "Population statistics for crows"),
            (4, "Elephant", "Population statistics for elephants"),
        ]
        
        for node_id, animal, summary in animals:
            node = Node(
                name=f"Total Number of Adult {animal} in Bundle Ranch",
                node_id=node_id,
                content=f"# {animal} Population",
                summary=f"{summary} at Bundle Ranch facility",
                parent_id=None
            )
            tree.tree[node_id] = node
        
        # Query about elephants
        query = "Calculate the total number of adult elephants in Bundle Ranch"
        
        # Get top result
        result = get_most_relevant_nodes(tree, limit=1, query=query)
        
        # Should select Elephant node (id=4) over others
        assert result[0].id == 4, f"Should select Elephant node, got {result[0].title}"