import unittest
from datetime import datetime, timedelta
import time

from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import DecisionTree, Node


class TestDecisionTree(unittest.TestCase):
    def test_append_to_node(self):
        dt = DecisionTree()
        dt.create_new_node("test_node", 0, "test_content", "test_summary")
        dt.tree[1].append_content("appended content", "appended_summary")
        self.assertIn("appended content", dt.tree[1].content)

    def test_create_new_node(self):
        dt = DecisionTree()
        new_node_id = dt.create_new_node("test_node", 0, "test_content", "test_summary")
        self.assertEqual(new_node_id, 1)
        self.assertIn(1, dt.tree)
        self.assertEqual(dt.tree[1].parent_id, 0)

    def test_get_recent_nodes(self):
        dt = DecisionTree()
        dt.create_new_node("node1", 0, "content1", "summary1")
        time.sleep(0.01)
        dt.create_new_node("node2", 0, "content2", "summary2")
        recent_nodes = dt.get_recent_nodes(1)
        self.assertEqual(len(recent_nodes), 1)
        self.assertEqual(recent_nodes[0], 2)

    def test_get_parent_id(self):
        dt = DecisionTree()
        dt.create_new_node("node1", 0, "content1", "summary1")
        dt.create_new_node("node2", 1, "content2", "summary2")
        parent_id = dt.get_parent_id(2)
        self.assertEqual(parent_id, 1)


if __name__ == "__main__":
    unittest.main()