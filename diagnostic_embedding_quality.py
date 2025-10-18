"""
Diagnostic script to evaluate embedding search quality with detailed output.
Shows actual node content, scores, and rankings.
"""
import asyncio
import os
import tempfile
import shutil

from backend.markdown_tree_manager.markdown_tree_ds import MarkdownTree
from backend.text_to_graph_pipeline.chunk_processing_pipeline import ChunkProcessor

# Import test fixtures
import sys
sys.path.append('backend/tests/integration_tests/text_to_graph_pipeline/chunk_processing_pipeline')
from test_pipeline_e2e_with_real_embeddings import (
    CleanMockTreeActionDeciderWorkflow,
    generate_topic_based_sentence
)


async def main():
    # Create temp directory
    temp_dir = tempfile.mkdtemp(prefix="embedding_diagnostic_")
    os.environ['VOICETREE_TEST_MODE'] = 'false'

    try:
        print("="*80)
        print("EMBEDDING QUALITY DIAGNOSTIC")
        print("="*80)

        # Create tree directly without ChunkProcessor to avoid buffering issues
        decision_tree = MarkdownTree(output_dir=temp_dir)

        from backend.text_to_graph_pipeline.agentic_workflows.models import CreateAction
        from backend.text_to_graph_pipeline.chunk_processing_pipeline.apply_tree_actions import TreeActionApplier

        action_applier = TreeActionApplier(decision_tree)
        node_metadata = {}  # Maps node_id -> metadata

        # Create 50 nodes (5 topics × 2 subtopics × 5 sentences = 50)
        # This will include Programming (0-24) and Cooking (25-49)
        print("\nCreating 50 nodes with clean semantic boundaries (Programming + Cooking)...")
        first_node_id = None
        next_node_id = 1

        for i in range(50):
            sentence, metadata = generate_topic_based_sentence(i)

            # Create node directly
            action = CreateAction(
                action="CREATE",
                parent_node_id=first_node_id,  # All nodes are children of first node
                new_node_name=f"Node_{next_node_id}",
                content=sentence,
                summary=f"Summary of Node_{next_node_id}",
                relationship="child of"
            )

            result_nodes = action_applier.apply([action])
            if result_nodes:
                # Get the newly created node (the one with the highest ID)
                new_node_id = max(result_nodes)
                if first_node_id is None:
                    first_node_id = new_node_id

                # Store metadata
                node_metadata[new_node_id] = metadata
                print(f"  Node {new_node_id}: {metadata['parent_topic']} > {metadata['subtopic']}")
                next_node_id = max(decision_tree.tree.keys()) + 1

        print(f"\nCreated {len(decision_tree.tree)} nodes total")
        print("Waiting 15 seconds for embeddings to complete...")
        await asyncio.sleep(15)
        print("Embeddings should be ready now.")

        # Test queries
        test_cases = [
            {
                "query": "Python programming language syntax variables",
                "expected": "Programming > Python Basics"
            },
            {
                "query": "baking bread flour yeast dough",
                "expected": "Cooking > Baking"
            },
            {
                "query": "Python Django Flask web development APIs",
                "expected": "Programming > Web Development"
            }
        ]

        from backend.markdown_tree_manager.graph_search.tree_functions import (
            hybrid_search_for_relevant_nodes,
            search_similar_nodes_bm25
        )

        for test_case in test_cases:
            print("\n" + "="*80)
            print(f"QUERY: '{test_case['query']}'")
            print(f"EXPECTED: {test_case['expected']}")
            print("="*80)

            # Get BM25 results with scores
            print("\n--- BM25 SEARCH RESULTS ---")
            bm25_results = search_similar_nodes_bm25(
                decision_tree,
                test_case['query'],
                top_k=10
            )

            for rank, (node_id, score) in enumerate(bm25_results, 1):
                if node_id in node_metadata:
                    metadata = node_metadata[node_id]
                    node = decision_tree.tree[node_id]
                    content_preview = node.content[:100].replace('\n', ' ')

                    print(f"\n#{rank} (score: {score:.4f})")
                    print(f"  Topic: {metadata['parent_topic']} > {metadata['subtopic']}")
                    print(f"  Content: {content_preview}...")

            # Get vector search results with scores
            print("\n--- VECTOR SEARCH RESULTS ---")
            vector_results = decision_tree.search_similar_nodes_vector(
                test_case['query'],
                top_k=10
            )

            for rank, (node_id, score) in enumerate(vector_results, 1):
                if node_id in node_metadata:
                    metadata = node_metadata[node_id]
                    node = decision_tree.tree[node_id]
                    content_preview = node.content[:100].replace('\n', ' ')

                    print(f"\n#{rank} (score: {score:.4f})")
                    print(f"  Topic: {metadata['parent_topic']} > {metadata['subtopic']}")
                    print(f"  Content: {content_preview}...")

            # Get hybrid search results
            print("\n--- HYBRID SEARCH RESULTS (BM25 + Vector + RRF) ---")
            hybrid_results = hybrid_search_for_relevant_nodes(
                decision_tree,
                test_case['query'],
                max_return_nodes=10,
                vector_score_threshold=0.0,  # TEST: Remove threshold to see all results
                bm25_score_threshold=0.0     # TEST: Remove threshold to see all results
            )

            for rank, node_id in enumerate(hybrid_results, 1):
                if node_id in node_metadata:
                    metadata = node_metadata[node_id]
                    node = decision_tree.tree[node_id]
                    content_preview = node.content[:100].replace('\n', ' ')

                    # Check if correct
                    is_correct = f"{metadata['parent_topic']} > {metadata['subtopic']}" == test_case['expected']
                    marker = "✓" if is_correct else "✗"

                    print(f"\n#{rank} {marker}")
                    print(f"  Topic: {metadata['parent_topic']} > {metadata['subtopic']}")
                    print(f"  Content: {content_preview}...")

    finally:
        # Cleanup
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)
        os.environ['VOICETREE_TEST_MODE'] = 'true'


if __name__ == "__main__":
    asyncio.run(main())
