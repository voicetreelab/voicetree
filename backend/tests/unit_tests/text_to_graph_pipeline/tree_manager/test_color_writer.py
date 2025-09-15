"""
Unit tests for ColorWriter component
Tests the theme-to-color mapping and markdown file updating functionality.
"""

import pytest
import tempfile
import os
import shutil
from typing import Dict, Any

from backend.tree_manager.color_writer import (
    write_theme_colors_to_markdown,
    _assign_colors_to_themes,
    _extract_node_id_from_filename
)


class TestColorWriter:
    """Test suite for ColorWriter functionality"""
    
    @pytest.fixture
    def sample_theme_results(self) -> Dict[str, Any]:
        """Sample theme identification results"""
        return {
            "identified_themes": {
                "API Design": {
                    "description": "REST API endpoints and authentication",
                    "node_ids": [2, 3],
                    "node_count": 2
                },
                "Database Management": {
                    "description": "Database schema and migration strategy",
                    "node_ids": [4, 5],
                    "node_count": 2
                },
                "Testing Framework": {
                    "description": "Unit and integration testing approaches",
                    "node_ids": [6, 7],
                    "node_count": 2
                }
            },
            "total_themes": 3,
            "total_nodes_processed": 6
        }
    
    @pytest.fixture
    def temp_input_forest(self):
        """Create temporary input forest directory with sample markdown files"""
        temp_dir = tempfile.mkdtemp()
        
        # Create sample markdown files
        sample_files = {
            "2_api_endpoints.md": """---
title: API Endpoints Design
summary: REST API design patterns
---

# API Endpoints Design

Content about API endpoints...
""",
            "3_api_auth.md": """---
title: API Authentication
summary: Authentication strategies  
---

# API Authentication

Content about authentication...
""",
            "4_db_schema.md": """---
title: Database Schema Design
summary: Database design principles
color: old_color
---

# Database Schema Design

Content about database schema...
""",
            "5_db_migrations.md": """---
title: Database Migrations
summary: Migration strategies
---

# Database Migrations

Content about migrations...
""",
            "6_unit_tests.md": """---
title: Unit Testing Framework
summary: Unit testing approach
---

# Unit Testing Framework

Content about unit testing...
""",
            "7_integration_tests.md": """---
title: Integration Testing Strategy
summary: Integration testing approach
---

# Integration Testing Strategy

Content about integration testing...
"""
        }
        
        for filename, content in sample_files.items():
            with open(os.path.join(temp_dir, filename), 'w') as f:
                f.write(content)
        
        yield temp_dir
        
        # Cleanup
        shutil.rmtree(temp_dir)
    
    def test_assign_colors_to_themes_deterministic(self):
        """Test that color assignment is deterministic"""
        theme_names = ["API Design", "Database Management", "Testing Framework"]
        
        # Assign colors multiple times
        result1 = _assign_colors_to_themes(theme_names)
        result2 = _assign_colors_to_themes(theme_names)
        
        # Should be identical
        assert result1 == result2
        
        # All themes should have colors assigned
        assert len(result1) == 3
        for theme_name in theme_names:
            assert theme_name in result1
            assert isinstance(result1[theme_name], str)
    
    def test_assign_colors_to_themes_unique(self):
        """Test that different themes get different colors when possible"""
        theme_names = ["API Design", "Database Management", "Testing Framework", "User Interface"]
        result = _assign_colors_to_themes(theme_names)
        
        colors = list(result.values())
        # Should have some variety (not all same color for different themes)
        unique_colors = set(colors)
        assert len(unique_colors) >= 2, f"Expected some color variety, got: {colors}"
    
    def test_extract_node_id_from_filename(self):
        """Test node ID extraction from filenames"""
        assert _extract_node_id_from_filename("2_api_endpoints.md") == 2
        assert _extract_node_id_from_filename("15_complex_name.md") == 15
        assert _extract_node_id_from_filename("1_simple.md") == 1
    
    def test_extract_node_id_from_filename_invalid(self):
        """Test node ID extraction failure cases"""
        with pytest.raises(ValueError):
            _extract_node_id_from_filename("invalid_filename.md")
        
        with pytest.raises(ValueError):
            _extract_node_id_from_filename("not_a_number_file.md")
    
    def test_write_theme_colors_to_markdown_integration(self, sample_theme_results, temp_input_forest):
        """Test complete color writeback integration"""
        # Execute color writeback
        result = write_theme_colors_to_markdown(sample_theme_results, temp_input_forest)
        
        # Verify return value contains expected mappings
        expected_nodes = [2, 3, 4, 5, 6, 7]
        assert len(result) == len(expected_nodes)
        
        for node_id in expected_nodes:
            assert node_id in result
            assert isinstance(result[node_id], str)
        
        # Verify files were updated with colors
        for filename in os.listdir(temp_input_forest):
            if filename.endswith('.md'):
                filepath = os.path.join(temp_input_forest, filename)
                with open(filepath, 'r') as f:
                    content = f.read()
                
                # Should have YAML frontmatter with color
                assert content.startswith('---\n')
                assert 'color:' in content
    
    def test_write_theme_colors_preserves_existing_frontmatter(self, sample_theme_results, temp_input_forest):
        """Test that existing YAML frontmatter is preserved when adding colors"""
        # Execute color writeback
        write_theme_colors_to_markdown(sample_theme_results, temp_input_forest)
        
        # Check that file 4 (which had existing color) was updated but preserved other fields
        filepath = os.path.join(temp_input_forest, "4_db_schema.md")
        with open(filepath, 'r') as f:
            content = f.read()
        
        # Should still have summary (title is intentionally removed for better color visibility)
        assert 'summary: Database design principles' in content
        # Color should be updated (not 'old_color')
        assert 'color: old_color' not in content
        assert 'color:' in content
    
    def test_write_theme_colors_invalid_path(self, sample_theme_results):
        """Test error handling for invalid input forest path"""
        with pytest.raises(ValueError, match="Input forest path does not exist"):
            write_theme_colors_to_markdown(sample_theme_results, "/nonexistent/path")
    
    def test_write_theme_colors_empty_themes(self, temp_input_forest):
        """Test handling of empty theme results"""
        empty_results = {
            "identified_themes": {},
            "total_themes": 0,
            "total_nodes_processed": 0
        }
        
        result = write_theme_colors_to_markdown(empty_results, temp_input_forest)
        assert len(result) == 0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])