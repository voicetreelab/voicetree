#!/usr/bin/env python3
"""
Focused TDD test for main test runner functionality
Tests the core components of the end-to-end test lab system.
"""

import os
import json
import shutil
import tempfile
import subprocess
from pathlib import Path

def test_test_lab_components():
    """Test the main components of the test lab system"""
    
    results = {
        'scenario_loading': False,
        'environment_setup': False,
        'validation_logic': False,
        'report_generation': False,
        'add_new_node_functionality': False
    }
    
    # Test 1: Scenario Loading
    try:
        from test_scenarios import load_test_scenarios  # This doesn't exist yet
    except ImportError:
        # Test loading scenarios manually
        scenarios_file = Path(__file__).parent / 'test_scenarios.json'
        if scenarios_file.exists():
            with open(scenarios_file) as f:
                scenarios = json.load(f)
                if 'test_scenarios' in scenarios and len(scenarios['test_scenarios']) > 0:
                    results['scenario_loading'] = True
                    print("✅ Scenario loading works")
                else:
                    print("❌ Invalid scenario structure")
        else:
            print("❌ Scenarios file not found")
    
    # Test 2: Environment Setup
    try:
        from end_to_end_test_runner import EndToEndTestLab
        lab = EndToEndTestLab()
        test_dir = lab.setup_test_environment()
        if test_dir.exists():
            results['environment_setup'] = True
            print("✅ Environment setup works")
            lab.cleanup_test_environment()
        else:
            print("❌ Environment setup failed")
    except Exception as e:
        print(f"❌ Environment setup error: {e}")
    
    # Test 3: Add New Node Functionality (Core Integration)
    with tempfile.TemporaryDirectory() as temp_dir:
        test_vault = Path(temp_dir) / "test_vault"
        test_date_dir = test_vault / "2025-08-08" 
        test_date_dir.mkdir(parents=True)
        
        # Create source node
        source_node = test_date_dir / "1_test.md"
        with open(source_node, 'w') as f:
            f.write("""---
node_id: 1
title: test (1)
color: blue
---
Test node""")
        
        # Test add_new_node.py directly
        env = os.environ.copy()
        env['AGENT_COLOR'] = 'test_blue'
        
        cmd = [
            'python', 
            str(Path(__file__).parent.parent / 'add_new_node.py'),
            str(source_node),
            "Test Node",
            "Test content",
            "is_progress_of"
        ]
        
        result = subprocess.run(cmd, env=env, capture_output=True, text=True)
        if result.returncode == 0 and "Success!" in result.stdout:
            results['add_new_node_functionality'] = True
            print("✅ add_new_node.py functionality works")
        else:
            print(f"❌ add_new_node.py failed: {result.stderr}")
    
    # Test 4: Validation Logic
    try:
        lab = EndToEndTestLab()
        test_dir = lab.setup_test_environment()
        
        # Create dummy files for validation
        # First create source node
        source_node = test_dir / "1_test_scenario.md"
        with open(source_node, 'w') as f:
            f.write("""---
node_id: 1
title: test scenario (1)
color: blue
---
Source node content""")
            
        dummy_node = test_dir / "1_1_test_node.md"
        with open(dummy_node, 'w') as f:
            f.write("""---
node_id: 1_1
title: test node (1_1)
color: test_blue
---
**Summary**
Test summary

_Links:_
Parent:
- is_progress_of [[1_test_scenario.md]]
""")
        
        print(f"Created files: {[f.name for f in test_dir.glob('*.md')]}")
        validations = lab.validate_test_output(test_dir)
        print(f"Debug validation results: {validations}")
        if validations.get('new_nodes_created') and validations.get('color_consistency'):
            results['validation_logic'] = True
            print("✅ Validation logic works")
        else:
            print(f"❌ Validation logic failed: {validations}")
            
        lab.cleanup_test_environment()
    except Exception as e:
        print(f"❌ Validation logic error: {e}")
    
    # Test 5: Report Generation
    try:
        lab = EndToEndTestLab()
        lab.test_results = [{'id': 'test', 'validations': {'test': True}}]
        report_file = lab.generate_test_report()
        if report_file.exists():
            results['report_generation'] = True
            print("✅ Report generation works")
            report_file.unlink()  # Clean up
        else:
            print("❌ Report generation failed")
    except Exception as e:
        print(f"❌ Report generation error: {e}")
    
    # Overall Results
    passed_tests = sum(results.values())
    total_tests = len(results)
    success_rate = passed_tests / total_tests
    
    print(f"\n=== TEST RUNNER COMPONENT VALIDATION ===")
    print(f"Passed: {passed_tests}/{total_tests} ({success_rate:.1%})")
    
    for test_name, passed in results.items():
        status = "✅" if passed else "❌"
        print(f"{status} {test_name}")
    
    return success_rate >= 0.8

if __name__ == "__main__":
    success = test_test_lab_components()
    print(f"\nMain Runner Test {'PASSED' if success else 'FAILED'}")
    exit(0 if success else 1)