"""
Minimal test to isolate vector embedding quality issue.

Tests the embedding function directly without any VoiceTree search logic.
"""
import os
import tempfile
import shutil

# Disable test mode to use real embeddings
os.environ['VOICETREE_TEST_MODE'] = 'false'

from backend.markdown_tree_manager.embeddings.chromadb_vector_store import ChromaDBVectorStore


def test_vector_embeddings_isolated():
    """
    Minimal test showing vector embeddings fail to find Cooking nodes for a Cooking query.

    This test:
    1. Creates a ChromaDB collection with real embeddings
    2. Adds 5 Cooking nodes and 5 Programming nodes
    3. Searches for "baking bread flour yeast dough"
    4. Shows that vector search returns ZERO Cooking nodes
    """
    temp_dir = tempfile.mkdtemp(prefix="vector_isolation_test_")

    try:
        print("="*80)
        print("ISOLATED VECTOR EMBEDDING TEST")
        print("="*80)

        # Create vector store with real embeddings
        store = ChromaDBVectorStore(
            collection_name="test_isolation",
            persist_directory=temp_dir,
            use_embeddings=True
        )

        print("\n--- Creating Test Nodes ---")

        # Create mock nodes (just need id, content, title)
        class MockNode:
            def __init__(self, node_id, title, content):
                self.id = node_id
                self.title = title
                self.content = content
                self.summary = f"Summary of {title}"

        # 5 Cooking nodes
        cooking_nodes = {
            1: MockNode(1, "Baking Bread", "Baking bread requires precise measurements of flour, water, yeast, and salt."),
            2: MockNode(2, "Gluten Development", "Gluten development occurs when flour proteins form networks during kneading."),
            3: MockNode(3, "Sourdough", "Sourdough starters contain wild yeast and bacteria for natural fermentation."),
            4: MockNode(4, "Proofing", "Proofing allows yeast to ferment and produce carbon dioxide for rising."),
            5: MockNode(5, "Oven Temperature", "Oven temperature significantly affects the texture and crust of baked goods."),
        }

        # 5 Programming nodes
        programming_nodes = {
            6: MockNode(6, "Python Basics", "Python is a high-level programming language known for its clear syntax and readability."),
            7: MockNode(7, "Variables", "Variables in Python do not need explicit type declarations due to dynamic typing."),
            8: MockNode(8, "Flask", "Flask offers a lightweight approach to building web applications with minimal boilerplate."),
            9: MockNode(9, "NumPy", "NumPy provides efficient arrays and mathematical operations for numerical computing."),
            10: MockNode(10, "Testing", "Unit tests verify that individual functions and methods work correctly in isolation."),
        }

        print("\nCooking Nodes:")
        for node_id, node in cooking_nodes.items():
            print(f"  {node_id}: {node.title} - {node.content[:60]}...")

        print("\nProgramming Nodes:")
        for node_id, node in programming_nodes.items():
            print(f"  {node_id}: {node.title} - {node.content[:60]}...")

        # Add all nodes to vector store
        all_nodes = {**cooking_nodes, **programming_nodes}
        store.add_nodes(all_nodes)

        print("\n✓ Added 10 nodes to ChromaDB (5 Cooking + 5 Programming)")

        # Wait a moment for embeddings to be generated
        import time
        time.sleep(2)

        # Perform vector search directly on ChromaDB
        query = "baking bread flour yeast dough"
        print(f"\n--- Vector Search Query ---")
        print(f"Query: '{query}'")
        print(f"Expected: Cooking nodes (IDs 1-5)")

        results = store.search(
            query=query,
            top_k=10,
            include_scores=True
        )

        print(f"\n--- Results (Top 10) ---")
        cooking_count = 0
        programming_count = 0

        for rank, (node_id, score) in enumerate(results, 1):
            node = all_nodes[node_id]
            topic = "Cooking" if node_id <= 5 else "Programming"
            marker = "✓" if node_id <= 5 else "✗"

            print(f"{rank}. {marker} Node {node_id} (score: {score:.4f}) [{topic}]")
            print(f"   {node.title}: {node.content[:60]}...")

            if node_id <= 5:
                cooking_count += 1
            else:
                programming_count += 1

        print(f"\n--- Summary ---")
        print(f"Cooking nodes returned: {cooking_count}/10 ({cooking_count*10}%)")
        print(f"Programming nodes returned: {programming_count}/10 ({programming_count*10}%)")

        if cooking_count == 0:
            print("\n❌ FAILURE: Vector embeddings returned ZERO Cooking nodes for a Cooking query!")
            print("This proves the ONNX MiniLM embedding model has poor semantic separation.")
        elif cooking_count < 5:
            print(f"\n⚠️ WARNING: Only {cooking_count}/5 Cooking nodes in top 10")
            print("Embeddings have weak semantic quality.")
        else:
            print("\n✓ SUCCESS: Vector embeddings found Cooking nodes correctly")

        print("\n" + "="*80)

    finally:
        # Cleanup
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)
        os.environ['VOICETREE_TEST_MODE'] = 'true'


if __name__ == "__main__":
    test_vector_embeddings_isolated()
