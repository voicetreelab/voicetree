"""
Pytest configuration for agentic_workflows tests.
Sets up the Python path so imports work correctly.
"""
import sys
import os

# Add cloud_functions directory to path so 'from agentic_workflows.X' works
cloud_functions_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, cloud_functions_dir)
