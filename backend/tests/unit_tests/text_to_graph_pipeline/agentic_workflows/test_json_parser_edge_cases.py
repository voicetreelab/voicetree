from backend.text_to_graph_pipeline.agentic_workflows.core.json_parser import (
    parse_json_markdown,
)


class TestJsonParserEdgeCases:
    """Test cases for edge cases in JSON parsing that have caused production issues"""
    
    def test_parse_llm_response_with_special_quotes(self):
        """Test parsing LLM response that caused 'Expecting ',' delimiter' error"""
        # This is the actual LLM response that caused the error
        llm_response = '''```json
{
  "reasoning": "### STAGE 1: Synthesize\\nThe node describes the VoiceTree Algorithm, its function (converting text streams to live tree representations), its purpose (as core tech for Manu Mason's software), and its current status (running live). It also briefly touches on benefits (reducing cognitive load, memory aid) and potential applications.\\n\\n### STAGE 2: Analyze\\n- **Core Functionality**: The description of converting text streams into a live tree representation is the primary function of the VoiceTree Algorithm. This should remain with the main node.\\n- **Purpose/Context**: Serving as the central technology for Manu Mason's software is crucial context. This should also remain with the main node.\\n- **Benefits**: The explanation of *why* the tree representation is beneficial (efficiency, reduced cognitive load, memory aid) is a key aspect of understanding the algorithm's value. This is an attribute of the algorithm itself.\\n- **Applications**: The mention of \\"two breakthrough use cases\\" built on the platform suggests potential new nodes or areas for expansion, but the current text only introduces this as a topic to be discussed later, without detailing the use cases themselves. Therefore, this is a pointer to future content rather than a distinct, self-contained abstraction to be split out *now*.\\n\\n### STAGE 3: Refactor\\nAll identified concepts are directly descriptive or contextual to the VoiceTree Algorithm itself. The mention of future use cases is not detailed enough to warrant a new node. Therefore, the content can be absorbed into the main node while improving structure and readability.\\n\\n### STAGE 4: Edit & Validate\\nThe content is restructured to clearly separate the definition, purpose, benefits, and future outlook. Verbal fillers are removed, and the flow is improved. No information is lost, and the cognitive load is reduced by presenting the information in a more organized manner within the existing node.",
  "original_new_content": "The VoiceTree Algorithm is a core technology that converts text streams, such as live voice, into a live, tree-like representation, similar to a mind map.\\n\\nIt serves as the central technology behind Manu Mason's human-AI collaboration software and is currently running live.\\n\\n### Benefits:\\n- Provides a more efficient representation of content.\\n- Decreases cognitive load by offering a memory aid for high-level concepts and their relationships, preventing users from getting lost in details.\\n\\n### Applications:\\n- The VoiceTree platform enables numerous possibilities, with two breakthrough use cases to be discussed.",
  "original_new_summary": "The VoiceTree Algorithm converts text streams into a live, tree-like representation, serving as the core technology for Manu Mason's human-AI collaboration software. It reduces cognitive load and has potential applications.",
  "should_create_nodes": false,
  "new_nodes": [],
  "debug_notes": null
}
```'''
        
        # This should parse successfully but currently fails with:
        # json.decoder.JSONDecodeError: Expecting ',' delimiter: line 2 column 983 (char 984)
        result = parse_json_markdown(llm_response)
        
        # Verify the parsed result has expected structure
        assert "reasoning" in result
        assert "original_new_content" in result
        assert "original_new_summary" in result
        assert "should_create_nodes" in result
        assert "new_nodes" in result
        assert not result["should_create_nodes"]
        assert result["new_nodes"] == []
        assert result["debug_notes"] is None
        
    def test_parse_json_with_smart_quotes(self):
        """Test parsing JSON containing smart quotes (curly apostrophes)"""
        # Test with Unicode smart quotes that might come from LLMs
        json_with_smart_quotes = '''```json
{
  "text": "Manu Mason's software",
  "description": "The algorithm's value"
}
```'''
        
        result = parse_json_markdown(json_with_smart_quotes)
        assert result["text"] == "Manu Mason's software"
        assert result["description"] == "The algorithm's value"
        
    def test_parse_json_with_strict_mode(self):
        """Test that might fail with strict=True JSON parsing"""
        llm_response = '''```json
{
  "reasoning": "### STAGE 1: Synthesize\\nThe node describes the VoiceTree Algorithm, its function (converting text streams to live tree representations), its purpose (as core tech for Manu Mason's software), and its current status (running live). It also briefly touches on benefits (reducing cognitive load, memory aid) and potential applications.\\n\\n### STAGE 2: Analyze\\n- **Core Functionality**: The description of converting text streams into a live tree representation is the primary function of the VoiceTree Algorithm. This should remain with the main node.\\n- **Purpose/Context**: Serving as the central technology for Manu Mason's software is crucial context. This should also remain with the main node.\\n- **Benefits**: The explanation of *why* the tree representation is beneficial (efficiency, reduced cognitive load, memory aid) is a key aspect of understanding the algorithm's value. This is an attribute of the algorithm itself.\\n- **Applications**: The mention of \\"two breakthrough use cases\\" built on the platform suggests potential new nodes or areas for expansion, but the current text only introduces this as a topic to be discussed later, without detailing the use cases themselves. Therefore, this is a pointer to future content rather than a distinct, self-contained abstraction to be split out *now*.\\n\\n### STAGE 3: Refactor\\nAll identified concepts are directly descriptive or contextual to the VoiceTree Algorithm itself. The mention of future use cases is not detailed enough to warrant a new node. Therefore, the content can be absorbed into the main node while improving structure and readability.\\n\\n### STAGE 4: Edit & Validate\\nThe content is restructured to clearly separate the definition, purpose, benefits, and future outlook. Verbal fillers are removed, and the flow is improved. No information is lost, and the cognitive load is reduced by presenting the information in a more organized manner within the existing node.",
  "original_new_content": "The VoiceTree Algorithm is a core technology that converts text streams, such as live voice, into a live, tree-like representation, similar to a mind map.\\n\\nIt serves as the central technology behind Manu Mason's human-AI collaboration software and is currently running live.\\n\\n### Benefits:\\n- Provides a more efficient representation of content.\\n- Decreases cognitive load by offering a memory aid for high-level concepts and their relationships, preventing users from getting lost in details.\\n\\n### Applications:\\n- The VoiceTree platform enables numerous possibilities, with two breakthrough use cases to be discussed.",
  "original_new_summary": "The VoiceTree Algorithm converts text streams into a live, tree-like representation, serving as the core technology for Manu Mason's human-AI collaboration software. It reduces cognitive load and has potential applications.",
  "should_create_nodes": false,
  "new_nodes": [],
  "debug_notes": null
}
```'''
        
        # Test that parse_json_markdown now handles this correctly
        result = parse_json_markdown(llm_response)
        assert "reasoning" in result
        assert "original_new_content" in result
        assert "original_new_summary" in result
        assert "should_create_nodes" in result
        assert "new_nodes" in result
        assert not result["should_create_nodes"]
        assert result["new_nodes"] == []
        assert result["debug_notes"] is None
        
    def test_parse_json_with_escaped_quotes_in_nested_strings(self):
        """Test parsing JSON with escaped quotes inside already quoted strings"""
        complex_json = '''```json
{
  "content": "The mention of \\"two breakthrough use cases\\" built on the platform"
}
```'''
        
        result = parse_json_markdown(complex_json)
        assert result["content"] == 'The mention of "two breakthrough use cases" built on the platform'