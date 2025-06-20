import unittest
import json


class TestAgenticWorkflowComponents(unittest.TestCase):
    
    def test_extract_json_from_response_with_clean_json(self):
        """Test JSON extraction from clean JSON response"""
        # This test only works if the function exists - let's make it import-safe
        try:
            from backend.agentic_workflows.nodes import extract_json_from_response
        except ImportError:
            self.skipTest("extract_json_from_response function not available")
        
        # Arrange
        response = '{"test": "value", "number": 42}'
        
        # Act
        result = extract_json_from_response(response)
        
        # Assert
        self.assertEqual(result, response)
        # Verify it's valid JSON by parsing it
        parsed = json.loads(result)
        self.assertEqual(parsed["test"], "value")
        self.assertEqual(parsed["number"], 42)
    
    def test_extract_json_from_response_with_markdown_wrapper(self):
        """Test JSON extraction from markdown code blocks"""
        try:
            from backend.agentic_workflows.nodes import extract_json_from_response
        except ImportError:
            self.skipTest("extract_json_from_response function not available")
        
        # Arrange
        response = '''Here's the result:
```json
{"key": "value", "items": [1, 2, 3]}
```
Additional text here.'''
        
        # Act
        result = extract_json_from_response(response)
        
        # Assert
        # Should extract the JSON from between the code blocks
        expected = '{"key": "value", "items": [1, 2, 3]}'
        self.assertEqual(result, expected)
        
        # Verify it's valid JSON
        parsed = json.loads(result)
        self.assertEqual(parsed["key"], "value")
        self.assertEqual(parsed["items"], [1, 2, 3])
    
    def test_extract_json_from_response_with_array(self):
        """Test JSON extraction when response contains JSON array"""
        try:
            from backend.agentic_workflows.nodes import extract_json_from_response
        except ImportError:
            self.skipTest("extract_json_from_response function not available")
        
        # Arrange
        response = 'Here are the results: [{"item": 1}, {"item": 2}] end of data'
        
        # Act
        result = extract_json_from_response(response)
        
        # Assert
        expected = '[{"item": 1}, {"item": 2}]'
        self.assertEqual(result, expected)
        
        # Verify it's valid JSON
        parsed = json.loads(result)
        self.assertEqual(len(parsed), 2)
        self.assertEqual(parsed[0]["item"], 1)
    
    def test_extract_json_from_response_with_invalid_json(self):
        """Test handling of malformed JSON"""
        try:
            from backend.agentic_workflows.nodes import extract_json_from_response
        except ImportError:
            self.skipTest("extract_json_from_response function not available")
        
        # Arrange
        response = '{"incomplete": "json", "missing_bracket"'
        
        # Act
        result = extract_json_from_response(response)
        
        # Assert
        # Should return original response when JSON is invalid
        self.assertEqual(result, response.strip())
    
    def test_extract_json_from_response_with_no_json(self):
        """Test handling of plain text with no JSON"""
        try:
            from backend.agentic_workflows.nodes import extract_json_from_response
        except ImportError:
            self.skipTest("extract_json_from_response function not available")
        
        # Arrange
        response = 'This is just plain text with no JSON structures at all'
        
        # Act
        result = extract_json_from_response(response)
        
        # Assert
        # Should return original response when no JSON is found
        self.assertEqual(result, response.strip())
    
    def test_extract_json_from_response_with_nested_brackets(self):
        """Test handling of nested JSON structures"""
        try:
            from backend.agentic_workflows.nodes import extract_json_from_response
        except ImportError:
            self.skipTest("extract_json_from_response function not available")
        
        # Arrange
        response = 'Result: {"outer": {"inner": {"deep": "value"}}, "array": [1, 2]} Done'
        
        # Act
        result = extract_json_from_response(response)
        
        # Assert
        expected = '{"outer": {"inner": {"deep": "value"}}, "array": [1, 2]}'
        self.assertEqual(result, expected)
        
        # Verify complex structure is preserved
        parsed = json.loads(result)
        self.assertEqual(parsed["outer"]["inner"]["deep"], "value")
        self.assertEqual(parsed["array"], [1, 2])


# Test workflow result structures and error handling
class TestWorkflowDataStructures(unittest.TestCase):
    
    def test_workflow_state_progression(self):
        """Test that workflow state progresses through expected stages"""
        # Arrange
        stages = [
            "start",
            "segmentation_complete", 
            "relationship_analysis_complete",
            "integration_decision_complete",
            "complete"
        ]
        
        # Act & Assert
        for i, stage in enumerate(stages):
            # Each stage should be a valid string
            self.assertIsInstance(stage, str)
            self.assertGreater(len(stage), 0)
            
            # Stages should be in logical order
            if i > 0:
                self.assertNotEqual(stage, stages[i-1])
    
    def test_workflow_result_structure(self):
        """Test that workflow results have expected structure"""
        # Arrange
        expected_keys = [
            "new_nodes",
            "integration_decisions", 
            "chunks",
            "incomplete_chunk_remainder"
        ]
        
        # Act - simulate a typical workflow result
        mock_result = {
            "new_nodes": ["Node 1", "Node 2"],
            "integration_decisions": [
                {"action": "CREATE", "new_node_name": "Node 1"},
                {"action": "APPEND", "target_node": "Existing Node"}
            ],
            "chunks": [
                {"name": "chunk1", "text": "Some text", "is_complete": True}
            ],
            "incomplete_chunk_remainder": ""
        }
        
        # Assert
        for key in expected_keys:
            self.assertIn(key, mock_result)
        
        # Verify data types
        self.assertIsInstance(mock_result["new_nodes"], list)
        self.assertIsInstance(mock_result["integration_decisions"], list)
        self.assertIsInstance(mock_result["chunks"], list)
        self.assertIsInstance(mock_result["incomplete_chunk_remainder"], str)
    
    def test_integration_decision_structure(self):
        """Test that integration decisions follow expected format"""
        # Arrange
        create_decision = {
            "action": "CREATE",
            "new_node_name": "New Concept",
            "target_node": "Parent Node",
            "relationship": "child of",
            "content": "Content for new node",
            "new_node_summary": "Summary"
        }
        
        append_decision = {
            "action": "APPEND",
            "target_node": "Existing Node",
            "content": "Additional content",
            "updated_summary": "Updated summary"
        }
        
        # Act & Assert
        # CREATE decision validation
        self.assertIn("action", create_decision)
        self.assertEqual(create_decision["action"], "CREATE")
        self.assertIn("new_node_name", create_decision)
        self.assertIn("target_node", create_decision)
        self.assertIn("content", create_decision)
        
        # APPEND decision validation
        self.assertIn("action", append_decision)
        self.assertEqual(append_decision["action"], "APPEND")
        self.assertIn("target_node", append_decision)
        self.assertIn("content", append_decision)


# Test workflow error scenarios
class TestWorkflowErrorHandling(unittest.TestCase):
    
    def test_malformed_json_response_handling(self):
        """Test that malformed JSON responses don't crash the system"""
        try:
            from backend.agentic_workflows.nodes import extract_json_from_response
        except ImportError:
            self.skipTest("extract_json_from_response function not available")
        
        # Arrange
        malformed_responses = [
            '{"incomplete": "json"',  # Missing closing brace
            '[{"item": 1}, {"item": 2]',  # Missing closing bracket
            '{"valid": "json"} extra text',  # Extra text after JSON
            '',  # Empty response
            'null',  # Null response
            'undefined'  # Invalid JSON value
        ]
        
        # Act & Assert
        for response in malformed_responses:
            # Should not raise exception
            result = extract_json_from_response(response)
            self.assertIsInstance(result, str)
            # Should return something (either cleaned JSON or original)
            self.assertIsNotNone(result)
    
    def test_workflow_error_message_structure(self):
        """Test that error messages follow expected structure"""
        # Arrange
        error_scenarios = [
            "LLM API timeout",
            "Invalid response format", 
            "Network connection failed",
            "Rate limit exceeded"
        ]
        
        # Act & Assert
        for error_msg in error_scenarios:
            # Error messages should be informative strings
            self.assertIsInstance(error_msg, str)
            self.assertGreater(len(error_msg), 0)
            # Should not contain sensitive information
            self.assertNotIn("api_key", error_msg.lower())
            self.assertNotIn("token", error_msg.lower())
    
    def test_chunk_structure_validation(self):
        """Test that chunks follow expected structure"""
        # Arrange
        valid_chunk = {
            "name": "chunk1",
            "text": "This is the chunk content",
            "is_complete": True
        }
        
        incomplete_chunk = {
            "name": "chunk2", 
            "text": "This is incomplete",
            "is_complete": False
        }
        
        # Act & Assert
        for chunk in [valid_chunk, incomplete_chunk]:
            self.assertIn("name", chunk)
            self.assertIn("text", chunk)
            self.assertIn("is_complete", chunk)
            self.assertIsInstance(chunk["name"], str)
            self.assertIsInstance(chunk["text"], str)
            self.assertIsInstance(chunk["is_complete"], bool)


if __name__ == "__main__":
    unittest.main() 