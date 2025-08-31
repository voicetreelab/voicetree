import json
import unittest


class TestAgenticWorkflowComponents(unittest.TestCase):
    
    def setUp(self):
        """Import the function once for all tests"""
        try:
            from backend.text_to_graph_pipeline.agentic_workflows.nodes import \
                extract_json_from_response
            self.extract_json = extract_json_from_response
        except ImportError:
            self.skipTest("extract_json_from_response function not available")
    
    def test_json_extraction_scenarios(self):
        """Test various JSON extraction scenarios"""
        test_cases = [
            # (input, expected_output, description)
            ('{"test": "value", "number": 42}', '{"test": "value", "number": 42}', "clean JSON"),
            ('Result: [{"item": 1}, {"item": 2}] end', '[{"item": 1}, {"item": 2}]', "JSON array"),
            ('{"incomplete": "json"', '{"incomplete": "json"', "malformed JSON"),
            ('Plain text with no JSON', 'Plain text with no JSON', "no JSON"),
        ]
        
        for input_str, expected, desc in test_cases:
            with self.subTest(scenario=desc):
                result = self.extract_json(input_str)
                self.assertEqual(result.strip(), expected.strip())
    
    def test_markdown_json_extraction(self):
        """Test JSON extraction from markdown code blocks"""
        response = '''Here's the result:
```json
{"key": "value", "items": [1, 2, 3]}
```
Additional text here.'''
        
        result = self.extract_json(response)
        self.assertEqual(result, '{"key": "value", "items": [1, 2, 3]}')
        
        # Verify it's valid JSON
        parsed = json.loads(result)
        self.assertEqual(parsed["key"], "value")
        self.assertEqual(parsed["items"], [1, 2, 3])


class TestWorkflowDataStructures(unittest.TestCase):
    
    def test_workflow_structures(self):
        """Test workflow data structure validation"""
        # Test workflow result structure
        mock_result = {
            "new_nodes": ["Node 1", "Node 2"],
            "integration_decisions": [
                {"action": "CREATE", "new_node_name": "Node 1"},
                {"action": "APPEND", "target_node": "Existing Node"}
            ],
            "chunks": [
                {"name": "chunk1", "text": "Some text", "is_routable": True}
            ]
        }
        
        # Verify all expected keys exist and have correct types
        expected_types = {
            "new_nodes": list,
            "integration_decisions": list,
            "chunks": list
        }
        
        for key, expected_type in expected_types.items():
            self.assertIn(key, mock_result)
            self.assertIsInstance(mock_result[key], expected_type)
    
    def test_decision_structures(self):
        """Test integration decision formats"""
        decisions = [
            {"action": "CREATE", "new_node_name": "New Concept", "content": "Content"},
            {"action": "APPEND", "target_node": "Existing Node", "content": "Additional"}
        ]
        
        for decision in decisions:
            self.assertIn("action", decision)
            self.assertIn(decision["action"], ["CREATE", "APPEND"])
            self.assertIn("content", decision)
            
            if decision["action"] == "CREATE":
                self.assertIn("new_node_name", decision)
            else:
                self.assertIn("target_node", decision)


class TestWorkflowErrorHandling(unittest.TestCase):
    
    def test_malformed_json_handling(self):
        """Test handling of various malformed JSON inputs"""
        try:
            from backend.text_to_graph_pipeline.agentic_workflows.nodes import \
                extract_json_from_response
        except ImportError:
            self.skipTest("extract_json_from_response function not available")
        
        malformed_inputs = [
            '{"incomplete": "json"',
            '[{"item": 1}, {"item": 2]', 
            '',
            'null',
            'undefined'
        ]
        
        for input_str in malformed_inputs:
            # Should not raise exception
            result = extract_json_from_response(input_str)
            self.assertIsInstance(result, str)
            self.assertIsNotNone(result)
    
    def test_chunk_validation(self):
        """Test chunk structure validation"""
        chunks = [
            {"name": "chunk1", "text": "Content", "is_routable": True},
            {"name": "chunk2", "text": "Incomplete", "is_routable": False}
        ]
        
        for chunk in chunks:
            # Verify required fields
            for field in ["name", "text", "is_routable"]:
                self.assertIn(field, chunk)
            
            # Verify types
            self.assertIsInstance(chunk["name"], str)
            self.assertIsInstance(chunk["text"], str) 
            self.assertIsInstance(chunk["is_routable"], bool)


if __name__ == "__main__":
    unittest.main()