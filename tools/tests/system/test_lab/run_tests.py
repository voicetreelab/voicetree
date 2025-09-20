#!/usr/bin/env python3
"""
Test Lab Runner - Entry point for end-to-end agent testing
Loads test scenarios and runs them through the testing framework.

YOU MUST RUN THESE WITH ATLEAST A 5 MIN TIMEOUT"
"""

import json
import sys
import argparse
from pathlib import Path

# Add parent directory to path to import test modules
sys.path.append(str(Path(__file__).parent))

from end_to_end_test_runner import EndToEndTestLab


def load_test_scenarios(scenarios_file="test_scenarios.json"):
    """Load test scenarios from JSON file"""
    scenarios_path = Path(__file__).parent / scenarios_file
    with open(scenarios_path, 'r') as f:
        return json.load(f)


def run_specific_scenario(lab, scenario_config):
    """Run a specific test scenario"""
    # Check if this scenario has hook injection enabled
    hook_injection = scenario_config.get('hook_injection', None)
    check_for_phrase = None
    
    if hook_injection and hook_injection.get('enabled'):
        # Extract the phrase we need to check for - looking for the model update
        check_for_phrase = "Gemini 2.0 Flash"
    
    return lab.run_test_scenario(
        scenario_config['name'],
        scenario_config['source_content'],
        scenario_config['agent_prompt'],
        scenario_config.get('expected_behaviors', []),
        hook_injection=hook_injection,
        check_for_phrase=check_for_phrase
    )


def main():
    parser = argparse.ArgumentParser(description='VoiceTree Agent End-to-End Test Lab')
    parser.add_argument('--scenario', help='Run specific test scenario by name')
    parser.add_argument('--list', action='store_true', help='List available test scenarios')
    parser.add_argument('--config', default='test_scenarios.json', help='Test scenarios configuration file')
    parser.add_argument('--verbose', '-v', action='store_true', help='Verbose output')
    
    args = parser.parse_args()
    
    # Load test configuration
    config = load_test_scenarios(args.config)
    scenarios = config['test_scenarios']
    
    if args.list:
        print("Available test scenarios:")
        for i, scenario in enumerate(scenarios, 1):
            print(f"{i}. {scenario['name']}")
            print(f"   Description: {scenario['description']}")
        return 0
    
    # Initialize test lab
    lab = EndToEndTestLab()
    results = []
    
    if args.scenario:
        # Run specific scenario
        scenario = next((s for s in scenarios if s['name'] == args.scenario), None)
        if not scenario:
            print(f"❌ Scenario '{args.scenario}' not found")
            return 1
            
        print(f"🧪 Running single test scenario: {args.scenario}")
        success = run_specific_scenario(lab, scenario)
        results.append(success)
        
    else:
        # Run all scenarios
        print(f"🧪 Running {len(scenarios)} test scenarios...")
        
        for i, scenario in enumerate(scenarios, 1):
            print(f"\n--- Test {i}/{len(scenarios)} ---")
            success = run_specific_scenario(lab, scenario)
            results.append(success)
    
    # Generate final report
    report_file = lab.generate_test_report()
    
    # Summary
    total_tests = len(results)
    passed_tests = sum(results)
    pass_rate = (passed_tests / total_tests) * 100 if total_tests > 0 else 0
    
    print(f"\n{'='*60}")
    print(f"🎯 END-TO-END TEST LAB SUMMARY")
    print(f"{'='*60}")
    print(f"Total Scenarios: {total_tests}")
    print(f"Passed: {passed_tests}")
    print(f"Failed: {total_tests - passed_tests}")
    print(f"Pass Rate: {pass_rate:.1f}%")
    print(f"Report: {report_file}")
    
    if pass_rate >= config.get('test_configuration', {}).get('pass_threshold', 0.7) * 100:
        print("✅ TEST SUITE PASSED")
        return 0
    else:
        print("❌ TEST SUITE FAILED")
        return 1


if __name__ == "__main__":
    sys.exit(main())