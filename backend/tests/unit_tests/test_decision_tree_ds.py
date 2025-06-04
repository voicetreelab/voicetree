import unittest
from datetime import datetime, timedelta
import time

from tree_manager.decision_tree_ds import DecisionTree, Node


class TestDecisionTree(unittest.TestCase):
    def test_append_to_node(self):
        tree = DecisionTree()
        tree.create_new_node(0, "**Node 1 content**")
        tree.tree[1].append_content( "New content.")
        self.assertEqual(tree.tree[1].content, "**Node 1 content**\nNew content.")
        self.assertGreater(tree.tree[1].modified_at, datetime.now() - timedelta(seconds=1))

    def test_create_new_node(self):
        tree = DecisionTree()
        tree.create_new_node(0, "New node content")
        self.assertIn(1, tree.tree)  # Check if node ID 1 exists in the nodes dictionary
        self.assertEqual(tree.tree[1].content, "New node content")
        self.assertGreater(tree.tree[1].created_at, datetime.now() - timedelta(seconds=1))

    def test_get_recent_nodes(self):
        tree = DecisionTree()
        tree.create_new_node(0, "**Node 1 content**")
        tree.create_new_node(0, "Node 2 content")
        time.sleep(0.01)
        tree.tree[0].append_content("Modified root content")
        tree.tree[1].append_content("Modified **Node 1 content**")

        recent_nodes = tree.get_recent_nodes(num_nodes=2)
        self.assertEqual(recent_nodes, [1, 0])

    def test_get_parent_id(self):
        tree = DecisionTree()
        tree.create_new_node(0, "Child Node")
        self.assertEqual(tree.get_parent_id(1), 0)  # Child node
        self.assertIsNone(tree.get_parent_id(0))  # Root node