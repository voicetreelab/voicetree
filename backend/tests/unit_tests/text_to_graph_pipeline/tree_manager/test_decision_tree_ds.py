import unittest
from datetime import datetime, timedelta
import time
from typing import List, Dict

from backend.tree_manager.markdown_tree_ds import MarkdownTree, Node


class TestDecisionTree(unittest.TestCase):
    def test_append_to_node(self):
        dt = MarkdownTree()
        node_id = dt.create_new_node("test_node", None, "test_content", "test_summary")
        dt.append_node_content(node_id, "appended content")
        self.assertIn("appended content", dt.tree[node_id].content)

    def test_create_new_node(self):
        dt = MarkdownTree()
        new_node_id = dt.create_new_node("test_node", None, "test_content", "test_summary")
        self.assertEqual(new_node_id, 1)
        self.assertIn(1, dt.tree)
        self.assertEqual(dt.tree[1].parent_id, None)

    def test_get_recent_nodes(self):
        dt = MarkdownTree()
        
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
        dt = MarkdownTree()
        node1_id = dt.create_new_node("node1", None, "content1", "summary1")
        node2_id = dt.create_new_node("node2", node1_id, "content2", "summary2")
        parent_id = dt.get_parent_id(node2_id)
        self.assertEqual(parent_id, node1_id)

    def test_get_neighbors(self):
        """Test that get_neighbors returns immediate neighbors (parent, siblings, children) with summaries"""
        dt = MarkdownTree()
        
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
        
        # Test neighbors of B (should include parent A and children D and E)
        # Note: Sibling functionality is currently commented out in the implementation
        neighbors_b = dt.get_neighbors(b_id)
        neighbor_ids = {n["id"] for n in neighbors_b}
        
        # Should have parent and children (sibling functionality disabled)
        self.assertEqual(len(neighbors_b), 3)
        self.assertIn(a_id, neighbor_ids)  # parent
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
        
        # Test neighbors of leaf node D (only parent, no siblings since functionality disabled)
        neighbors_d = dt.get_neighbors(d_id)
        neighbor_ids_d = {n["id"] for n in neighbors_d}
        self.assertEqual(len(neighbors_d), 1)
        self.assertIn(b_id, neighbor_ids_d)  # parent

    def test_update_node(self):
        """Test that update_node replaces content and summary completely"""
        dt = MarkdownTree()
        
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
    unittest.main()