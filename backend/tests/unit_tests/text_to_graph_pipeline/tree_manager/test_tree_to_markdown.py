import unittest
import os
from datetime import datetime

from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import Node, extract_title_from_md
from backend.text_to_graph_pipeline.tree_manager.tree_to_markdown import TreeToMarkdownConverter, generate_filename_from_keywords, slugify
from backend.text_to_graph_pipeline.tree_manager.utils import insert_yaml_frontmatter


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
            0: Node(node_id=0, name="root node", content="root_content", summary="Root summary"),
            1: Node(node_id=1, name="Child Node 1", parent_id=0, content="child1_content", summary="Child 1 summary"),
            2: Node(node_id=2, name="Child Node 2", parent_id=0, content="child2_content", summary="Child 2 summary"),
            3: Node(node_id=3, name="Grandchild Node", parent_id=2, content="grandchild_content", summary="Grandchild summary"),
        }
        self.tree_data[0].children = [1, 2]
        self.tree_data[2].children = [3]
        # Add relationships
        self.tree_data[1].relationships[0] = "child of"
        self.tree_data[2].relationships[0] = "related to"
        self.tree_data[3].relationships[2] = "example of"

        self.converter = TreeToMarkdownConverter(self.tree_data)
        self.converter.tree = self.tree_data
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

        self.converter.convert_nodes(output_dir=self.output_dir, nodes_to_update=nodes_to_update)

        # Check if the modified file was updated
        file_path = os.path.join(self.output_dir, self.tree_data[1].filename)
        self.assertTrue(os.path.exists(file_path))

        # Check content of the updated file
        with open(file_path, "r") as f:
            content = f.read()
            # Check YAML frontmatter
            self.assertIn("---\n", content)
            self.assertIn("title: Child Node 1 (1)\n", content)
            self.assertIn("node_id: 1\n", content)
            self.assertIn("Updated Child Node 1", content)
            parent_file = self.tree_data[0].filename
            self.assertIn(f"- child_of [[{parent_file}]]", content)  # Check for snake_case relationship

        # You'll need to manually check if Obsidian creates the
        # backlink in the parent node's file ("00.md").

    def test_slugify(self):
        self.assertEqual(slugify("This is a test"), "this_is_a_test")
        self.assertEqual(slugify(" another test "), "another_test")
        self.assertEqual(slugify("multiple---dashes"), "multiple_dashes")

    def test_get_parent_id(self):
        self.converter.tree = self.tree_data
        parent_id = self.converter.get_parent_id(1)
        self.assertEqual(parent_id, 0)

    def test_get_parent_id_child(self):
        # Test case for a child node
        self.converter.tree = self.tree_data
        parent_id = self.converter.get_parent_id(3)
        self.assertEqual(parent_id, 2)

    def test_get_parent_id_grandchild(self):
        # Test case for a grandchild node
        self.converter.tree = self.tree_data
        parent_id = self.converter.get_parent_id(3)
        self.assertEqual(parent_id, 2)

    def test_get_parent_id_root(self):
        # Test case for the root node
        self.converter.tree = self.tree_data
        parent_id = self.converter.get_parent_id(0)
        self.assertIsNone(parent_id)

    def test_get_parent_id_nonexistent(self):
        # Test case for a nonexistent node
        self.converter.tree = self.tree_data
        parent_id = self.converter.get_parent_id(99)
        self.assertIsNone(parent_id)

    def test_generate_filename_from_keywords(self):
        self.assertEqual(generate_filename_from_keywords("Test"), "Test.md")
        self.assertEqual(generate_filename_from_keywords("Another Test"), "Another_Test.md")
        # Test handling of newlines
        self.assertEqual(generate_filename_from_keywords("Voice Tree Project\n\nVoice Tree Project"), "Voice_Tree_Project_Voice_Tree_Project.md")
        self.assertEqual(generate_filename_from_keywords("Line1\nLine2"), "Line1_Line2.md")
        self.assertEqual(generate_filename_from_keywords("Line1\r\nLine2"), "Line1_Line2.md")
        
        # Test special characters that should be replaced
        self.assertEqual(generate_filename_from_keywords("File/Path"), "File_Path.md")
        self.assertEqual(generate_filename_from_keywords("File\\Path"), "File_Path.md")
        self.assertEqual(generate_filename_from_keywords("File:Name"), "File_Name.md")
        self.assertEqual(generate_filename_from_keywords("File*Name"), "File_Name.md")
        self.assertEqual(generate_filename_from_keywords("File?Name"), "File_Name.md")
        self.assertEqual(generate_filename_from_keywords("File<Name>"), "File_Name.md")
        self.assertEqual(generate_filename_from_keywords("File|Name"), "File_Name.md")
        self.assertEqual(generate_filename_from_keywords('File"Name"'), "File_Name.md")
        
        # Test allowed characters (should remain)
        self.assertEqual(generate_filename_from_keywords("File-Name"), "File-Name.md")
        self.assertEqual(generate_filename_from_keywords("File_Name"), "File_Name.md")
        self.assertEqual(generate_filename_from_keywords("File123"), "File123.md")
        self.assertEqual(generate_filename_from_keywords("ABC-123_test"), "ABC-123_test.md")
        
        # Test multiple consecutive special characters
        self.assertEqual(generate_filename_from_keywords("File***Name"), "File_Name.md")
        self.assertEqual(generate_filename_from_keywords("File   Name"), "File_Name.md")
        self.assertEqual(generate_filename_from_keywords("File///Name"), "File_Name.md")
        
        # Test edge cases
        self.assertEqual(generate_filename_from_keywords("!!!"), "untitled.md")
        self.assertEqual(generate_filename_from_keywords("   "), "untitled.md")
        self.assertEqual(generate_filename_from_keywords(""), "untitled.md")
        self.assertEqual(generate_filename_from_keywords("___test___"), "test.md")
        self.assertEqual(generate_filename_from_keywords("Research Gemini/OpenAI Voice-to-Text Streaming Capabilities"), "Research_Gemini_OpenAI_Voice-to-Text_Streaming_Capabilities.md")


    def test_convert_to_snake_case(self):
        self.assertEqual(TreeToMarkdownConverter.convert_to_snake_case("child of"), "child_of")
        self.assertEqual(TreeToMarkdownConverter.convert_to_snake_case("related to"), "related_to")
        self.assertEqual(TreeToMarkdownConverter.convert_to_snake_case("example of"), "example_of")
        self.assertEqual(TreeToMarkdownConverter.convert_to_snake_case("already_snake_case"), "already_snake_case")

    def test_yaml_frontmatter(self):
        # Test that YAML frontmatter is written correctly
        nodes_to_update = {0}
        self.converter.convert_nodes(output_dir=self.output_dir, nodes_to_update=nodes_to_update)
        
        file_path = os.path.join(self.output_dir, self.tree_data[0].filename)
        with open(file_path, "r") as f:
            content = f.read()
            # Check YAML frontmatter format
            self.assertTrue(content.startswith("---\n"))
            self.assertIn("title: root node (0)\n", content)
            self.assertIn("node_id: 0\n", content)
            # Note: created_at and modified_at are not included in current YAML frontmatter format
            # Check that frontmatter ends properly
            frontmatter_end = content.find("---\n", 4)
            self.assertGreater(frontmatter_end, 4)

    def test_relationships_snake_case(self):
        # Test that relationships are converted to snake_case
        nodes_to_update = {1, 2, 3}
        self.converter.convert_nodes(output_dir=self.output_dir, nodes_to_update=nodes_to_update)
        
        # Check child node 2 with "related to" relationship
        file_path = os.path.join(self.output_dir, self.tree_data[2].filename)
        with open(file_path, "r") as f:
            content = f.read()
            self.assertIn("- related_to [[", content)  # Check snake_case conversion
            
        # Check grandchild with "example of" relationship
        file_path = os.path.join(self.output_dir, self.tree_data[3].filename)
        with open(file_path, "r") as f:
            content = f.read()
            self.assertIn("- example_of [[", content)  # Check snake_case conversion


    def test_insert_yaml_frontmatter(self):
        import yaml
        
        # Test simple key-value pairs - parse and verify content instead of exact string match
        result = insert_yaml_frontmatter({"title": "Test Title", "author": "Test Author"})
        self.assertTrue(result.startswith("---\n"))
        self.assertTrue(result.endswith("---\n"))
        
        # Parse the YAML content to verify it's correct
        yaml_content = result.strip().split('\n')[1:-1]
        yaml_str = '\n'.join(yaml_content)
        parsed = yaml.safe_load(yaml_str)
        self.assertEqual(parsed["title"], "Test Title")
        self.assertEqual(parsed["author"], "Test Author")
        
        # Test with list values
        result = insert_yaml_frontmatter({"tags": ["tag1", "tag2", "tag3"]})
        yaml_content = result.strip().split('\n')[1:-1]
        yaml_str = '\n'.join(yaml_content)
        parsed = yaml.safe_load(yaml_str)
        self.assertEqual(parsed["tags"], ["tag1", "tag2", "tag3"])
        
        # Test with nested dict
        result = insert_yaml_frontmatter({"metadata": {"version": "1.0", "type": "node"}})
        yaml_content = result.strip().split('\n')[1:-1]
        yaml_str = '\n'.join(yaml_content)
        parsed = yaml.safe_load(yaml_str)
        self.assertEqual(parsed["metadata"]["version"], "1.0")
        self.assertEqual(parsed["metadata"]["type"], "node")
        
        # Test with boolean and None values
        result = insert_yaml_frontmatter({"published": True, "draft": False, "notes": None})
        yaml_content = result.strip().split('\n')[1:-1]
        yaml_str = '\n'.join(yaml_content)
        parsed = yaml.safe_load(yaml_str)
        self.assertEqual(parsed["published"], True)
        self.assertEqual(parsed["draft"], False)
        self.assertIsNone(parsed["notes"])
        
        # Test special characters that would break YAML
        result = insert_yaml_frontmatter({"title": "How to: Setup Docker"})
        yaml_content = result.strip().split('\n')[1:-1]
        yaml_str = '\n'.join(yaml_content)
        parsed = yaml.safe_load(yaml_str)
        self.assertEqual(parsed["title"], "How to: Setup Docker")
        
        # Test multiline strings
        result = insert_yaml_frontmatter({"content": "Line 1\nLine 2\nLine 3"})
        yaml_content = result.strip().split('\n')[1:-1]
        yaml_str = '\n'.join(yaml_content)
        parsed = yaml.safe_load(yaml_str)
        self.assertEqual(parsed["content"], "Line 1\nLine 2\nLine 3")
        
        # Test empty dict
        result = insert_yaml_frontmatter({})
        self.assertEqual(result, "")

    def test_multiple_tags_in_markdown(self):
        """Test that multiple tags are written as hashtags on first line"""
        # Test node with multiple tags
        multi_tagged_node = Node(node_id=97, name="Multi Tagged Node", content="test content", summary="Test summary")
        multi_tagged_node.tags = ["newborn_children", "adult_owl", "south_zoo", "average"]
        
        # Test node with single tag
        single_tagged_node = Node(node_id=96, name="Single Tagged Node", content="test content", summary="Test summary") 
        single_tagged_node.tags = ["domestic_pets"]
        
        # Test node with empty tags
        empty_tagged_node = Node(node_id=95, name="Empty Tagged Node", content="test content", summary="Test summary")
        empty_tagged_node.tags = []
        
        # Test node with special characters in tags
        special_tagged_node = Node(node_id=94, name="Special Tagged Node", content="test content", summary="Test summary")
        special_tagged_node.tags = ["animal-behavior", "zoo_animals", "math123"]
        
        tree_data = {97: multi_tagged_node, 96: single_tagged_node, 95: empty_tagged_node, 94: special_tagged_node}
        converter = TreeToMarkdownConverter(tree_data)
        
        # Convert all nodes
        converter.convert_nodes(output_dir=self.output_dir, nodes_to_update={97, 96, 95, 94})
        
        # Test multi-tagged node has hashtags as first line
        multi_file_path = os.path.join(self.output_dir, multi_tagged_node.filename)
        with open(multi_file_path, "r") as f:
            content = f.read()
            lines = content.split('\n')
            self.assertEqual(lines[0], "#newborn_children #adult_owl #south_zoo #average")
            self.assertEqual(lines[1], "---")
            self.assertIn("title: Multi Tagged Node", content)
        
        # Test single-tagged node
        single_file_path = os.path.join(self.output_dir, single_tagged_node.filename)
        with open(single_file_path, "r") as f:
            content = f.read()
            lines = content.split('\n')
            self.assertEqual(lines[0], "#domestic_pets")
            self.assertEqual(lines[1], "---")
            self.assertIn("title: Single Tagged Node", content)
        
        # Test empty tags behaves like no tags
        empty_file_path = os.path.join(self.output_dir, empty_tagged_node.filename)
        with open(empty_file_path, "r") as f:
            content = f.read()
            lines = content.split('\n')
            self.assertEqual(lines[0], "---")  # Should start with YAML frontmatter, no hashtags
            self.assertIn("title: Empty Tagged Node", content)
            
        # Test special characters in tags
        special_file_path = os.path.join(self.output_dir, special_tagged_node.filename)
        with open(special_file_path, "r") as f:
            content = f.read()
            lines = content.split('\n')
            self.assertEqual(lines[0], "#animal-behavior #zoo_animals #math123")
            self.assertEqual(lines[1], "---")
            self.assertIn("title: Special Tagged Node", content)


if __name__ == '__main__':
    unittest.main()
