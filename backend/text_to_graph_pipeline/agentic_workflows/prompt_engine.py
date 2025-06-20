"""
Simple Template Engine for VoiceTree Prompts

This module provides a safer alternative to str.format() that doesn't require
brace escaping in JSON examples, preventing the recurring KeyError issues.
"""

import re
from typing import Dict, Any
from pathlib import Path


class PromptTemplate:
    """
    A simple template engine that uses {{variable}} syntax for substitution
    while leaving single braces alone for JSON examples.
    """
    
    def __init__(self, template_content: str):
        self.template = template_content
        
    def render(self, **kwargs: Any) -> str:
        """
        Render the template with the provided variables.
        
        Uses {{variable}} syntax for substitution, leaving single braces
        for JSON examples untouched.
        """
        result = self.template
        
        # Find all {{variable}} patterns and replace them
        pattern = r'\{\{(\w+)\}\}'
        
        def replace_var(match):
            var_name = match.group(1)
            if var_name in kwargs:
                return str(kwargs[var_name])
            else:
                raise KeyError(f"Template variable '{var_name}' not provided")
        
        result = re.sub(pattern, replace_var, result)
        return result
    
    @classmethod
    def from_file(cls, file_path: str) -> 'PromptTemplate':
        """Load template from file."""
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        return cls(content)


class PromptLoader:
    """
    Loads and manages prompt templates for the VoiceTree system.
    """
    
    def __init__(self, prompts_dir: str = None):
        if prompts_dir is None:
            # Default to the prompts directory relative to this file
            self.prompts_dir = Path(__file__).parent / "prompts"
        else:
            self.prompts_dir = Path(prompts_dir)
        
        self._templates = {}
    
    def load_template(self, template_name: str) -> PromptTemplate:
        """
        Load a template by name (without .txt extension).
        
        Args:
            template_name: Name of the template file (e.g., 'segmentation')
            
        Returns:
            PromptTemplate instance
        """
        if template_name not in self._templates:
            file_path = self.prompts_dir / f"{template_name}.txt"
            if not file_path.exists():
                raise FileNotFoundError(f"Template file not found: {file_path}")
            
            self._templates[template_name] = PromptTemplate.from_file(str(file_path))
        
        return self._templates[template_name]
    
    def render_template(self, template_name: str, **kwargs: Any) -> str:
        """
        Load and render a template in one step.
        
        Args:
            template_name: Name of the template file
            **kwargs: Variables to substitute in the template
            
        Returns:
            Rendered prompt string
        """
        template = self.load_template(template_name)
        return template.render(**kwargs)


# Migration helper functions for backward compatibility
def migrate_template_to_new_format(old_template: str) -> str:
    """
    Convert old str.format() style templates to new {{variable}} format.
    
    This function helps migrate existing templates from {variable} to {{variable}}
    syntax while preserving JSON examples.
    """
    # This is a simple heuristic - in practice, manual review is recommended
    
    # Find all {variable} patterns that are likely template variables
    # (not part of JSON structures)
    
    # Pattern for likely template variables (word characters only, not in quotes)
    template_var_pattern = r'(?<!")(\{(\w+)\})(?!")'
    
    def replace_template_var(match):
        full_match = match.group(1)  # {variable}
        var_name = match.group(2)    # variable
        return f"{{{{{var_name}}}}}"  # {{variable}}
    
    result = re.sub(template_var_pattern, replace_template_var, old_template)
    return result


# Example usage and testing
if __name__ == "__main__":
    # Test the template engine
    test_template = """
You are a helpful assistant.

Input data: {{input_data}}

Expected output format:
```json
{
  "result": "example",
  "data": {"key": "value"}
}
```

Process this: {{user_input}}
"""
    
    template = PromptTemplate(test_template)
    
    try:
        rendered = template.render(
            input_data="test data",
            user_input="hello world"
        )
        print("✅ Template rendering successful!")
        print("Rendered template:")
        print(rendered)
    except Exception as e:
        print(f"❌ Template rendering failed: {e}") 