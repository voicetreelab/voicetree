"""
Test helpers and fixtures for VoiceTree tests.
"""

from backend.markdown_tree_manager.markdown_tree_ds import MarkdownTree


class MockEmbeddingManager:
    """Mock embedding manager for tests"""

    def __init__(self):
        self.enabled = True
        self.vector_store = self
        self.search_results = []  # Can be set by tests
        self.added_nodes = {}  # Track what was added

    def search(self, query, top_k):
        """Return mock search results"""
        return self.search_results[:top_k]

    def update_embeddings(self, node_ids):
        """Track embedding updates"""
        pass

    def add_nodes(self, nodes):
        """Track added nodes"""
        self.added_nodes.update(nodes)


def create_test_tree(output_dir=None, with_mock_embeddings=True):
    """
    Create a MarkdownTree suitable for testing.

    Args:
        output_dir: Optional output directory
        with_mock_embeddings: If True, use mock embeddings; if False, disable embeddings

    Returns:
        MarkdownTree instance with mock or no embeddings
    """
    if with_mock_embeddings:
        mock_manager = MockEmbeddingManager()
        return MarkdownTree(output_dir=output_dir, embedding_manager=mock_manager)
    else:
        return MarkdownTree(output_dir=output_dir, embedding_manager=False)


def create_tree_with_custom_embeddings(embedding_manager):
    """
    Create a tree with a custom embedding manager.

    Args:
        embedding_manager: The embedding manager to inject

    Returns:
        MarkdownTree instance with the provided embedding manager
    """
    return MarkdownTree(embedding_manager=embedding_manager)
