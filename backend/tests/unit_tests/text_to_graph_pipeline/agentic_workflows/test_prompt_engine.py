"""
Unit tests for the prompt engine
"""

import sys
import tempfile
from pathlib import Path

import pytest

from backend.text_to_graph_pipeline.agentic_workflows.core.prompt_engine import (
    PromptLoader,
)
from backend.text_to_graph_pipeline.agentic_workflows.core.prompt_engine import (
    PromptTemplate,
)
from backend.text_to_graph_pipeline.agentic_workflows.core.prompt_engine import (
    migrate_template_to_new_format,
)

# Add backend to path for imports
backend_path = Path(__file__).parent.parent.parent.parent
sys.path.insert(0, str(backend_path))


class TestPromptTemplate:
    """Test the PromptTemplate class"""
    
    def test_simple_variable_substitution(self):
        """Test basic variable substitution"""
        template = PromptTemplate("Hello {{name}}, welcome to {{place}}!")
        
        result = template.render(name="Alice", place="VoiceTree")
        
        assert result == "Hello Alice, welcome to VoiceTree!"
    
    def test_json_examples_preserved(self):
        """Test that JSON examples with single braces are preserved"""
        template_content = """
        Input: {{user_input}}
        
        Expected format:
        {
          "result": "example",
          "data": {"key": "value"}
        }
        """
        
        template = PromptTemplate(template_content)
        result = template.render(user_input="test data")
        
        # JSON should be preserved exactly
        assert '{"key": "value"}' in result
        assert '"result": "example"' in result
        # Variable should be substituted
        assert "test data" in result
        assert "{{user_input}}" not in result
    
    def test_missing_variable_error(self):
        """Test that missing variables raise appropriate errors"""
        template = PromptTemplate("Hello {{name}}!")
        
        with pytest.raises(KeyError, match="Template variable 'name' not provided"):
            template.render()
    
    def test_multiple_same_variable(self):
        """Test that the same variable can be used multiple times"""
        template = PromptTemplate("{{name}} said: '{{message}}'. {{name}} was happy.")
        
        result = template.render(name="Bob", message="Hello world")
        
        assert result == "Bob said: 'Hello world'. Bob was happy."
    
    def test_from_file(self):
        """Test loading template from file"""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            f.write("Template content: {{variable}}")
            temp_path = f.name
        
        try:
            template = PromptTemplate.from_file(temp_path)
            result = template.render(variable="test")
            
            assert result == "Template content: test"
        finally:
            Path(temp_path).unlink()


class TestPromptLoader:
    """Test the PromptLoader class"""
    
    def test_load_template_from_directory(self):
        """Test loading templates from a directory"""
        with tempfile.TemporaryDirectory() as temp_dir:
            # Create a test template file
            template_path = Path(temp_dir) / "test_template.md"
            template_path.write_text("Hello {{name}}!")
            
            loader = PromptLoader(temp_dir)
            template = loader.load_template("test_template")
            
            result = template.render(name="World")
            assert result == "Hello World!"
    
    def test_render_template_direct(self):
        """Test the render_template convenience method"""
        with tempfile.TemporaryDirectory() as temp_dir:
            # Create a test template file
            template_path = Path(temp_dir) / "greeting.md"
            template_path.write_text("{{greeting}} {{name}}!")
            
            loader = PromptLoader(temp_dir)
            result = loader.render_template("greeting", greeting="Hi", name="Alice")
            
            assert result == "Hi Alice!"
    
    def test_template_caching(self):
        """Test that templates are cached after first load"""
        with tempfile.TemporaryDirectory() as temp_dir:
            template_path = Path(temp_dir) / "cached.md"
            template_path.write_text("Original: {{value}}")
            
            loader = PromptLoader(temp_dir)
            
            # Load template first time
            result1 = loader.render_template("cached", value="first")
            
            # Modify file on disk
            template_path.write_text("Modified: {{value}}")
            
            # Load template second time - should use cached version
            result2 = loader.render_template("cached", value="second")
            
            assert result1 == "Original: first"
            assert result2 == "Original: second"  # Still uses cached version
    
    def test_missing_template_file(self):
        """Test error handling for missing template files"""
        with tempfile.TemporaryDirectory() as temp_dir:
            loader = PromptLoader(temp_dir)
            
            with pytest.raises(FileNotFoundError, match="Template file not found"):
                loader.load_template("nonexistent")


class TestMigrationHelper:
    """Test the migration helper function"""
    
    def test_migrate_simple_variables(self):
        """Test migrating simple template variables"""
        old_template = "Hello {name}, welcome to {place}!"
        
        new_template = migrate_template_to_new_format(old_template)
        
        assert new_template == "Hello {{name}}, welcome to {{place}}!"
    
    def test_preserve_json_examples(self):
        """Test that JSON examples are preserved during migration"""
        old_template = '''
        Input: {user_input}
        
        Format:
        {
          "result": "{value}",
          "data": {"key": "value"}
        }
        '''
        
        new_template = migrate_template_to_new_format(old_template)
        
        # Template variable should be migrated
        assert "{{user_input}}" in new_template
        # JSON should be preserved (this is a heuristic, may need refinement)
        assert '{"key": "value"}' in new_template
    
    def test_complex_migration_scenario(self):
        """Test migration with mixed content"""
        old_template = '''
        Process: {transcript_text}
        
        Example output:
        {
          "chunks": [
            {"name": "Task 1", "text": "Do something"}
          ]
        }
        
        Context: {existing_nodes}
        '''
        
        new_template = migrate_template_to_new_format(old_template)
        
        # Variables should be migrated
        assert "{{transcript_text}}" in new_template
        assert "{{existing_nodes}}" in new_template
        # JSON structure should be preserved
        assert '"chunks"' in new_template
        assert '"name": "Task 1"' in new_template 