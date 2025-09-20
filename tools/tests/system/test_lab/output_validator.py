#!/usr/bin/env python3
"""
Output Validator for Agent Test Results
Validates agent output against expected behaviors and format requirements.
"""

import re
import json
from pathlib import Path
from typing import Dict, List, Any, Optional


class AgentOutputValidator:
    """Validates agent output against test criteria"""
    
    def __init__(self, validation_rules=None):
        self.validation_rules = validation_rules or self._default_validation_rules()
        
    def _default_validation_rules(self):
        """Default validation rules for agent output"""
        return {
            "node_id_pattern": r"^\d+(_\d+)*$",
            "yaml_required_fields": ["node_id", "title", "color"],
            "link_pattern": r"\[\[.*\.md\]\]",
            "mermaid_block_pattern": r"```mermaid[\s\S]*?```",
            "required_sections": ["Summary", "Technical Details", "Impact"],
            "filename_sanitization": {
                "invalid_chars": ["/", "\\", ":", "*", "?", "\"", "<", ">", "|"],
                "replacement_char": "_"
            }
        }
    
    def validate_directory_output(self, test_dir: Path, source_note_name: str = None) -> Dict[str, Any]:
        """
        Validate all output files in a test directory
        
        Args:
            test_dir: Directory containing test output files
            source_note_name: Name of the original source note to exclude from validation
            
        Returns:
            Dictionary containing validation results
        """
        results = {
            'overall_pass': False,
            'files_validated': 0,
            'validations': {
                'new_nodes_created': False,
                'proper_node_ids': False,
                'color_consistency': False,
                'parent_child_links': False,
                'yaml_frontmatter': False,
                'content_format': False,
                'mermaid_diagrams': False,
                'sanitized_filenames': False
            },
            'details': [],
            'errors': []
        }
        
        try:
            # Get all markdown files except the source note
            md_files = list(test_dir.glob("*.md"))
            if source_note_name:
                md_files = [f for f in md_files if f.name != source_note_name]
            
            results['files_validated'] = len(md_files)
            
            if len(md_files) == 0:
                results['errors'].append("No new markdown files created")
                return results
                
            results['validations']['new_nodes_created'] = True
            
            # Validate each file
            for md_file in md_files:
                file_results = self.validate_single_file(md_file)
                results['details'].append({
                    'file': md_file.name,
                    'results': file_results
                })
                
                # Aggregate results
                if file_results['yaml_frontmatter']:
                    results['validations']['yaml_frontmatter'] = True
                if file_results['proper_node_id']:
                    results['validations']['proper_node_ids'] = True
                if file_results['color_present']:
                    results['validations']['color_consistency'] = True
                if file_results['parent_links']:
                    results['validations']['parent_child_links'] = True
                if file_results['required_sections']:
                    results['validations']['content_format'] = True
                if file_results['mermaid_diagrams']:
                    results['validations']['mermaid_diagrams'] = True
                if file_results['sanitized_filename']:
                    results['validations']['sanitized_filenames'] = True
            
            # Calculate overall pass
            passed_validations = sum(1 for v in results['validations'].values() if v)
            total_validations = len(results['validations'])
            pass_rate = passed_validations / total_validations
            
            results['overall_pass'] = pass_rate >= 0.7  # 70% pass threshold
            results['pass_rate'] = pass_rate
            
        except Exception as e:
            results['errors'].append(f"Validation error: {str(e)}")
            
        return results
    
    def validate_single_file(self, file_path: Path) -> Dict[str, Any]:
        """
        Validate a single markdown file
        
        Args:
            file_path: Path to the markdown file
            
        Returns:
            Dictionary with validation results for this file
        """
        results = {
            'yaml_frontmatter': False,
            'proper_node_id': False,
            'color_present': False,
            'parent_links': False,
            'required_sections': False,
            'mermaid_diagrams': False,
            'sanitized_filename': False,
            'node_id': None,
            'title': None,
            'color': None,
            'errors': []
        }
        
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # Check filename sanitization
            results['sanitized_filename'] = self._validate_filename_sanitization(file_path.name)
            
            # Extract and validate YAML frontmatter
            yaml_data = self._extract_yaml_frontmatter(content)
            if yaml_data:
                results['yaml_frontmatter'] = True
                
                # Check required fields
                for field in self.validation_rules['yaml_required_fields']:
                    if field in yaml_data:
                        results[field + '_present'] = True
                        results[field] = yaml_data[field]
                
                # Validate node ID format
                if 'node_id' in yaml_data:
                    node_id_str = str(yaml_data['node_id'])
                    if re.match(self.validation_rules['node_id_pattern'], node_id_str):
                        results['proper_node_id'] = True
                
                # Check color presence
                if 'color' in yaml_data:
                    results['color_present'] = True
            
            # Check for parent links
            link_pattern = self.validation_rules['link_pattern']
            if re.search(link_pattern, content):
                results['parent_links'] = True
            
            # Check for required sections
            required_sections = self.validation_rules['required_sections']
            sections_found = 0
            for section in required_sections:
                # Check for both ## Section and **Section** formats
                if re.search(rf'##\s*{section}|^\*\*{section}\*\*', content, re.MULTILINE | re.IGNORECASE):
                    sections_found += 1
            
            results['required_sections'] = sections_found >= len(required_sections) * 0.6  # 60% of sections
            
            # Check for Mermaid diagrams
            mermaid_pattern = self.validation_rules['mermaid_block_pattern']
            mermaid_matches = re.findall(mermaid_pattern, content, re.IGNORECASE)
            results['mermaid_diagrams'] = len(mermaid_matches) > 0
            results['mermaid_count'] = len(mermaid_matches)
            
        except Exception as e:
            results['errors'].append(f"File validation error: {str(e)}")
        
        return results
    
    def _validate_filename_sanitization(self, filename: str) -> bool:
        """Check if filename is properly sanitized"""
        invalid_chars = self.validation_rules['filename_sanitization']['invalid_chars']
        return not any(char in filename for char in invalid_chars)
    
    def _extract_yaml_frontmatter(self, content: str) -> Optional[Dict[str, Any]]:
        """Extract YAML frontmatter from markdown content"""
        try:
            if not content.startswith('---'):
                return None
                
            # Find the closing ---
            lines = content.split('\n')
            yaml_lines = []
            in_yaml = False
            
            for i, line in enumerate(lines):
                if i == 0 and line.strip() == '---':
                    in_yaml = True
                    continue
                elif in_yaml and line.strip() == '---':
                    break
                elif in_yaml:
                    yaml_lines.append(line)
            
            if not yaml_lines:
                return None
            
            # Parse YAML manually (simple key: value pairs)
            yaml_data = {}
            for line in yaml_lines:
                if ':' in line:
                    key, value = line.split(':', 1)
                    key = key.strip()
                    value = value.strip()
                    
                    # Try to convert to appropriate type
                    if value.isdigit():
                        value = int(value)
                    elif value.replace('.', '').isdigit():
                        value = float(value)
                    elif value.lower() in ('true', 'false'):
                        value = value.lower() == 'true'
                        
                    yaml_data[key] = value
            
            return yaml_data
            
        except Exception:
            return None
    
    def generate_validation_report(self, validation_results: Dict[str, Any], output_file: Optional[Path] = None) -> str:
        """
        Generate a human-readable validation report
        
        Args:
            validation_results: Results from validate_directory_output
            output_file: Optional file to write report to
            
        Returns:
            Report string
        """
        report_lines = [
            "="*60,
            "AGENT OUTPUT VALIDATION REPORT",
            "="*60,
            f"Files Validated: {validation_results['files_validated']}",
            f"Overall Pass: {'✅ PASS' if validation_results['overall_pass'] else '❌ FAIL'}",
            f"Pass Rate: {validation_results.get('pass_rate', 0):.1%}",
            "",
            "Validation Results:",
        ]
        
        for validation, passed in validation_results['validations'].items():
            status = "✅" if passed else "❌"
            report_lines.append(f"  {status} {validation.replace('_', ' ').title()}")
        
        if validation_results['errors']:
            report_lines.extend([
                "",
                "Errors:",
            ])
            for error in validation_results['errors']:
                report_lines.append(f"  ❌ {error}")
        
        if validation_results['details']:
            report_lines.extend([
                "",
                "File Details:",
            ])
            for detail in validation_results['details']:
                report_lines.append(f"  📁 {detail['file']}")
                file_results = detail['results']
                for key, value in file_results.items():
                    if key == 'errors':
                        continue
                    if isinstance(value, bool):
                        status = "✅" if value else "❌"
                        report_lines.append(f"    {status} {key.replace('_', ' ').title()}")
                    elif value is not None and key in ['node_id', 'title', 'color']:
                        report_lines.append(f"    📝 {key.title()}: {value}")
                
                if file_results.get('errors'):
                    for error in file_results['errors']:
                        report_lines.append(f"    ❌ {error}")
        
        report = "\n".join(report_lines)
        
        if output_file:
            with open(output_file, 'w') as f:
                f.write(report)
        
        return report


def main():
    """CLI interface for output validator"""
    import argparse
    
    parser = argparse.ArgumentParser(description='Validate agent test output')
    parser.add_argument('test_dir', help='Directory containing test output files')
    parser.add_argument('--source-note', help='Source note filename to exclude from validation')
    parser.add_argument('--report', help='Output file for validation report')
    
    args = parser.parse_args()
    
    validator = AgentOutputValidator()
    results = validator.validate_directory_output(Path(args.test_dir), args.source_note)
    
    report = validator.generate_validation_report(results, Path(args.report) if args.report else None)
    print(report)
    
    return 0 if results['overall_pass'] else 1


if __name__ == "__main__":
    sys.exit(main())