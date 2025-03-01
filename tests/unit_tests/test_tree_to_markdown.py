import unittest
import os
from datetime import datetime

from tree_manager.decision_tree_ds import Node, extract_title_from_md
from tree_manager.tree_to_markdown import TreeToMarkdownConverter, generate_filename_from_keywords, slugify


# import nltk
# import ssl
#
# try:
#     _create_unverified_https_context = ssl._create_unverified_context
# except AttributeError:
#     pass
# else:
#     ssl._create_default_https_context = _create_unverified_https_context
#
# nltk.download()

class TestTreeToMarkdownConverter(unittest.TestCase):
    def setUp(self):
        self.tree_data = {
            0: Node(0, "root node"),
            1: Node(1, "Child Node 1", parent_id=0),
            2: Node(2, "Child Node 2", parent_id=0),
            3: Node(3, "Grandchild Node", parent_id=2),
        }
        self.tree_data[0].children = [1, 2]
        self.tree_data[2].children = [3]

        self.converter = TreeToMarkdownConverter(self.tree_data)  # Pass the DecisionTree instance
        self.output_dir = "test_markdown"
        os.mkdir(self.output_dir)

    def tearDown(self):
        #        Clean up the temporary output directory
        for filename in os.listdir(self.output_dir):
            file_path = os.path.join(self.output_dir, filename)
            try:
                if os.path.isfile(file_path):
                    os.unlink(file_path)
            except Exception as e:
                print(f'Failed to delete {file_path}. Reason: {e}')
        os.rmdir(self.output_dir)

    # def test_convertTree(self):
    #     self.converter.convert_tree(output_dir=self.output_dir)
    #
    #     # Check if files were created
    #     self.assertTrue(os.path.exists(os.path.join(self.output_dir, "00_root_node.md")))
    #     self.assertTrue(os.path.exists(os.path.join(self.output_dir, "01_child_node_1.md")))
    #     self.assertTrue(os.path.exists(os.path.join(self.output_dir, "02_child_node_2.md")))
    #     self.assertTrue(os.path.exists(os.path.join(self.output_dir, "03_grandchild_node.md")))
    #
    #     # Check content of one file (you can add more checks as needed)
    #     with open(os.path.join(self.output_dir, "00_root_node.md"), "r") as f:
    #         content = f.read()
    #         self.assertIn("# Root Node", content)
    #         self.assertIn("- child of [[01_child_node_1.md]]", content)
    #         self.assertIn("- child of [[02_child_node_2.md]]", content)

    def test_convertNode(self):
        # Modify an existing node
        self.tree_data[1].content = "Updated Child Node 1"
        self.tree_data[1].modified_at = datetime.now()
        nodes_to_update = {1}  # Set of nodes to update

        self.converter.convert_node(output_dir=self.output_dir, nodes_to_update=nodes_to_update)

        # Check if the modified file was updated
        file_path = os.path.join(self.output_dir, self.tree_data[1].filename)
        self.assertTrue(os.path.exists(file_path))

        # Check content of the updated file
        with open(file_path, "r") as f:
            content = f.read()
            self.assertIn("Updated Child Node 1", content)
            parent_file = self.tree_data[0].filename
            self.assertIn(f"- child of [[{parent_file}]]", content)  # Check for correct parent link

        # You'll need to manually check if Obsidian creates the
        # backlink in the parent node's file ("00.md").

    def test_slugify(self):
        self.assertEqual(slugify("Test Node"), "test_node")
        self.assertEqual(slugify("Node with Spaces"), "node_with_spaces")
        self.assertEqual(slugify("Special Characters!@#$%^&*()"), "special_characters")

    def test_get_parent_id_root(self):
        parent_id = self.converter.get_parent_id(0)  # Root node
        self.assertIsNone(parent_id)

    def test_get_parent_id_child(self):
        parent_id = self.converter.get_parent_id(1)  # Child node
        self.assertEqual(parent_id, 0)

    def test_get_parent_id_grandchild(self):
        parent_id = self.converter.get_parent_id(3)  # Grandchild node
        self.assertEqual(parent_id, 2)

    def test_get_parent_id_nonexistent(self):
        parent_id = self.converter.get_parent_id(4)  # Non-existent node
        self.assertIsNone(parent_id)

    def test_get_parent_id(self):
        # Test finding parent of a child node
        parent_id = self.converter.get_parent_id(1)
        self.assertEqual(parent_id, 0)

        # Test finding parent of the root node (should return None)
        parent_id = self.converter.get_parent_id(0)
        self.assertIsNone(parent_id)

        # Test with a non-existent node
        parent_id = self.converter.get_parent_id(99)
        self.assertIsNone(parent_id)

    def test_generate_filename_from_keywords(self):
        # Test with content that has clear keywords
        content1 = ("##This is a test about Python programming and web development.\n"
                    "goosagla asdflk nasdlf sdfkasdfl"
                    "sadlfkjalsdjf asldfj lksa")

        title = extract_title_from_md(content1)
        filename1 = generate_filename_from_keywords(title)

        # Check format and keyword presence
        self.assertTrue(filename1.endswith(".md"))
        self.assertIn("python", filename1.lower())
        self.assertIn("programming", filename1.lower())

        # # Test with content that has fewer clear keywords
        # content2 = "Meeting with John about project X."
        # filename2 = self.converter.generate_filename_from_keywords(content2)
        #
        # # Check format and keyword presence
        # self.assertTrue(filename2.endswith(".md"))
        # self.assertIn("meeting", filename2.lower())
        # self.assertIn("john", filename2.lower())


if __name__ == '__main__':
    unittest.main()
