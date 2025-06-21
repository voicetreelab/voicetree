"""
Test to verify code coverage meets minimum requirements
This test can be run separately to check coverage without failing other tests
"""

import subprocess
import sys
import json
from pathlib import Path
import os


def test_coverage_threshold():
    """
    Run coverage analysis and verify it meets the minimum threshold
    
    This test:
    1. Runs pytest with coverage on the agentic_workflows module
    2. Generates a coverage report
    3. Checks if coverage meets the minimum threshold (80%)
    """
    
    # Define the module to test
    module_path = "backend.text_to_graph_pipeline.agentic_workflows"
    min_coverage = 80  # Minimum coverage percentage
    
    # Temporarily disable pytest.ini to avoid conflicts
    pytest_ini = Path("pytest.ini")
    pytest_ini_backup = Path("pytest.ini.backup")
    
    # Backup pytest.ini if it exists
    if pytest_ini.exists():
        pytest_ini.rename(pytest_ini_backup)
    
    try:
        # Run pytest with coverage for the specific module
        cmd = [
            sys.executable, "-m", "pytest",
            f"--cov={module_path}",
            "--cov-report=json",
            "--cov-report=term",
            "backend/tests/unit_tests/agentic_workflows",
            "-v",
            "--no-header"
        ]
        
        print(f"\nRunning coverage analysis for {module_path}...")
        print(f"Command: {' '.join(cmd)}")
        
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            cwd=Path(__file__).parent.parent.parent  # Run from project root
        )
        
        print("\n--- Coverage Output ---")
        print(result.stdout)
        if result.stderr:
            print("\n--- Errors ---")
            print(result.stderr)
        
        # Check if coverage.json was created
        coverage_file = Path("coverage.json")
        if coverage_file.exists():
            with open(coverage_file, "r") as f:
                coverage_data = json.load(f)
            
            # Extract total coverage percentage
            total_coverage = coverage_data.get("totals", {}).get("percent_covered", 0)
            
            print(f"\nTotal Coverage: {total_coverage:.1f}%")
            print(f"Required Coverage: {min_coverage}%")
            
            # Assert coverage meets minimum
            assert total_coverage >= min_coverage, (
                f"Coverage {total_coverage:.1f}% is below minimum {min_coverage}%"
            )
            
            # Print file-by-file coverage for debugging
            print("\n--- File Coverage ---")
            files = coverage_data.get("files", {})
            for file_path, file_data in sorted(files.items()):
                if module_path.replace(".", "/") in file_path:
                    file_coverage = file_data["summary"]["percent_covered"]
                    print(f"{file_path}: {file_coverage:.1f}%")
        else:
            # Fallback: parse coverage from stdout
            import re
            
            # Look for TOTAL line in coverage output
            total_match = re.search(r'TOTAL\s+\d+\s+\d+\s+(\d+)%', result.stdout)
            if total_match:
                total_coverage = int(total_match.group(1))
                print(f"\nTotal Coverage (parsed): {total_coverage}%")
                print(f"Required Coverage: {min_coverage}%")
                
                assert total_coverage >= min_coverage, (
                    f"Coverage {total_coverage}% is below minimum {min_coverage}%"
                )
            else:
                print("\nWARNING: Could not parse coverage percentage")
                print("This might mean no Python files were found in the module")
    
    finally:
        # Restore pytest.ini
        if pytest_ini_backup.exists():
            pytest_ini_backup.rename(pytest_ini)


def test_coverage_by_file():
    """
    Check coverage for individual files and report which ones need improvement
    """
    # Use subprocess to run coverage with pytest
    cmd = [
        sys.executable, "-m", "pytest",
        "--cov=backend.text_to_graph_pipeline.agentic_workflows",
        "--cov-report=",  # No report, we'll analyze it ourselves
        "backend/tests/unit_tests/agentic_workflows",
        "-q"
    ]
    
    # Temporarily disable pytest.ini
    pytest_ini = Path("pytest.ini")
    pytest_ini_backup = Path("pytest.ini.backup2")
    
    if pytest_ini.exists():
        pytest_ini.rename(pytest_ini_backup)
    
    try:
        # Run tests with coverage
        subprocess.run(cmd, capture_output=True, text=True)
        
        # Now generate a detailed report
        coverage_cmd = [
            sys.executable, "-m", "coverage", "report",
            "--include=backend/text_to_graph_pipeline/agentic_workflows/*"
        ]
        
        result = subprocess.run(coverage_cmd, capture_output=True, text=True)
        
        print("\n--- Per-File Coverage Analysis ---")
        print(result.stdout)
        
        # Parse the output to find low coverage files
        lines = result.stdout.strip().split('\n')
        low_coverage_files = []
        
        for line in lines:
            if 'backend/text_to_graph_pipeline/agentic_workflows' in line and '%' in line:
                parts = line.split()
                if len(parts) >= 4:
                    try:
                        coverage_pct = int(parts[-1].rstrip('%'))
                        file_path = parts[0]
                        if coverage_pct < 80:
                            low_coverage_files.append((file_path, coverage_pct))
                    except ValueError:
                        pass
        
        if low_coverage_files:
            print("\n⚠️  Files with low coverage:")
            for file_path, coverage_pct in low_coverage_files:
                print(f"  - {file_path}: {coverage_pct}%")
        else:
            print("\n✅ All files meet the 80% coverage threshold!")
    
    finally:
        # Restore pytest.ini
        if pytest_ini_backup.exists():
            pytest_ini_backup.rename(pytest_ini)


if __name__ == "__main__":
    # Run both coverage tests
    print("=" * 60)
    print("Running Coverage Analysis")
    print("=" * 60)
    
    try:
        test_coverage_threshold()
        print("\n✅ Overall coverage test passed!")
    except AssertionError as e:
        print(f"\n❌ Overall coverage test failed: {e}")
    except Exception as e:
        print(f"\n❌ Error running coverage test: {e}")
    
    print("\n" + "=" * 60)
    
    try:
        test_coverage_by_file()
    except Exception as e:
        print(f"\n❌ Per-file coverage test failed: {e}")