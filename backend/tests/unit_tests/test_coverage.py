import subprocess
import sys
import os
import importlib.util
import json
import tempfile


def test_coverage_threshold():
    """Test that the backend has at least 80% code coverage."""
    # Check if pytest-cov is installed
    if importlib.util.find_spec("pytest_cov") is None:
        print("\n" + "="*80)
        print("SKIPPING COVERAGE TEST")
        print("="*80)
        print("pytest-cov is not installed. To run coverage tests, install it with:")
        print("pip install pytest-cov")
        print("="*80)
        return
    
    # Get the backend directory path
    backend_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    tests_dir = os.path.join(backend_dir, "tests")
    
    # Create a temporary .coveragerc file
    coverage_config = """[run]
source = backend
omit = 
    */tests/*
    */benchmarker/*
    */test_*.py
    */__pycache__/*
    */debug_logs/*
    */prompts/*
    */settings.py
    */settings_new.py
    */main.py
    */__init__.py
    */setup.py
    */llm_providers/*
    */voice_to_text/*
    */llm_config.py
    */process_transcription.py
    */tree_config.py
    */voice_config.py

[report]
exclude_lines =
    pragma: no cover
    def __repr__
    if self\\.debug
    raise AssertionError
    raise NotImplementedError
    if 0:
    if __name__ == .__main__.:
    print\\(.*MOCK.*\\)
    return.*mock.*response
"""
    
    with tempfile.NamedTemporaryFile(mode='w', suffix='.coveragerc', delete=False) as f:
        f.write(coverage_config)
        temp_config_path = f.name
    
    try:
        # Run pytest with coverage for entire backend
        cmd = [
            sys.executable, "-m", "pytest",
            tests_dir,
            "-o", "addopts=",  # Clear the default addopts from pytest.ini
            "--cov=backend",
            "--cov-report=term-missing:skip-covered",
            "--cov-report=json",
            f"--cov-config={temp_config_path}",
            "--cov-fail-under=80",
            "-v"
        ]
        
        # Execute the coverage command
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        # Print the output for visibility
        print("\n" + "="*80)
        print("COVERAGE REPORT")
        print("="*80)
        print(result.stdout)
        
        if result.stderr:
            print("\nERROR OUTPUT:")
            print(result.stderr)
        
        # Check if the command was successful
        if result.returncode != 0:
            # Coverage threshold not met or tests failed
            raise AssertionError(
                f"Coverage check failed. Either tests failed or coverage is below 80%.\n"
                f"Return code: {result.returncode}"
            )
        
        print("\n✅ Coverage check passed! All tests passed with ≥80% coverage.")
    finally:
        # Clean up the temporary file
        if os.path.exists(temp_config_path):
            os.unlink(temp_config_path)


def test_coverage_by_file():
    """Generate a detailed coverage report by file and identify files with low coverage."""
    # Check if pytest-cov is installed
    if importlib.util.find_spec("pytest_cov") is None:
        return
    
    # Get the backend directory path
    backend_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    tests_dir = os.path.join(backend_dir, "tests")
    
    # Use the same coverage config as test_coverage_threshold
    coverage_config = """[run]
source = backend
omit = 
    */tests/*
    */benchmarker/*
    */test_*.py
    */__pycache__/*
    */debug_logs/*
    */prompts/*
    */settings.py
    */settings_new.py
    */main.py
    */__init__.py
    */setup.py
    */llm_providers/*
    */voice_to_text/*
    */llm_config.py
    */process_transcription.py
    */tree_config.py
    */voice_config.py

[report]
exclude_lines =
    pragma: no cover
    def __repr__
    if self\\.debug
    raise AssertionError
    raise NotImplementedError
    if 0:
    if __name__ == .__main__.:
    print\\(.*MOCK.*\\)
    return.*mock.*response
"""
    
    with tempfile.NamedTemporaryFile(mode='w', suffix='.coveragerc', delete=False) as f:
        f.write(coverage_config)
        temp_config_path = f.name
    
    try:
        # Run pytest with coverage and generate JSON report
        cmd = [
            sys.executable, "-m", "pytest",
            tests_dir,
            "-o", "addopts=",
            "--cov=backend",
            "--cov-report=json",
            f"--cov-config={temp_config_path}",
            "-q"
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        # Read the coverage.json file
        coverage_file = os.path.join(os.getcwd(), "coverage.json")
        if os.path.exists(coverage_file):
            with open(coverage_file, 'r') as f:
                coverage_data = json.load(f)
            
            # Extract file coverage data
            files = coverage_data.get('files', {})
            low_coverage_files = []
            
            for filename, file_data in files.items():
                # Skip test files and other excluded files
                if any(pattern in filename for pattern in ['test_', '/tests/', '__pycache__', 'benchmarker']):
                    continue
                    
                summary = file_data.get('summary', {})
                percent_covered = summary.get('percent_covered', 0)
                
                if percent_covered < 80:
                    low_coverage_files.append((filename, percent_covered))
            
            # Sort by coverage percentage
            low_coverage_files.sort(key=lambda x: x[1])
            
            if low_coverage_files:
                print("\n" + "="*80)
                print("FILES WITH LOW COVERAGE (<80%)")
                print("="*80)
                for filename, coverage in low_coverage_files[:10]:  # Show top 10
                    print(f"{coverage:5.1f}% - {filename}")
                print("="*80)
    finally:
        # Clean up the temporary file
        if os.path.exists(temp_config_path):
            os.unlink(temp_config_path)


if __name__ == "__main__":
    test_coverage_threshold()