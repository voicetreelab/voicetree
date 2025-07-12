import unittest
from datetime import datetime, timedelta
import time

from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import DecisionTree, Node


class TestDecisionTree(unittest.TestCase):
    def test_append_to_node(self):
        dt = DecisionTree()
        node_id = dt.create_new_node("test_node", None, "test_content", "test_summary")
        dt.tree[node_id].append_content("appended content", "appended_summary")
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


if __name__ == "__main__":
    unittest.main()